import { openUserDatabase } from '@/db/database';
import { rowToBook } from '@/features/library/bookMapper';
import { clampBookRow } from '@/features/library/bookText';
import { createLibrarySession } from '@/features/library/librarySession';
import type { LocalBookRow } from '@/features/library/localBookRow';
import { createSqliteBookRepository } from '@/features/library/sqliteBookRepository';
import { createMemoryOpener } from '@/test-utils/nodeSqlite';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

function setup() {
  const opener = createMemoryOpener();
  const session = createLibrarySession({ open: (userId) => openUserDatabase(userId, opener) });
  let ids = 0;
  const repo = createSqliteBookRepository({
    session,
    now: () => new Date('2026-10-11T10:00:00.000Z'),
    newId: () => `book-${++ids}`,
  });
  return { session, repo, db: async () => (await session.current())!.db };
}

describe('repository limits', () => {
  it('rejects a new book over any limit with a validation error', async () => {
    const { session, repo } = setup();
    await session.start(USER);
    const base = { title: 'T', pageCount: 100 };
    await expect(repo.create({ ...base, title: 't'.repeat(201) })).resolves.toMatchObject({
      ok: false,
      issues: ['title_too_long'],
    });
    await expect(repo.create({ ...base, author: 'a'.repeat(121) })).resolves.toMatchObject({
      ok: false,
      issues: ['author_too_long'],
    });
    await expect(repo.create({ ...base, genre: 'g'.repeat(61) })).resolves.toMatchObject({
      ok: false,
      issues: ['genre_too_long'],
    });
    await expect(repo.create({ ...base, notes: 'n'.repeat(2001) })).resolves.toMatchObject({
      ok: false,
      issues: ['notes_too_long'],
    });
    await expect(repo.create({ ...base, pageCount: 10_001 })).resolves.toMatchObject({
      ok: false,
      issues: ['page_count_invalid'],
    });
    await expect(repo.create({ title: 'T', pageCount: null })).resolves.toMatchObject({
      ok: false,
      issues: ['page_count_required'],
    });
  });

  it('stores cleaned text: control characters out, whitespace collapsed', async () => {
    const { session, repo } = setup();
    await session.start(USER);
    const created = await repo.create({
      title: '  El \u0000  nombre\n de la   rosa ',
      author: ' Umberto   Eco ',
      notes: ' uno   dos\n\n\n\ntres ',
      pageCount: 500,
    });
    expect(created).toMatchObject({
      ok: true,
      data: { title: 'El nombre de la rosa', author: 'Umberto Eco', notes: 'uno dos\n\ntres' },
    });
  });

  it('validates the length of edited text, but not of untouched legacy text', async () => {
    const { session, repo, db } = setup();
    await session.start(USER);
    const created = await repo.create({ title: 'Legacy', pageCount: 100 });
    if (!created.ok) throw new Error('create failed');
    // A row saved before the limits existed (or pulled from another device).
    await (
      await db()
    ).runAsync('UPDATE books SET title = ?, notes = ? WHERE id = ?', [
      'x'.repeat(400),
      'n'.repeat(3000),
      created.data.id,
    ]);

    // Updating progress does not trip over the old, overlong title.
    await expect(repo.update(created.data.id, { currentPage: 10 })).resolves.toMatchObject({
      ok: true,
    });
    // Editing the title enforces the limit.
    await expect(repo.update(created.data.id, { title: 'y'.repeat(201) })).resolves.toMatchObject({
      ok: false,
      issues: ['title_too_long'],
    });
    await expect(repo.update(created.data.id, { title: 'y'.repeat(200) })).resolves.toMatchObject({
      ok: true,
    });
    await expect(repo.update(created.data.id, { notes: 'n'.repeat(2001) })).resolves.toMatchObject({
      ok: false,
      issues: ['notes_too_long'],
    });
  });

  it('rejects a loan name over 80 characters and stores it cleaned', async () => {
    const { session, repo } = setup();
    await session.start(USER);
    const created = await repo.create({ title: 'T', pageCount: 10 });
    if (!created.ok) throw new Error('create failed');
    await expect(repo.setLoan(created.data.id, 'l'.repeat(81))).resolves.toMatchObject({
      ok: false,
      issues: ['lent_to_too_long'],
    });
    await expect(repo.setLoan(created.data.id, '  Ana   María ')).resolves.toMatchObject({
      ok: true,
      data: { lentTo: 'Ana María' },
    });
  });
});

describe('overlong rows never reach the UI', () => {
  const row = (overrides: Partial<LocalBookRow>): LocalBookRow => ({
    id: 'b1',
    user_id: USER,
    title: 'T',
    author: null,
    genre: null,
    page_count: 100,
    cover_path: null,
    cover_source: null,
    reading_status: 'to_read',
    current_page: 0,
    rating: null,
    notes: null,
    lent_to: null,
    lent_at: null,
    status_changed_at: '2026-10-11T10:00:00.000Z',
    created_at: '2026-10-11T10:00:00.000Z',
    updated_at: '2026-10-11T10:00:00.000Z',
    deleted_at: null,
    local_cover_uri: null,
    sync_state: 'synced',
    local_updated_at: null,
    ...overrides,
  });

  it('cuts every text field of a legacy or pulled row to its limit', () => {
    const book = rowToBook(
      row({
        title: 'x'.repeat(5000),
        author: 'a'.repeat(5000),
        genre: 'g'.repeat(5000),
        notes: 'n'.repeat(50_000),
        lent_to: 'l'.repeat(5000),
      }),
    );
    expect(book.title).toHaveLength(200);
    expect(book.author).toHaveLength(120);
    expect(book.genre).toHaveLength(60);
    expect(book.notes).toHaveLength(2000);
    expect(book.lentTo).toHaveLength(80);
  });

  it('survives a huge unbroken string', () => {
    const book = rowToBook(row({ title: 'x'.repeat(3_000_000) }));
    expect(book.title).toHaveLength(200);
  });

  it('leaves valid rows untouched', () => {
    const book = rowToBook(row({ title: 'Rayuela', author: null, notes: 'Una nota' }));
    expect(book).toMatchObject({ title: 'Rayuela', author: null, notes: 'Una nota' });
  });
});

describe('clampBookRow (what a push sends)', () => {
  const base = {
    title: 'T',
    author: null,
    genre: null,
    notes: null,
    lent_to: null,
    page_count: 100,
    current_page: 10,
  };

  it('is the identity for a valid row', () => {
    expect(clampBookRow(base)).toEqual(base);
  });

  it('cuts overlong text so the server constraint does not reject the row for good', () => {
    const clamped = clampBookRow({
      ...base,
      title: 't'.repeat(300),
      author: 'a'.repeat(300),
      genre: 'g'.repeat(300),
      notes: 'n'.repeat(5000),
      lent_to: 'l'.repeat(300),
    });
    expect(clamped.title).toHaveLength(200);
    expect(clamped.author).toHaveLength(120);
    expect(clamped.genre).toHaveLength(60);
    expect(clamped.notes).toHaveLength(2000);
    expect(clamped.lent_to).toHaveLength(80);
  });

  it('fixes out-of-range pages', () => {
    expect(clampBookRow({ ...base, page_count: 20_000, current_page: 30 })).toMatchObject({
      page_count: null,
      current_page: 30,
    });
    expect(clampBookRow({ ...base, page_count: 50, current_page: 80 })).toMatchObject({
      page_count: 50,
      current_page: 50,
    });
    expect(clampBookRow({ ...base, current_page: -3 })).toMatchObject({ current_page: 0 });
  });
});
