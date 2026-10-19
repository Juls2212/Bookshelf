import { databaseNameFor, openUserDatabase } from '@/db/database';
import { getUserVersion, migrate, SCHEMA_VERSION } from '@/db/schema';
import { enqueueBookOperation, listSyncQueue } from '@/db/syncQueue';
import { createLibrarySession } from '@/features/library/librarySession';
import type { LocalBookRow } from '@/features/library/localBookRow';
import { createSqliteBookRepository } from '@/features/library/sqliteBookRepository';
import { createMemoryDatabase, createMemoryOpener } from '@/test-utils/nodeSqlite';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function setup() {
  const opener = createMemoryOpener();
  const session = createLibrarySession({ open: (userId) => openUserDatabase(userId, opener) });
  let clock = Date.parse('2026-10-11T10:00:00.000Z');
  let ids = 0;
  const repo = createSqliteBookRepository({
    session,
    now: () => new Date(clock),
    newId: () => `book-${++ids}`,
  });
  const tick = (ms = 1000) => {
    clock += ms;
  };
  const db = async () => (await session.current())!.db;
  return { opener, session, repo, tick, db };
}

const rowOf = async (db: Awaited<ReturnType<ReturnType<typeof setup>['db']>>, id: string) =>
  db.getFirstAsync<LocalBookRow>('SELECT * FROM books WHERE id = ?', [id]);

describe('migrations', () => {
  it('create the schema and are idempotent', async () => {
    const db = createMemoryDatabase();
    expect(await getUserVersion(db)).toBe(0);
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    // Running again (every app start) changes nothing and does not fail.
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual([
      'books',
      'profile',
      'reading_events',
      'reading_preferences',
      'recommendations',
      'sync_meta',
      'sync_queue',
    ]);
  });

  it('opens one database file per user', async () => {
    expect(databaseNameFor(USER_A)).toBe(`bookshelf_${USER_A}.db`);
    expect(() => databaseNameFor('../../')).toThrow('invalid_user_id');
    const opener = createMemoryOpener();
    await openUserDatabase(USER_A, opener);
    await openUserDatabase(USER_B, opener);
    expect([...opener.files.keys()]).toEqual([databaseNameFor(USER_A), databaseNameFor(USER_B)]);
  });
});

