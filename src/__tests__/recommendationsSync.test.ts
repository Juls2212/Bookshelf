// Recommendations cache: migration 5, the local repository, disposition queue and sync.
import { openUserDatabase } from '@/db/database';
import { getUserVersion, migrate, MIGRATIONS, SCHEMA_VERSION } from '@/db/schema';
import { listSyncQueue } from '@/db/syncQueue';
import { createLibrarySession } from '@/features/library/librarySession';
import {
  getLocalRecommendation,
  type RemoteRecommendation,
} from '@/features/recommendations/localRecommendations';
import {
  addSessionExclusion,
  excludeIdsFor,
  localTimeOf,
  nextDisposition,
  noCandidatesReason,
} from '@/features/recommendations/recommendationRules';
import { createSqliteRecommendationRepository } from '@/features/recommendations/sqliteRecommendationRepository';
import { createSyncEngine } from '@/features/sync/syncEngine';
import { fakeAvatars } from '@/test-utils/fakeAvatars';
import { fakeReadingEventServer } from '@/test-utils/fakeReadingEventServer';
import { fakePreferencesServer } from '@/test-utils/fakePreferencesServer';
import { fakeRecommendationServer } from '@/test-utils/fakeRecommendationServer';
import { createMemoryDatabase, createMemoryOpener } from '@/test-utils/nodeSqlite';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const remote = (
  n: number,
  overrides: Partial<RemoteRecommendation> = {},
): RemoteRecommendation => ({
  id: `rec-${n}`,
  user_id: USER,
  user_book_id: `book-${n}`,
  rationale: `Motivo ${n}.`,
  request_context: { context: null, local_weekday: 1, local_hour: 9 },
  disposition: 'suggested',
  created_at: new Date(Date.UTC(2026, 9, 1) + n * 60_000).toISOString(),
  ...overrides,
});

describe('recommendation rules', () => {
  it('disposition transitions', () => {
    expect(nextDisposition('suggested', 'viewed')).toBe('viewed');
    expect(nextDisposition('read_later', 'viewed')).toBe('read_later');
    expect(nextDisposition('skipped', 'viewed')).toBe('skipped');
    expect(nextDisposition('viewed', 'read_later')).toBe('read_later');
    expect(nextDisposition('read_later', 'skipped')).toBe('skipped');
    expect(nextDisposition('skipped', 'read_later')).toBe('read_later');
    expect(nextDisposition('viewed', 'suggested')).toBe('viewed');
  });

  it('session exclusions: no duplicates, newest last, at most 30 sent', () => {
    expect(addSessionExclusion(['a', 'b'], 'a')).toEqual(['b', 'a']);
    const many = Array.from({ length: 35 }, (_, i) => `b${i}`);
    expect(excludeIdsFor(many)).toEqual(many.slice(5));
  });

  it('no candidates with exclusions means every book was already suggested', () => {
    expect(noCandidatesReason(['b1'])).toBe('exhausted');
    expect(noCandidatesReason([])).toBe('no_candidates');
  });

  it('sends the device weekday and hour', () => {
    expect(localTimeOf(new Date(2026, 9, 12, 7, 30))).toEqual({ localWeekday: 1, localHour: 7 });
  });
});

describe('migration 5', () => {
  it('adds the recommendations cache and the recommendation queue entity', async () => {
    const db = createMemoryDatabase();
    for (const migration of MIGRATIONS.filter((m) => m.version <= 4)) {
      for (const statement of migration.statements) await db.execAsync(statement);
    }
    await db.execAsync('PRAGMA user_version = 4');
    await db.runAsync(
      "INSERT INTO sync_queue (entity, entity_id, operation, created_at) VALUES ('preferences', ?, 'upsert', '2026-10-01T00:00:00.000Z')",
      [USER],
    );

    // Later migrations run too; what v5 added must survive them.
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await listSyncQueue(db)).toMatchObject([{ entity: 'preferences', entity_id: USER }]);
    await db.runAsync(
      "INSERT INTO sync_queue (entity, entity_id, operation, created_at) VALUES ('recommendation', 'rec-1', 'upsert', '2026-10-02T00:00:00.000Z')",
    );
    await expect(
      db.runAsync(
        "INSERT INTO recommendations (id, user_id, book_id, rationale, disposition, created_at) VALUES ('r', 'u', 'b', 'x', 'loved', 'now')",
      ),
    ).rejects.toThrow();

    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(await listSyncQueue(db)).toHaveLength(2);
  });
});

