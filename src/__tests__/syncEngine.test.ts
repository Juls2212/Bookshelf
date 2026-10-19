import { openUserDatabase } from '@/db/database';
import { getMeta, listSyncQueue } from '@/db/syncQueue';
import { createLibrarySession } from '@/features/library/librarySession';
import type { LocalBookRow } from '@/features/library/localBookRow';
import { createSqliteBookRepository } from '@/features/library/sqliteBookRepository';
import type { RemoteBookUpsert } from '@/features/library/supabaseBookGateway';
import { createSyncEngine, PULL_OVERLAP_MS, type SyncSnapshot } from '@/features/sync/syncEngine';
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  backoffDelayMs,
  classifyRemoteError,
  type RemoteCause,
} from '@/features/sync/syncErrors';
import { fakeAvatars } from '@/test-utils/fakeAvatars';
import { fakeReadingEventServer } from '@/test-utils/fakeReadingEventServer';
import { fakePreferencesServer } from '@/test-utils/fakePreferencesServer';
import { fakeRecommendationServer } from '@/test-utils/fakeRecommendationServer';
import { createMemoryOpener } from '@/test-utils/nodeSqlite';
import type { UserBookRow } from '@/types/database';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Directory: jest.fn(), Paths: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

/** In-memory "Supabase": rows by id, a server clock for updated_at, scripted failures. */
function fakeServer() {
  const rows = new Map<string, UserBookRow>();
  let serverClock = Date.parse('2026-10-11T12:00:00.000Z');
  const calls: string[] = [];
  const upsertFailures: RemoteCause[] = [];
  const stamp = () => {
    serverClock += 1000;
    return new Date(serverClock).toISOString();
  };
  let beforeUpsert: ((row: RemoteBookUpsert) => Promise<void>) | null = null;

  const gateway = {
    upsertBook: jest.fn(async (row: RemoteBookUpsert) => {
      calls.push(`upsert:${row.id}`);
      if (beforeUpsert) {
        const hook = beforeUpsert;
        beforeUpsert = null;
        await hook(row);
      }
      const failure = upsertFailures.shift();
      if (failure) return { ok: false as const, cause: failure };
      const saved: UserBookRow = { ...row, updated_at: stamp() };
      rows.set(row.id, saved);
      return { ok: true as const, data: saved };
    }),
    pullChangedSince: jest.fn(async (since: string, offset: number, limit: number) => ({
      ok: true as const,
      data: [...rows.values()]
        .filter((r) => Date.parse(r.updated_at) > Date.parse(since))
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
        .slice(offset, offset + limit),
    })),
    pullPage: jest.fn(async (offset: number, limit: number) => ({
      ok: true as const,
      data: [...rows.values()].slice(offset, offset + limit),
    })),
    refreshSession: jest.fn(async () => true),
  };

  return {
    rows,
    calls,
    gateway,
    upsertFailures,
    onNextUpsert: (hook: (row: RemoteBookUpsert) => Promise<void>) => {
      beforeUpsert = hook;
    },
    /** A change made elsewhere (dashboard or another device). */
    remoteEdit: (id: string, patch: Partial<UserBookRow>) => {
      const base = rows.get(id) ?? remoteRow(id);
      rows.set(id, { ...base, ...patch, updated_at: stamp() });
    },
  };
}