describe('SqliteBookRepository', () => {
  it('requires a signed-in session', async () => {
    const { repo } = setup();
    await expect(repo.list()).resolves.toEqual({ ok: false, error: 'unauthorized' });
  });

  it('creates a pending book and queues its upsert in the same transaction', async () => {
    const { session, repo, db } = setup();
    await session.start(USER_A);
    const created = await repo.create({
      title: '  Los almendros ',
      pageCount: 200,
      readingStatus: 'reading',
      currentPage: 10,
    });
    expect(created).toMatchObject({ ok: true, data: { id: 'book-1', title: 'Los almendros' } });

    const row = await rowOf(await db(), 'book-1');
    expect(row).toMatchObject({
      user_id: USER_A,
      sync_state: 'pending',
      local_updated_at: '2026-10-11T10:00:00.000Z',
      status_changed_at: '2026-10-11T10:00:00.000Z',
      deleted_at: null,
    });
    expect((await listSyncQueue(await db())).map((e) => [e.entity_id, e.operation])).toEqual([
      ['book-1', 'upsert'],
    ]);
    await expect(repo.list()).resolves.toMatchObject({ ok: true, data: [{ id: 'book-1' }] });
  });

  it('queues the cover upload when a local cover is saved', async () => {
    const { session, repo, db } = setup();
    await session.start(USER_A);
    await repo.create({
      title: 'Con portada',
      pageCount: 200,
      coverPath: `${USER_A}/book-1.jpg`,
      coverSource: 'gallery',
      localCoverUri: 'file:///documents/covers/a/book-1.jpg',
    });
    const queue = await listSyncQueue(await db());
    expect(queue.map((e) => e.operation).sort()).toEqual(['cover_upload', 'upsert']);
    await expect(repo.getById('book-1')).resolves.toMatchObject({
      ok: true,
      data: { localCoverUri: 'file:///documents/covers/a/book-1.jpg' },
    });
  });

  it('updates with the same rules, no server read, and coalesces queue entries', async () => {
    const { session, repo, tick, db } = setup();
    await session.start(USER_A);
    await repo.create({
      title: 'Libro',
      readingStatus: 'finished',
      pageCount: 100,
      currentPage: 100,
      rating: 5,
    });

    // Simulate a failed sync attempt on the queued upsert.
    await (
      await db()
    ).runAsync("UPDATE sync_queue SET attempts = 3, last_error_code = 'network_error'");

    tick();
    const updated = await repo.update('book-1', { readingStatus: 'reading', currentPage: 40 });
    // Leaving finished: status date stamped, stale rating cleared (reading rules).
    expect(updated).toMatchObject({
      ok: true,
      data: { readingStatus: 'reading', rating: null, statusChangedAt: '2026-10-11T10:00:01.000Z' },
    });
    tick();
    await repo.update('book-1', { notes: '  nota  ' });

    const queue = await listSyncQueue(await db());
    // One coalesced book entry, plus the reading event of the page change (100 -> 40).
    expect(queue.filter((e) => e.entity === 'book')).toHaveLength(1);
    expect(queue.filter((e) => e.entity === 'reading_event')).toHaveLength(1);
    expect(queue[0]).toMatchObject({ operation: 'upsert', attempts: 0, last_error_code: null });
    expect(await rowOf(await db(), 'book-1')).toMatchObject({
      notes: 'nota',
      sync_state: 'pending',
      local_updated_at: '2026-10-11T10:00:02.000Z',
    });
  });

  it('rejects invalid changes without writing anything', async () => {
    const { session, repo, db } = setup();
    await session.start(USER_A);
    await expect(repo.create({ title: ' ' })).resolves.toMatchObject({
      ok: false,
      error: 'validation_failed',
      issues: ['title_required', 'page_count_required'],
    });
    await expect(repo.create({ title: 'Sin páginas' })).resolves.toMatchObject({
      ok: false,
      issues: ['page_count_required'],
    });
    await repo.create({ title: 'Libro', pageCount: 100 });
    await expect(repo.update('book-1', { currentPage: 150 })).resolves.toMatchObject({
      ok: false,
      error: 'validation_failed',
      issues: ['current_page_exceeds_total'],
    });
    expect(await rowOf(await db(), 'book-1')).toMatchObject({ current_page: 0 });
    await expect(repo.update('missing', { title: 'x' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('books saved without a page count keep working, but a form edit requires one', async () => {
    const { session, repo, db } = setup();
    await session.start(USER_A);
    await repo.create({ title: 'Antiguo', pageCount: 100 });
    // A book saved before the page count was required.
    await (await db()).runAsync('UPDATE books SET page_count = NULL WHERE id = ?', ['book-1']);
    await expect(repo.getById('book-1')).resolves.toMatchObject({
      ok: true,
      data: { pageCount: null },
    });
    await expect(
      repo.update('book-1', { readingStatus: 'reading', currentPage: 40 }),
    ).resolves.toMatchObject({ ok: true, data: { currentPage: 40, pageCount: null } });
    await expect(
      repo.update('book-1', { title: 'Antiguo', pageCount: null }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'validation_failed',
      issues: ['page_count_required'],
    });
    await expect(repo.update('book-1', { pageCount: 10_001 })).resolves.toMatchObject({
      ok: false,
      issues: ['page_count_invalid'],
    });
    await expect(repo.update('book-1', { pageCount: 320 })).resolves.toMatchObject({
      ok: true,
      data: { pageCount: 320 },
    });
  });

  it('soft deletes: hidden from reads, row kept with deleted_at, delete replaces the upsert', async () => {
    const { session, repo, tick, db } = setup();
    await session.start(USER_A);
    await repo.create({ title: 'Borrar', pageCount: 200 });
    tick();
    await expect(repo.softDelete('book-1')).resolves.toEqual({ ok: true, data: null });

    await expect(repo.list()).resolves.toEqual({ ok: true, data: [] });
    await expect(repo.getById('book-1')).resolves.toEqual({ ok: false, error: 'not_found' });
    expect(await rowOf(await db(), 'book-1')).toMatchObject({
      deleted_at: '2026-10-11T10:00:01.000Z',
      sync_state: 'pending',
    });
    expect((await listSyncQueue(await db())).map((e) => e.operation)).toEqual(['delete']);
    // A later upsert for the same book keeps the delete.
    await (await db()).transaction((tx) => enqueueBookOperation(tx, 'book-1', 'upsert', 'x'));
    expect((await listSyncQueue(await db())).map((e) => e.operation)).toEqual(['delete']);
  });

  it('sets and clears loans', async () => {
    const { session, repo } = setup();
    await session.start(USER_A);
    await repo.create({ title: 'Prestado', pageCount: 200 });
    await expect(repo.setLoan('book-1', '  Laura ')).resolves.toMatchObject({
      ok: true,
      data: { lentTo: 'Laura', lentAt: '2026-10-11T10:00:00.000Z' },
    });
    await expect(repo.clearLoan('book-1')).resolves.toMatchObject({
      ok: true,
      data: { lentTo: null, lentAt: null },
    });
  });

  it('keeps each user in a separate database and survives restarts', async () => {
    const { session, repo, opener } = setup();
    await session.start(USER_A);
    await repo.create({ title: 'De A', pageCount: 200 });

    await session.start(USER_B);
    await expect(repo.list()).resolves.toEqual({ ok: true, data: [] });
    await repo.create({ title: 'De B', pageCount: 200 });

    // Sign out closes the database (files are kept), then A signs in again.
    await session.stop();
    expect(opener.files.get(databaseNameFor(USER_B))?.closed()).toBe(true);
    await expect(repo.list()).resolves.toEqual({ ok: false, error: 'unauthorized' });

    await session.start(USER_A);
    const list = await repo.list();
    expect(list.ok && list.data.map((b) => b.title)).toEqual(['De A']);
  });
});
