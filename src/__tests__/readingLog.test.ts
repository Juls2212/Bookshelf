// Daily reading statistics: the reading log rules, periods, atomic recording and its sync.
import { act, renderHook } from '@testing-library/react-native';

import { openUserDatabase } from '@/db/database';
import { getUserVersion, migrate, MIGRATIONS, SCHEMA_VERSION } from '@/db/schema';
import { listSyncQueue } from '@/db/syncQueue';
import { createLibrarySession } from '@/features/library/librarySession';
import { dailyPageTotals } from '@/features/library/localReadingEvents';
import { createSqliteReadingLog } from '@/features/library/readingLogRepository';
import { eventForPageChange, pagesReadBetween } from '@/features/library/readingLog';
import { finishedInPeriod, pagesForPeriod, periodRange } from '@/features/library/readingStats';
import { createSqliteBookRepository } from '@/features/library/sqliteBookRepository';
import { msUntilNextLocalDay, useLocalNow } from '@/features/library/useReadingStatsData';
import { createSyncEngine } from '@/features/sync/syncEngine';
import { localWeekKeys } from '@/lib/dates';
import { createLibraryStore } from '@/stores/libraryStore';
import { fakeAvatars } from '@/test-utils/fakeAvatars';
import { fakePreferencesServer } from '@/test-utils/fakePreferencesServer';
import { fakeReadingEventServer } from '@/test-utils/fakeReadingEventServer';
import { fakeRecommendationServer } from '@/test-utils/fakeRecommendationServer';
import { createMemoryDatabase, createMemoryOpener } from '@/test-utils/nodeSqlite';
import type { Book } from '@/types/book';
import type { RemoteBookUpsert } from '@/features/library/supabaseBookGateway';
import type { UserBookRow } from '@/types/database';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

describe('eventForPageChange', () => {
  it('reading forward is a positive event on the given local date', () => {
    expect(eventForPageChange(10, 40, '2026-10-14')).toEqual({
      pagesDelta: 30,
      localDate: '2026-10-14',
    });
  });

  it('going back is a negative correction', () => {
    expect(eventForPageChange(40, 25, '2026-10-14')).toEqual({
      pagesDelta: -15,
      localDate: '2026-10-14',
    });
  });

  it('no change, no event (also for missing pages)', () => {
    expect(eventForPageChange(25, 25, '2026-10-14')).toBeNull();
    expect(eventForPageChange(null, 0, '2026-10-14')).toBeNull();
  });

  it('finishing a book logs the pages that were left', () => {
    expect(eventForPageChange(120, 400, '2026-10-14')?.pagesDelta).toBe(280);
    expect(eventForPageChange(null, 300, '2026-10-14')?.pagesDelta).toBe(300);
  });
});

describe('periods (device local time)', () => {
  it('Hoy changes exactly at local midnight', () => {
    expect(periodRange('today', new Date(2026, 9, 14, 23, 59, 59))).toEqual({
      from: '2026-10-14',
      to: '2026-10-14',
    });
    expect(periodRange('today', new Date(2026, 9, 15, 0, 0, 0))).toEqual({
      from: '2026-10-15',
      to: '2026-10-15',
    });
  });

  it('weeks run Monday to Sunday: Sunday night is still the old week', () => {
    expect(localWeekKeys(new Date(2026, 9, 18, 23, 59))).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
    });
    expect(localWeekKeys(new Date(2026, 9, 19, 0, 0))).toEqual({
      from: '2026-10-19',
      to: '2026-10-25',
    });
  });

  it('31 December to 1 January: the year switches, the week spans both years', () => {
    expect(periodRange('year', new Date(2026, 11, 31, 23, 59))).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(periodRange('year', new Date(2027, 0, 1, 0, 0))).toEqual({
      from: '2027-01-01',
      to: '2027-12-31',
    });
    expect(localWeekKeys(new Date(2027, 0, 1, 9))).toEqual({
      from: '2026-12-28',
      to: '2027-01-03',
    });
    expect(periodRange('all', new Date())).toEqual({ from: null, to: null });
  });

  it('finished books count by the local date they were marked as read', () => {
    const finished = (y: number, m: number, d: number, h: number) =>
      ({
        readingStatus: 'finished',
        statusChangedAt: new Date(y, m - 1, d, h, 30).toISOString(),
        pageCount: 100,
        currentPage: 100,
        rating: null,
        genre: null,
      }) as Pick<
        Book,
        'readingStatus' | 'pageCount' | 'currentPage' | 'rating' | 'genre' | 'statusChangedAt'
      >;
    const monday = new Date(2026, 9, 19, 8);
    expect(finishedInPeriod(finished(2026, 10, 18, 23), 'week', monday)).toBe(false);
    expect(finishedInPeriod(finished(2026, 10, 19, 0), 'week', monday)).toBe(true);
    expect(finishedInPeriod(finished(2026, 10, 19, 0), 'today', monday)).toBe(true);
    expect(finishedInPeriod(finished(2025, 12, 31, 23), 'year', new Date(2026, 0, 1, 1))).toBe(
      false,
    );
    expect(finishedInPeriod(finished(2025, 12, 31, 23), 'all', new Date(2026, 0, 1, 1))).toBe(true);
  });

  it('the next refresh is at the next local midnight', () => {
    expect(msUntilNextLocalDay(new Date(2026, 9, 14, 23, 59, 0))).toBe(60_000);
  });
});

