// Reading preferences: rules, migration 4, the local repository and the sync engine.
import { openUserDatabase } from '@/db/database';
import { getUserVersion, migrate, MIGRATIONS, SCHEMA_VERSION } from '@/db/schema';
import { listSyncQueue } from '@/db/syncQueue';
import { createLibrarySession } from '@/features/library/librarySession';
import { getLocalPreferences } from '@/features/preferences/localPreferences';
import {
  DEFAULT_PREFERENCES,
  defaultPreferences,
  GENRE_KEYS,
  normalizeGenres,
  normalizePreferences,
  toggleGenre,
  type GenreKey,
  type ReadingPreferences,
} from '@/features/preferences/preferencesRules';
import { createSqlitePreferencesRepository } from '@/features/preferences/sqlitePreferencesRepository';
import { createSyncEngine } from '@/features/sync/syncEngine';
import { fakeAvatars } from '@/test-utils/fakeAvatars';
import { fakeReadingEventServer } from '@/test-utils/fakeReadingEventServer';
import { fakePreferencesServer } from '@/test-utils/fakePreferencesServer';
import { fakeRecommendationServer } from '@/test-utils/fakeRecommendationServer';
import { createMemoryDatabase, createMemoryOpener } from '@/test-utils/nodeSqlite';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const prefs = (overrides: Partial<ReadingPreferences> = {}): ReadingPreferences => ({
  ...defaultPreferences(),
  ...overrides,
});

describe('preferences rules', () => {
  it('has the 8 genre keys of the server', () => {
    expect(GENRE_KEYS).toEqual([
      'novel',
      'poetry',
      'history',
      'essay',
      'mystery',
      'chronicle',
      'fantasy',
      'biography',
    ]);
  });

  it('uses the server defaults', () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      favoriteGenres: [],
      prioritizeUnread: true,
      considerMood: true,
      preferShortWeekdays: false,
    });
    // A fresh copy every time (never the shared array).
    expect(defaultPreferences().favoriteGenres).not.toBe(defaultPreferences().favoriteGenres);
  });

  it('toggles genres, with no limit', () => {
    expect(toggleGenre([], 'poetry')).toEqual(['poetry']);
    expect(toggleGenre(['poetry', 'novel'], 'poetry')).toEqual(['novel']);
    const all = GENRE_KEYS.reduce((list, genre) => toggleGenre(list, genre), [] as GenreKey[]);
    expect(all).toEqual([...GENRE_KEYS]);
  });

  it('drops unknown keys and duplicates, keeping the canonical order', () => {
    expect(normalizeGenres(['poetry', 'sci-fi', 'novel', 'poetry', 7, null])).toEqual([
      'novel',
      'poetry',
    ]);
    expect(normalizeGenres('novel')).toEqual([]);
    expect(normalizePreferences({ favoriteGenres: ['x'], considerMood: 'yes' })).toEqual(
      DEFAULT_PREFERENCES,
    );
  });
});

describe('migration 4', () => {
  it('adds reading_preferences and the preferences queue entity, keeping queued entries', async () => {
    const db = createMemoryDatabase();
    // A device still on schema v3 with queued book and profile changes.
    for (const migration of MIGRATIONS.filter((m) => m.version <= 3)) {
      for (const statement of migration.statements) await db.execAsync(statement);
    }
    await db.execAsync('PRAGMA user_version = 3');
    await db.runAsync(
      "INSERT INTO sync_queue (entity, entity_id, operation, attempts, created_at, failed) VALUES ('book', 'b1', 'upsert', 2, '2026-10-01T00:00:00.000Z', 1)",
    );
    await db.runAsync(
      "INSERT INTO sync_queue (entity, entity_id, operation, created_at) VALUES ('profile', ?, 'upsert', '2026-10-02T00:00:00.000Z')",
      [USER],
    );

    // Later migrations run too; what v4 added must survive them.
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await listSyncQueue(db)).toMatchObject([
      { entity: 'book', entity_id: 'b1', attempts: 2, failed: 1 },
      { entity: 'profile', entity_id: USER },
    ]);
    await db.runAsync(
      "INSERT INTO sync_queue (entity, entity_id, operation, created_at) VALUES ('preferences', ?, 'upsert', '2026-10-03T00:00:00.000Z')",
      [USER],
    );
    await expect(
      db.runAsync(
        "INSERT INTO sync_queue (entity, entity_id, operation, created_at) VALUES ('shelf', 'x', 'upsert', 'now')",
      ),
    ).rejects.toThrow();
    await db.runAsync('INSERT INTO reading_preferences (user_id) VALUES (?)', [USER]);
    expect(await getLocalPreferences(db, USER)).toMatchObject({
      favorite_genres: '[]',
      prioritize_unread: 1,
      consider_mood: 1,
      prefer_short_weekdays: 0,
      updated_at: null,
      sync_state: 'synced',
    });

    // Idempotent: running again on every start changes nothing.
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(await listSyncQueue(db)).toHaveLength(3);
    // Its statements are safe to replay as well.
    for (const statement of MIGRATIONS[3].statements) await db.execAsync(statement);
    expect(await listSyncQueue(db)).toHaveLength(3);
    expect(await getLocalPreferences(db, USER)).not.toBeNull();
  });
});