async function setup(server = fakeRecommendationServer()) {
  const opener = createMemoryOpener();
  const session = createLibrarySession({ open: (u) => openUserDatabase(u, opener) });
  await session.start(USER);
  const db = (await session.current())!.db;
  let clock = Date.parse('2026-10-11T10:00:00.000Z');
  const now = () => new Date(clock);
  const onWrite = jest.fn();
  const repo = createSqliteRecommendationRepository({ session, now, onWrite });
  const onRecommendationsChange = jest.fn();
  const engine = createSyncEngine({
    session,
    gateway: {
      upsertBook: jest.fn(),
      pullChangedSince: jest.fn(async () => ({ ok: true as const, data: [] })),
      pullPage: jest.fn(async () => ({ ok: true as const, data: [] })),
      refreshSession: jest.fn(async () => false),
    },
    profiles: {
      pullProfile: jest.fn(async () => ({ ok: true as const, data: null })),
      pushProfile: jest.fn(),
    },
    preferences: fakePreferencesServer(USER).gateway,
    recommendations: server.gateway,
    covers: { upload: jest.fn(), downloadToLocal: jest.fn(), remove: jest.fn() },
    avatars: fakeAvatars().service,
    readingEvents: fakeReadingEventServer().gateway,
    network: { isOnline: async () => true, subscribe: () => () => undefined },
    now,
    random: () => 0,
    onRecommendationsChange,
  });
  const saveNew = (n: number) =>
    repo.saveNew(
      USER,
      {
        recommendationId: `rec-${n}`,
        bookId: `book-${n}`,
        rationale: `Motivo ${n}.`,
        createdAt: remote(n).created_at,
      },
      { context: null, local_weekday: 1, local_hour: 9 },
    );
  return {
    db,
    repo,
    engine,
    server,
    onWrite,
    onRecommendationsChange,
    saveNew,
    local: (id: string) => getLocalRecommendation(db, id),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('SqliteRecommendationRepository', () => {
  it('caches a new recommendation (synced) and lists the history newest first', async () => {
    const t = await setup();
    await expect(t.saveNew(1)).resolves.toEqual({
      ok: true,
      data: {
        id: 'rec-1',
        kind: 'shelf',
        bookId: 'book-1',
        suggestion: null,
        rationale: 'Motivo 1.',
        disposition: 'suggested',
        createdAt: remote(1).created_at,
        pending: false,
      },
    });
    await t.saveNew(2);
    const history = await t.repo.listHistory(USER);
    expect(history.ok && history.data.map((r) => r.id)).toEqual(['rec-2', 'rec-1']);
    expect(await listSyncQueue(t.db)).toEqual([]);
  });

  it('saves a disposition locally first and queues one coalesced entry', async () => {
    const t = await setup();
    await t.saveNew(1);
    await expect(t.repo.updateDisposition(USER, 'rec-1', 'viewed')).resolves.toMatchObject({
      ok: true,
      data: { disposition: 'viewed', pending: true },
    });
    await t.repo.updateDisposition(USER, 'rec-1', 'read_later');
    expect(await listSyncQueue(t.db)).toMatchObject([
      { entity: 'recommendation', entity_id: 'rec-1', operation: 'upsert' },
    ]);
    expect(await t.local('rec-1')).toMatchObject({
      disposition: 'read_later',
      sync_state: 'pending',
    });
    expect(t.onWrite).toHaveBeenCalledTimes(2);

    // "viewed" never downgrades a saved one: nothing written, nothing queued again.
    await expect(t.repo.updateDisposition(USER, 'rec-1', 'viewed')).resolves.toMatchObject({
      data: { disposition: 'read_later' },
    });
    expect(t.onWrite).toHaveBeenCalledTimes(2);
  });

  it('never touches another user', async () => {
    const t = await setup();
    await t.saveNew(1);
    await expect(t.repo.updateDisposition(OTHER, 'rec-1', 'skipped')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    await expect(t.repo.updateDisposition(USER, 'missing', 'skipped')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('recommendations sync', () => {
  it('pushes a disposition and marks it synced', async () => {
    const server = fakeRecommendationServer([remote(1)]);
    const t = await setup(server);
    await t.saveNew(1);
    await t.repo.updateDisposition(USER, 'rec-1', 'skipped');
    await t.engine.syncNow();
    expect(server.gateway.pushDisposition).toHaveBeenCalledWith('rec-1', 'skipped');
    expect(server.row('rec-1')).toMatchObject({ disposition: 'skipped' });
    expect(await t.local('rec-1')).toMatchObject({ disposition: 'skipped', sync_state: 'synced' });
    expect(await listSyncQueue(t.db)).toEqual([]);
    expect(t.onRecommendationsChange).toHaveBeenCalled();
  });

  it('pulls the latest recommendations, keeping only 50', async () => {
    const server = fakeRecommendationServer(Array.from({ length: 55 }, (_, i) => remote(i + 1)));
    const t = await setup(server);
    await t.engine.syncNow();
    const history = await t.repo.listHistory(USER, 100);
    expect(history.ok && history.data).toHaveLength(50);
    expect(history.ok && history.data[0].id).toBe('rec-55');
    expect(server.gateway.pullRecent).toHaveBeenCalledWith(50);
  });

  it('a remote disposition change arrives when nothing is pending', async () => {
    const server = fakeRecommendationServer([remote(1)]);
    const t = await setup(server);
    await t.engine.syncNow();
    server.put(remote(1, { disposition: 'read_later' }));
    await t.engine.syncNow();
    expect(await t.local('rec-1')).toMatchObject({
      disposition: 'read_later',
      sync_state: 'synced',
    });
  });

  it('a pending local disposition wins over the server until it is pushed', async () => {
    const server = fakeRecommendationServer([remote(1)]);
    const t = await setup(server);
    await t.engine.syncNow();
    await t.repo.updateDisposition(USER, 'rec-1', 'read_later');
    server.gateway.pushDisposition.mockResolvedValueOnce({
      ok: false,
      cause: { message: 'Network request failed' },
    });
    server.put(remote(1, { disposition: 'skipped' }));
    await t.engine.syncNow();
    expect(await t.local('rec-1')).toMatchObject({
      disposition: 'read_later',
      sync_state: 'pending',
    });
    expect(await listSyncQueue(t.db)).toMatchObject([
      { entity: 'recommendation', attempts: 1, last_error_code: 'network_error' },
    ]);

    t.advance(10 * 60 * 1000);
    await t.engine.syncNow();
    expect(server.row('rec-1')).toMatchObject({ disposition: 'read_later' });
    expect(await t.local('rec-1')).toMatchObject({ sync_state: 'synced' });
  });

  it('a recommendation gone from the server (its book was deleted) leaves the queue', async () => {
    const t = await setup(fakeRecommendationServer());
    await t.saveNew(7);
    await t.repo.updateDisposition(USER, 'rec-7', 'viewed');
    await t.engine.syncNow();
    expect(await listSyncQueue(t.db)).toEqual([]);
  });
});