function remoteRow(id: string, overrides: Partial<UserBookRow> = {}): UserBookRow {
  return {
    id,
    user_id: USER,
    title: `Remote ${id}`,
    author: null,
    genre: null,
    page_count: null,
    cover_path: null,
    cover_source: null,
    reading_status: 'to_read',
    current_page: 0,
    rating: null,
    notes: null,
    lent_to: null,
    lent_at: null,
    status_changed_at: '2026-10-01T00:00:00.000Z',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function fakeNetwork(initial = true) {
  let online = initial;
  const listeners = new Set<(online: boolean) => void>();
  return {
    isOnline: jest.fn(async () => online),
    subscribe: (listener: (online: boolean) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (value: boolean) => {
      online = value;
      listeners.forEach((l) => l(value));
    },
  };
}

async function setup({ online = true } = {}) {
  const server = fakeServer();
  const network = fakeNetwork(online);
  const opener = createMemoryOpener();
  const session = createLibrarySession({ open: (u) => openUserDatabase(u, opener) });
  await session.start(USER);
  const db = (await session.current())!.db;

  let clock = Date.parse('2026-10-11T10:00:00.000Z');
  const now = () => new Date(clock);
  let ids = 0;
  const repo = createSqliteBookRepository({ session, now, newId: () => `b${++ids}` });

  const covers = {
    upload: jest.fn(async (_userId: string, bookId: string) => {
      server.calls.push(`cover:${bookId}`);
      return { ok: true as const, data: `${USER}/${bookId}.jpg` };
    }),
    downloadToLocal: jest.fn(async (_userId: string, bookId: string) => ({
      ok: true as const,
      data: `file:///documents/covers/${bookId}.jpg`,
    })),
    remove: jest.fn(async (_path: string) => ({ ok: true as const, data: null })),
  };
  const snapshots: SyncSnapshot[] = [];
  const onRemoteChanges = jest.fn();
  const foregroundListeners: ((active: boolean) => void)[] = [];
  const engine = createSyncEngine({
    session,
    gateway: server.gateway,
    profiles: {
      pullProfile: jest.fn(async () => ({ ok: true as const, data: null })),
      pushProfile: jest.fn(),
    },
    preferences: fakePreferencesServer(USER).gateway,
    recommendations: fakeRecommendationServer().gateway,
    covers,
    avatars: fakeAvatars().service,
    readingEvents: fakeReadingEventServer().gateway,
    network,
    foreground: { subscribe: (l) => (foregroundListeners.push(l), () => undefined) },
    now,
    random: () => 0,
    onSnapshot: (s) => snapshots.push(s),
    onRemoteChanges,
    debounceMs: 20,
  });
  const row = (id: string) =>
    db.getFirstAsync<LocalBookRow>('SELECT * FROM books WHERE id = ?', [id]);
  return {
    server,
    network,
    session,
    db,
    repo,
    covers,
    avatars: fakeAvatars().service,
    readingEvents: fakeReadingEventServer().gateway,
    engine,
    snapshots,
    onRemoteChanges,
    foregroundListeners,
    row,
    last: () => snapshots[snapshots.length - 1],
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('push', () => {
  it('pushes cover upload, then the book, then deletes; success marks rows synced', async () => {
    const t = await setup();
    await t.repo.create({
      title: 'With cover',
      pageCount: 200,
      coverPath: `${USER}/b1.jpg`,
      coverSource: 'gallery',
      localCoverUri: 'file:///documents/covers/b1.jpg',
    });
    await t.repo.create({ title: 'Deleted', pageCount: 200 });
    await t.repo.softDelete('b2');

    await t.engine.syncNow();

    expect(t.server.calls).toEqual(['cover:b1', 'upsert:b1', 'upsert:b2']);
    expect(t.server.rows.get('b2')?.deleted_at).not.toBeNull();
    // Never send updated_at; user_id comes from the session.
    const sent = t.server.gateway.upsertBook.mock.calls[0][0];
    expect(sent).not.toHaveProperty('updated_at');
    expect(sent.user_id).toBe(USER);

    expect(await t.row('b1')).toMatchObject({
      sync_state: 'synced',
      updated_at: t.server.rows.get('b1')?.updated_at,
    });
    expect(await listSyncQueue(t.db)).toEqual([]);
    expect(t.last()).toMatchObject({ status: 'idle', pendingCount: 0, failedCount: 0 });
    expect(t.last().lastSyncAt).not.toBeNull();
  });

  it('coalesces edit-then-delete into a single push of the deleted row', async () => {
    const t = await setup();
    await t.repo.create({ title: 'Book', pageCount: 200 });
    await t.repo.update('b1', { title: 'Edited' });
    await t.repo.softDelete('b1');
    expect((await listSyncQueue(t.db)).map((e) => e.operation)).toEqual(['delete']);

    await t.engine.syncNow();
    expect(t.server.calls).toEqual(['upsert:b1']);
    expect(t.server.rows.get('b1')).toMatchObject({ title: 'Edited' });
    expect(t.server.rows.get('b1')?.deleted_at).not.toBeNull();
  });

  it('keeps a book pending when it was edited during the push, and pushes it again', async () => {
    const t = await setup();
    await t.repo.create({ title: 'Before', pageCount: 200 });
    t.server.onNextUpsert(async () => {
      t.advance(1);
      await t.repo.update('b1', { title: 'During push' });
    });

    await t.engine.syncNow();
    expect(await t.row('b1')).toMatchObject({ sync_state: 'pending', title: 'During push' });
    expect((await listSyncQueue(t.db)).map((e) => e.operation)).toEqual(['upsert']);

    await t.engine.syncNow();
    expect(t.server.rows.get('b1')?.title).toBe('During push');
    expect(await t.row('b1')).toMatchObject({ sync_state: 'synced' });
  });

  it('keeps the book pending when its cover upload fails (the book waits for its cover)', async () => {
    const t = await setup();
    t.covers.upload.mockResolvedValueOnce({
      ok: false,
      error: 'network_error',
      cause: { message: 'Network request failed' },
    } as never);
    await t.repo.create({
      title: 'Cover first',
      pageCount: 200,
      coverPath: `${USER}/b1.jpg`,
      localCoverUri: 'file:///documents/covers/b1.jpg',
    });

    await t.engine.syncNow();
    expect(t.server.gateway.upsertBook).not.toHaveBeenCalled();
    expect(await t.row('b1')).toMatchObject({ sync_state: 'pending' });
    expect((await listSyncQueue(t.db)).map((e) => e.operation).sort()).toEqual([
      'cover_upload',
      'upsert',
    ]);
  });

  it('makes no calls while offline and syncs when the connection comes back', async () => {
    const t = await setup({ online: false });
    await t.repo.create({ title: 'Offline', pageCount: 200 });
    t.engine.start();
    await t.engine.syncNow();
    expect(t.server.gateway.upsertBook).not.toHaveBeenCalled();
    expect(t.server.gateway.pullPage).not.toHaveBeenCalled();
    expect(t.last()).toMatchObject({ status: 'offline', pendingCount: 1 });

    t.network.set(true);
    await t.engine.syncNow();
    expect(t.server.rows.get('b1')?.title).toBe('Offline');
    t.engine.stop();
  });
});

describe('retries', () => {
  it('retries network errors with backoff and only when due', async () => {
    const t = await setup();
    t.server.upsertFailures.push({ message: 'TypeError: Network request failed' });
    await t.repo.create({ title: 'Retry', pageCount: 200 });

    await t.engine.syncNow();
    const [entry] = await listSyncQueue(t.db);
    // random() = 0 -> half of the base delay.
    expect(entry).toMatchObject({ attempts: 1, last_error_code: 'network_error', failed: 0 });
    expect(Date.parse(entry.next_attempt_at!)).toBe(
      Date.parse('2026-10-11T10:00:00.000Z') + BACKOFF_BASE_MS / 2,
    );
    expect(t.last().status).toBe('error');

    await t.engine.syncNow();
    expect(t.server.gateway.upsertBook).toHaveBeenCalledTimes(1); // not due yet

    t.advance(BACKOFF_BASE_MS);
    await t.engine.syncNow();
    expect(t.server.gateway.upsertBook).toHaveBeenCalledTimes(2);
    expect(await t.row('b1')).toMatchObject({ sync_state: 'synced' });
  });

  it('refreshes an expired session once and retries immediately', async () => {
    const t = await setup();
    t.server.upsertFailures.push({ code: 'PGRST301', status: 401 });
    await t.repo.create({ title: 'JWT', pageCount: 200 });
    await t.engine.syncNow();
    expect(t.server.gateway.refreshSession).toHaveBeenCalledTimes(1);
    expect(await t.row('b1')).toMatchObject({ sync_state: 'synced' });
  });

  it('stops retrying permanent errors, keeps them visible, and retryFailed() resumes', async () => {
    const t = await setup();
    t.server.upsertFailures.push({ code: '42501', status: 403 });
    await t.repo.create({ title: 'Forbidden', pageCount: 200 });

    await t.engine.syncNow();
    expect(await listSyncQueue(t.db)).toMatchObject([
      { failed: 1, last_error_code: 'forbidden', next_attempt_at: null },
    ]);
    expect(t.last()).toMatchObject({ status: 'error', failedCount: 1, pendingCount: 0 });

    t.advance(BACKOFF_MAX_MS * 2);
    await t.engine.syncNow();
    expect(t.server.gateway.upsertBook).toHaveBeenCalledTimes(1);

    await t.engine.retryFailed();
    expect(t.server.gateway.upsertBook).toHaveBeenCalledTimes(2);
    expect(t.last()).toMatchObject({ status: 'idle', failedCount: 0 });
  });

  it('never logs anything but error codes', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = await setup();
    t.server.upsertFailures.push({ code: '42501', message: 'title "Secret" token=abc' });
    await t.repo.create({ title: 'Secret', pageCount: 200, notes: 'Private note' });
    await t.engine.syncNow();
    for (const [message] of warn.mock.calls) {
      expect(String(message)).toMatch(/^\[sync\] \w+ failed: [a-z_]+$/);
    }
    warn.mockRestore();
  });
});

describe('pull', () => {
  it('pulls incrementally with overlap, skips pending rows and applies remote deletes', async () => {
    const t = await setup();
    t.server.rows.set('r1', remoteRow('r1'));
    t.server.rows.set('r2', remoteRow('r2'));
    await t.engine.syncNow(); // initial pull
    expect(t.onRemoteChanges).toHaveBeenCalled();
    const cursor = await getMeta(t.db, 'last_pull_at');

    // Local pending edit on r1; remote edits on both and a remote soft delete of r2.
    await t.repo.update('r1', { title: 'Local wins' });
    t.server.remoteEdit('r1', { title: 'Remote loses' });
    t.server.remoteEdit('r2', { deleted_at: '2026-10-11T12:30:00.000Z' });
    t.server.gateway.upsertBook.mockImplementationOnce(async () => ({
      ok: false as const,
      cause: { message: 'Network request failed' },
    }));

    await t.engine.syncNow();
    const since = t.server.gateway.pullChangedSince.mock.calls[0][0];
    expect(Date.parse(since)).toBe(Date.parse(cursor!) - PULL_OVERLAP_MS);
    expect(await t.row('r1')).toMatchObject({ title: 'Local wins', sync_state: 'pending' });
    const list = await t.repo.list();
    expect(list.ok && list.data.map((b) => b.id)).toEqual(['r1']);
    expect(Date.parse((await getMeta(t.db, 'last_pull_at'))!)).toBeGreaterThan(Date.parse(cursor!));
  });

  it('a change made in the dashboard appears after returning to the foreground', async () => {
    const t = await setup();
    t.server.rows.set('r1', remoteRow('r1'));
    t.engine.start();
    await t.engine.syncNow();
    t.server.remoteEdit('r1', { title: 'From dashboard' });

    t.foregroundListeners.forEach((l) => l(true));
    await t.engine.syncNow();
    expect(await t.row('r1')).toMatchObject({ title: 'From dashboard' });
    t.engine.stop();
  });

  it('downloads remote covers for offline use, at most 2 at a time', async () => {
    const t = await setup();
    for (const id of ['c1', 'c2', 'c3']) {
      t.server.rows.set(id, remoteRow(id, { cover_path: `${USER}/${id}.jpg` }));
    }
    let inFlight = 0;
    let maxInFlight = 0;
    t.covers.downloadToLocal.mockImplementation(async (_u: string, id: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { ok: true as const, data: `file:///documents/covers/${id}.jpg` };
    });

    await t.engine.syncNow();
    expect(t.covers.downloadToLocal).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(await t.row('c1')).toMatchObject({ local_cover_uri: 'file:///documents/covers/c1.jpg' });
  });

  it('tolerates cover download failures and retries them on a later sync', async () => {
    const t = await setup();
    t.server.rows.set('c1', remoteRow('c1', { cover_path: `${USER}/c1.jpg` }));
    t.covers.downloadToLocal.mockResolvedValueOnce({ ok: false, error: 'network_error' } as never);
    await t.engine.syncNow();
    expect(await t.row('c1')).toMatchObject({ local_cover_uri: null });
    await t.engine.syncNow();
    expect(await t.row('c1')).toMatchObject({ local_cover_uri: 'file:///documents/covers/c1.jpg' });
  });
});

describe('scheduling', () => {
  it('is single-flight: concurrent requests never run two syncs at once', async () => {
    const t = await setup();
    await t.repo.create({ title: 'Once', pageCount: 200 });
    let concurrent = 0;
    let maxConcurrent = 0;
    t.server.gateway.upsertBook.mockImplementation(async (row: RemoteBookUpsert) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent -= 1;
      return { ok: true as const, data: { ...row, updated_at: '2026-10-11T12:00:01.000Z' } };
    });
    await Promise.all([t.engine.syncNow(), t.engine.syncNow(), t.engine.syncNow()]);
    expect(maxConcurrent).toBe(1);
    expect(t.server.gateway.upsertBook).toHaveBeenCalledTimes(1);
  });

  it('debounces local writes into one sync', async () => {
    const t = await setup();
    t.engine.notifyLocalChange();
    t.engine.notifyLocalChange();
    t.engine.notifyLocalChange();
    await new Promise((r) => setTimeout(r, 60));
    expect(t.network.isOnline).toHaveBeenCalledTimes(1);
  });
});

describe('error classification and backoff', () => {
  it.each([
    [{ message: 'TypeError: Network request failed' }, 'network_error', true],
    [{ name: 'TimeoutError' }, 'timeout', true],
    [{ status: 503 }, 'server_error', true],
    [{ status: 429 }, 'rate_limited', true],
    [{ code: 'PGRST301', status: 401 }, 'auth_expired', true],
    [{ code: '42501', status: 401 }, 'forbidden', false],
    [{ statusCode: '403' }, 'forbidden', false],
    [{ code: '23514', status: 400 }, 'validation_failed', false],
    [{ code: '23505', status: 409 }, 'constraint_failed', false],
    [{ code: 'empty_file' }, 'invalid_cover', false],
    [{}, 'unknown', true],
  ] as const)('%p -> %s (retryable: %s)', (cause, code, retryable) => {
    expect(classifyRemoteError(cause)).toEqual({ code, retryable });
  });

  it('grows exponentially with jitter and is capped', () => {
    expect(backoffDelayMs(1, () => 0)).toBe(BACKOFF_BASE_MS / 2);
    expect(backoffDelayMs(3, () => 0.999)).toBeLessThanOrEqual(BACKOFF_BASE_MS * 4);
    expect(backoffDelayMs(3, () => 0)).toBe(BACKOFF_BASE_MS * 2);
    expect(backoffDelayMs(50, () => 0.999)).toBeLessThanOrEqual(BACKOFF_MAX_MS);
  });
});