async function setup({ server = fakePreferencesServer(USER) } = {}) {
  const opener = createMemoryOpener();
  const session = createLibrarySession({ open: (u) => openUserDatabase(u, opener) });
  await session.start(USER);
  const db = (await session.current())!.db;
  let clock = Date.parse('2026-10-11T10:00:00.000Z');
  const now = () => new Date(clock);
  const onWrite = jest.fn();
  const repo = createSqlitePreferencesRepository({ session, now, onWrite });
  const onPreferencesChange = jest.fn();
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
    preferences: server.gateway,
    recommendations: fakeRecommendationServer().gateway,
    covers: { upload: jest.fn(), downloadToLocal: jest.fn(), remove: jest.fn() },
    avatars: fakeAvatars().service,
    readingEvents: fakeReadingEventServer().gateway,
    network: { isOnline: async () => true, subscribe: () => () => undefined },
    now,
    random: () => 0,
    onPreferencesChange,
  });
  return {
    session,
    db,
    repo,
    engine,
    server,
    onWrite,
    onPreferencesChange,
    local: () => getLocalPreferences(db, USER),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('SqlitePreferencesRepository', () => {
  it('has nothing before the first save or pull', async () => {
    const t = await setup();
    await expect(t.repo.getPreferences(USER)).resolves.toEqual({ ok: true, data: null });
  });

  it('saves locally as pending and queues one coalesced entry', async () => {
    const t = await setup();
    const first = await t.repo.savePreferences(USER, prefs({ favoriteGenres: ['poetry'] }));
    expect(first).toEqual({
      ok: true,
      data: { preferences: prefs({ favoriteGenres: ['poetry'] }), pending: true },
    });
    t.advance(1000);
    await t.repo.savePreferences(USER, prefs({ favoriteGenres: ['poetry'], considerMood: false }));
    expect(await listSyncQueue(t.db)).toMatchObject([
      { entity: 'preferences', entity_id: USER, operation: 'upsert' },
    ]);
    expect(await t.local()).toMatchObject({
      favorite_genres: '["poetry"]',
      consider_mood: 0,
      sync_state: 'pending',
      local_updated_at: '2026-10-11T10:00:01.000Z',
    });
    await expect(t.repo.getPreferences(USER)).resolves.toEqual({
      ok: true,
      data: {
        preferences: prefs({ favoriteGenres: ['poetry'], considerMood: false }),
        pending: true,
      },
    });
    expect(t.onWrite).toHaveBeenCalledTimes(2);
  });

  it('never reads or writes another user', async () => {
    const t = await setup();
    await expect(t.repo.getPreferences(OTHER)).resolves.toEqual({ ok: false, error: 'not_found' });
    await expect(t.repo.savePreferences(OTHER, prefs())).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await listSyncQueue(t.db)).toEqual([]);
  });
});