describe('pages per period', () => {
  it('each day is summed, then clamped at zero (a correction never eats another day)', () => {
    const days = { '2026-10-12': 40, '2026-10-13': -25, '2026-10-14': 10 };
    expect(pagesReadBetween(days, '2026-10-12', '2026-10-18')).toBe(50);
    expect(pagesReadBetween({ '2026-10-14': 30 + -10 }, '2026-10-14', '2026-10-14')).toBe(20);
    expect(pagesReadBetween(days, '2026-10-13', '2026-10-13')).toBe(0);
  });

  it('Total uses the library as a fallback for reading that predates the log', () => {
    const books = [{ readingStatus: 'reading', currentPage: 120, pageCount: 300 }] as Book[];
    const now = new Date(2026, 9, 14);
    expect(pagesForPeriod(books, { '2026-10-14': 20 }, 'all', now)).toBe(120);
    expect(pagesForPeriod(books, { '2026-10-14': 20 }, 'today', now)).toBe(20);
    expect(pagesForPeriod([], { '2026-10-14': 20 }, 'all', now)).toBe(20);
  });
});

async function libraryWithLog() {
  const opener = createMemoryOpener();
  const session = createLibrarySession({ open: (u) => openUserDatabase(u, opener) });
  await session.start(USER);
  const db = (await session.current())!.db;
  let clock = new Date(2026, 9, 14, 21, 0).getTime(); // 21:00 local
  let ids = 0;
  const repo = createSqliteBookRepository({
    session,
    now: () => new Date(clock),
    newId: () => `id-${++ids}`,
  });
  const store = createLibraryStore(repo, () => undefined);
  const events = () =>
    db.getAllAsync<{ book_id: string; pages_delta: number; local_date: string }>(
      'SELECT book_id, pages_delta, local_date FROM reading_events ORDER BY rowid',
    );
  return {
    db,
    session,
    repo,
    store,
    events,
    log: createSqliteReadingLog({ session }),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('recording (one event per page change, same transaction)', () => {
  it('every page-changing path records exactly one event; other edits record none', async () => {
    const t = await libraryWithLog();
    const created = await t.store.getState().create({ title: 'Libro', pageCount: 300 });
    const id = created.ok ? created.data.id : '';
    expect(await t.events()).toEqual([]); // adding a book is not reading

    await t.store.getState().updateCurrentPage(id, 40); // page sheet or slider
    await t.store.getState().updateReadingStatus(id, 'finished'); // jumps to the last page
    await t.store.getState().updateReadingStatus(id, 'to_read'); // back to 0
    await t.store.getState().update(id, { currentPage: 15 }); // form edit
    await t.store.getState().updateNotes(id, 'Una nota');
    await t.store.getState().lend(id, 'Ana');
    expect((await t.events()).map((e) => e.pages_delta)).toEqual([40, 260, -300, 15]);
    expect(new Set((await t.events()).map((e) => e.local_date))).toEqual(new Set(['2026-10-14']));
    const queued = (await listSyncQueue(t.db)).filter((e) => e.entity === 'reading_event');
    expect(queued).toHaveLength(4);
  });

  it('uses the local date at the moment of the change (late at night stays on that day)', async () => {
    const t = await libraryWithLog();
    const created = await t.store.getState().create({ title: 'Libro', pageCount: 300 });
    const id = created.ok ? created.data.id : '';
    t.advance(2 * 60 * 60 * 1000 + 59 * 60 * 1000); // 23:59
    await t.store.getState().updateCurrentPage(id, 10);
    t.advance(60 * 1000); // 00:00 next day
    await t.store.getState().updateCurrentPage(id, 25);
    expect(await t.events()).toMatchObject([
      { pages_delta: 10, local_date: '2026-10-14' },
      { pages_delta: 15, local_date: '2026-10-15' },
    ]);
    expect(await t.log.dailyTotals()).toEqual({
      ok: true,
      data: { '2026-10-14': 10, '2026-10-15': 15 },
    });
  });

  it('is atomic: if the event cannot be written, the page change is not saved either', async () => {
    const t = await libraryWithLog();
    const created = await t.store.getState().create({ title: 'Libro', pageCount: 300 });
    const id = created.ok ? created.data.id : '';
    const queuedBefore = (await listSyncQueue(t.db)).length;
    await t.db.execAsync('DROP TABLE reading_events');
    const result = await t.repo.update(id, { currentPage: 50 });
    expect(result.ok).toBe(false);
    const row = await t.db.getFirstAsync<{ current_page: number }>(
      'SELECT current_page FROM books WHERE id = ?',
      [id],
    );
    expect(row?.current_page).toBe(0);
    expect(await listSyncQueue(t.db)).toHaveLength(queuedBefore);
  });
});

describe('local migration 8', () => {
  it('adds the reading log and its queue entity, keeping queued entries; idempotent', async () => {
    const db = createMemoryDatabase();
    for (const migration of MIGRATIONS.filter((m) => m.version <= 7)) {
      for (const statement of migration.statements) await db.execAsync(statement);
    }
    await db.execAsync('PRAGMA user_version = 7');
    await db.runAsync(
      "INSERT INTO sync_queue (entity, entity_id, operation, attempts, created_at) VALUES ('profile', ?, 'avatar_upload', 2, 'x')",
      [USER],
    );
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(await listSyncQueue(db)).toMatchObject([{ operation: 'avatar_upload', attempts: 2 }]);
    await db.runAsync(
      "INSERT INTO sync_queue (entity, entity_id, operation, created_at) VALUES ('reading_event', 'e1', 'upsert', 'x')",
    );
    expect(await dailyPageTotals(db, USER)).toEqual({});
  });
});

async function syncSetup() {
  const t = await libraryWithLog();
  const server = fakeReadingEventServer();
  const remoteBooks = new Map<string, UserBookRow>();
  let serverClock = Date.parse('2026-10-14T20:00:00.000Z');
  const upsertBook = jest.fn(async (row: RemoteBookUpsert) => {
    serverClock += 1000;
    const saved = { ...row, updated_at: new Date(serverClock).toISOString() } as UserBookRow;
    remoteBooks.set(row.id, saved);
    return { ok: true as const, data: saved };
  });
  const engine = createSyncEngine({
    session: t.session,
    gateway: {
      upsertBook,
      pullChangedSince: jest.fn(async () => ({ ok: true as const, data: [] })),
      pullPage: jest.fn(async () => ({ ok: true as const, data: [] })),
      refreshSession: jest.fn(async () => true),
    },
    profiles: {
      pullProfile: jest.fn(async () => ({ ok: true as const, data: null })),
      pushProfile: jest.fn(),
    },
    preferences: fakePreferencesServer(USER).gateway,
    recommendations: fakeRecommendationServer().gateway,
    readingEvents: server.gateway,
    covers: { upload: jest.fn(), downloadToLocal: jest.fn(), remove: jest.fn() },
    avatars: fakeAvatars().service,
    network: { isOnline: async () => true, subscribe: () => () => undefined },
    random: () => 0,
  });
  return { ...t, server, engine, upsertBook };
}

describe('reading log sync', () => {
  it('pushes each event once, after its book; a second sync sends nothing again', async () => {
    const t = await syncSetup();
    const created = await t.store.getState().create({ title: 'Libro', pageCount: 300 });
    const id = created.ok ? created.data.id : '';
    await t.store.getState().updateCurrentPage(id, 30);
    await t.engine.syncNow();
    expect(t.upsertBook.mock.invocationCallOrder[0]).toBeLessThan(
      t.server.gateway.pushEvent.mock.invocationCallOrder[0],
    );
    expect(t.server.stored.size).toBe(1);
    expect(await listSyncQueue(t.db)).toEqual([]);
    await t.engine.syncNow();
    expect(t.server.gateway.pushEvent).toHaveBeenCalledTimes(1);
    expect(t.server.stored.size).toBe(1);
    // Pulled back: same id, only the server's created_at is added.
    const local = await t.db.getAllAsync<{ created_at: string | null; sync_state: string }>(
      'SELECT created_at, sync_state FROM reading_events',
    );
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({ sync_state: 'synced' });
    expect(local[0].created_at).not.toBeNull();
  });

  it('a retried push (the first answer was lost) still stores the event once', async () => {
    const t = await syncSetup();
    const created = await t.store.getState().create({ title: 'Libro', pageCount: 300 });
    const id = created.ok ? created.data.id : '';
    await t.store.getState().updateCurrentPage(id, 30);
    const push = t.server.gateway.pushEvent.getMockImplementation()!;
    t.server.gateway.pushEvent.mockImplementationOnce(async (event) => {
      await push(event); // stored on the server, but the reply never arrives
      return { ok: false, cause: { name: 'TimeoutError' } };
    });
    await t.engine.syncNow();
    expect(await listSyncQueue(t.db)).toHaveLength(1);
    await t.db.runAsync('UPDATE sync_queue SET next_attempt_at = NULL');
    await t.engine.syncNow();
    expect(t.server.gateway.pushEvent).toHaveBeenCalledTimes(2);
    expect(t.server.stored.size).toBe(1);
    expect(await listSyncQueue(t.db)).toEqual([]);
  });

  it('an event waits while its book is not on the server yet', async () => {
    const t = await syncSetup();
    t.upsertBook.mockResolvedValue({ ok: false, cause: { code: '42501', status: 403 } } as never);
    const created = await t.store.getState().create({ title: 'Libro', pageCount: 300 });
    const id = created.ok ? created.data.id : '';
    await t.store.getState().updateCurrentPage(id, 30);
    await t.engine.syncNow();
    expect(t.server.gateway.pushEvent).not.toHaveBeenCalled();
  });

  it('pulls events from other devices once and merges them by id', async () => {
    const t = await syncSetup();
    t.server.addRemote({
      id: 'remote-1',
      user_id: USER,
      book_id: 'b-remote',
      pages_delta: 45,
      local_date: '2026-10-14',
      occurred_at: '2026-10-14T08:00:00.000Z',
    });
    await t.engine.syncNow();
    await t.engine.syncNow();
    expect(await t.log.dailyTotals()).toEqual({ ok: true, data: { '2026-10-14': 45 } });
    const count = await t.db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM reading_events',
    );
    expect(count?.n).toBe(1);
    // The stored local date is kept as is (never recomputed from occurred_at on this device).
    const row = await t.db.getFirstAsync<{ local_date: string }>(
      'SELECT local_date FROM reading_events WHERE id = ?',
      ['remote-1'],
    );
    expect(row?.local_date).toBe('2026-10-14');
  });
});

describe('midnight rollover', () => {
  it('"now" moves on when the app returns to the foreground and at local midnight', async () => {
    jest.useFakeTimers();
    let clock = new Date(2026, 9, 14, 23, 59, 0);
    let listener: (active: boolean) => void = () => undefined;
    const foreground = {
      subscribe: (l: (active: boolean) => void) => {
        listener = l;
        return () => undefined;
      },
    };
    const getNow = () => clock;
    const { result } = await renderHook(() => useLocalNow(getNow, foreground));
    expect(localWeekKeys(result.current).from).toBe('2026-10-12');

    // Back from the background on the next day.
    clock = new Date(2026, 9, 15, 7, 0);
    await act(async () => listener(true));
    expect(result.current).toBe(clock);

    // Left open over midnight: the timer refreshes it.
    clock = new Date(2026, 9, 16, 0, 0, 1);
    await act(async () => {
      jest.advanceTimersByTime(msUntilNextLocalDay(new Date(2026, 9, 15, 7, 0)));
    });
    expect(result.current).toBe(clock);
    jest.useRealTimers();
  });
});