describe('preferences sync', () => {
  it('pulls the server row into this device', async () => {
    const server = fakePreferencesServer(USER);
    server.setRemote({ favorite_genres: ['history', 'novel'], prefer_short_weekdays: true });
    const t = await setup({ server });
    await t.engine.syncNow();
    await expect(t.repo.getPreferences(USER)).resolves.toEqual({
      ok: true,
      data: {
        preferences: prefs({ favoriteGenres: ['novel', 'history'], preferShortWeekdays: true }),
        pending: false,
      },
    });
    expect(t.onPreferencesChange).toHaveBeenCalledTimes(1);
    expect(server.gateway.pushPreferences).not.toHaveBeenCalled();

    // Nothing new: no reload.
    await t.engine.syncNow();
    expect(t.onPreferencesChange).toHaveBeenCalledTimes(1);
  });

  it('without a server row, creates the defaults locally and pushes them', async () => {
    const t = await setup({ server: fakePreferencesServer(USER, null) });
    await t.engine.syncNow();
    expect(t.server.gateway.pushPreferences).toHaveBeenCalledWith(USER, {
      favorite_genres: [],
      prioritize_unread: true,
      consider_mood: true,
      prefer_short_weekdays: false,
    });
    expect(t.server.row).toMatchObject({ user_id: USER, consider_mood: true });
    expect(await t.local()).toMatchObject({
      sync_state: 'synced',
      updated_at: t.server.row!.updated_at,
    });
    expect(await listSyncQueue(t.db)).toEqual([]);
    expect(t.onPreferencesChange).toHaveBeenCalled();
  });

  it('without a server row, a local copy is pushed instead of the defaults', async () => {
    const t = await setup({ server: fakePreferencesServer(USER, null) });
    await t.repo.savePreferences(USER, prefs({ favoriteGenres: ['essay'] }));
    await t.engine.syncNow();
    expect(t.server.row).toMatchObject({ favorite_genres: ['essay'] });
  });

  it('pushes a local change and marks it synced with the server time', async () => {
    const t = await setup();
    await t.engine.syncNow();
    await t.repo.savePreferences(
      USER,
      prefs({ favoriteGenres: ['mystery'], prioritizeUnread: false }),
    );
    await t.engine.syncNow();
    expect(t.server.gateway.pushPreferences).toHaveBeenCalledWith(USER, {
      favorite_genres: ['mystery'],
      prioritize_unread: false,
      consider_mood: true,
      prefer_short_weekdays: false,
    });
    expect(await t.local()).toMatchObject({
      sync_state: 'synced',
      updated_at: t.server.row!.updated_at,
    });
    expect(await listSyncQueue(t.db)).toEqual([]);
  });

  it('a pending local change wins over a remote one until it is pushed', async () => {
    const t = await setup();
    await t.engine.syncNow();
    await t.repo.savePreferences(USER, prefs({ favoriteGenres: ['poetry'] }));
    // The push fails (no connection), and meanwhile the row changes on the server.
    t.server.gateway.pushPreferences.mockResolvedValueOnce({
      ok: false,
      cause: { message: 'Network request failed' },
    });
    t.server.setRemote({ favorite_genres: ['fantasy'] });
    await t.engine.syncNow();
    expect(await t.local()).toMatchObject({ favorite_genres: '["poetry"]', sync_state: 'pending' });
    expect(await listSyncQueue(t.db)).toMatchObject([
      { entity: 'preferences', attempts: 1, last_error_code: 'network_error' },
    ]);

    // Last write wins: once pushed, the local change replaces the server row.
    t.advance(10 * 60 * 1000);
    await t.engine.syncNow();
    expect(t.server.row).toMatchObject({ favorite_genres: ['poetry'] });
    expect(await t.local()).toMatchObject({ sync_state: 'synced' });
  });

  it('a change made on the server appears on the next sync when nothing is pending', async () => {
    const t = await setup();
    await t.engine.syncNow();
    t.server.setRemote({
      consider_mood: false,
      favorite_genres: ['biography', 'unknown'] as never,
    });
    await t.engine.syncNow();
    await expect(t.repo.getPreferences(USER)).resolves.toMatchObject({
      data: { preferences: prefs({ considerMood: false, favoriteGenres: ['biography'] }) },
    });
  });

  it('stops retrying permanent errors and keeps them visible', async () => {
    const t = await setup();
    await t.engine.syncNow();
    await t.repo.savePreferences(USER, prefs({ favoriteGenres: ['novel'] }));
    t.server.gateway.pushPreferences.mockResolvedValueOnce({
      ok: false,
      cause: { code: '42501', status: 403 },
    });
    await t.engine.syncNow();
    expect(await listSyncQueue(t.db)).toMatchObject([
      { entity: 'preferences', failed: 1, last_error_code: 'forbidden' },
    ]);
    expect(await t.local()).toMatchObject({ sync_state: 'pending' });

    await t.engine.retryFailed();
    expect(await listSyncQueue(t.db)).toEqual([]);
    expect(t.server.row).toMatchObject({ favorite_genres: ['novel'] });
  });

  it('a change made during the push stays pending and is pushed again', async () => {
    const t = await setup();
    await t.engine.syncNow();
    await t.repo.savePreferences(USER, prefs({ favoriteGenres: ['novel'] }));
    const push = t.server.gateway.pushPreferences.getMockImplementation()!;
    t.server.gateway.pushPreferences.mockImplementationOnce(async (user, patch) => {
      t.advance(1000);
      await t.repo.savePreferences(USER, prefs({ favoriteGenres: ['novel', 'essay'] }));
      return push(user, patch);
    });
    await t.engine.syncNow();
    expect(await t.local()).toMatchObject({ sync_state: 'pending' });
    await t.engine.syncNow();
    expect(t.server.row).toMatchObject({ favorite_genres: ['novel', 'essay'] });
    expect(await t.local()).toMatchObject({ sync_state: 'synced' });
  });
});
