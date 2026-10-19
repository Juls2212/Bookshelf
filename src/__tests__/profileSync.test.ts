import { databaseNameFor, deleteUserDatabase, openUserDatabase } from '@/db/database';
import { getUserVersion, migrate, MIGRATIONS, SCHEMA_VERSION } from '@/db/schema';
import { getMeta, listSyncQueue } from '@/db/syncQueue';
import { createLibrarySession } from '@/features/library/librarySession';
import { createSqliteBookRepository } from '@/features/library/sqliteBookRepository';
import { getLocalProfile } from '@/features/profile/localProfile';
import { createSqliteProfileRepository } from '@/features/profile/sqliteProfileRepository';
import type { RemoteProfilePatch } from '@/features/profile/supabaseProfileGateway';
import { createSignOutFlow } from '@/features/sync/signOutFlow';
import { createSyncEngine, type SyncSnapshot } from '@/features/sync/syncEngine';
import { fakeAvatars } from '@/test-utils/fakeAvatars';
import { fakeReadingEventServer } from '@/test-utils/fakeReadingEventServer';
import { fakePreferencesServer } from '@/test-utils/fakePreferencesServer';
import { fakeRecommendationServer } from '@/test-utils/fakeRecommendationServer';
import { createMemoryDatabase, createMemoryOpener } from '@/test-utils/nodeSqlite';
import type { ProfileRow, UserBookRow } from '@/types/database';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Directory: jest.fn(), Paths: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

describe('migration 3', () => {
  it('adds the profile cache and the profile queue entity, keeping queued entries', async () => {
    const db = createMemoryDatabase();
    // A device still on schema v2 with one queued book change.
    for (const migration of MIGRATIONS.filter((m) => m.version <= 2)) {
      for (const statement of migration.statements) await db.execAsync(statement);
    }
    await db.execAsync('PRAGMA user_version = 2');
    await db.runAsync(
      "INSERT INTO sync_queue (entity, entity_id, operation, attempts, created_at, failed) VALUES ('book', 'b1', 'upsert', 2, '2026-10-01T00:00:00.000Z', 1)",
    );

    // Later migrations run too; what v3 added must survive them.
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await listSyncQueue(db)).toMatchObject([
      { entity: 'book', entity_id: 'b1', operation: 'upsert', attempts: 2, failed: 1 },
    ]);
    await db.runAsync(
      "INSERT INTO sync_queue (entity, entity_id, operation, created_at) VALUES ('profile', ?, 'upsert', '2026-10-02T00:00:00.000Z')",
      [USER],
    );
    await expect(
      db.runAsync(
        "INSERT INTO sync_queue (entity, entity_id, operation, created_at) VALUES ('shelf', 'x', 'upsert', 'now')",
      ),
    ).rejects.toThrow();

    // Idempotent: running again on every start changes nothing.
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(await listSyncQueue(db)).toHaveLength(2);
  });
});

const serverProfile = (overrides: Partial<ProfileRow> = {}): ProfileRow => ({
  id: USER,
  display_name: 'Ana',
  theme: 'system',
  avatar_path: null,
  avatar_updated_at: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

function fakeNetwork(initial: boolean) {
  let online = initial;
  const listeners = new Set<(online: boolean) => void>();
  return {
    isOnline: async () => online,
    subscribe: (listener: (value: boolean) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (value: boolean) => {
      online = value;
      listeners.forEach((l) => l(value));
    },
  };
}

async function setup({ online = true, remoteBooks = [] as UserBookRow[] } = {}) {
  const opener = createMemoryOpener();
  const session = createLibrarySession({ open: (u) => openUserDatabase(u, opener) });
  await session.start(USER);
  const db = (await session.current())!.db;
  let clock = Date.parse('2026-10-11T10:00:00.000Z');
  const now = () => new Date(clock);
  let serverClock = Date.parse('2026-10-11T12:00:00.000Z');
  let remote = serverProfile();
  const profiles = {
    pullProfile: jest.fn(async () => ({ ok: true as const, data: remote })),
    pushProfile: jest.fn(async (_userId: string, patch: RemoteProfilePatch) => {
      serverClock += 1000;
      remote = { ...remote, ...patch, updated_at: new Date(serverClock).toISOString() };
      return { ok: true as const, data: remote };
    }),
  };
  const gateway = {
    upsertBook: jest.fn(),
    pullChangedSince: jest.fn(async () => ({ ok: true as const, data: [] })),
    pullPage: jest.fn(async () => ({ ok: true as const, data: remoteBooks })),
    refreshSession: jest.fn(async () => true),
  };
  const network = fakeNetwork(online);
  const snapshots: SyncSnapshot[] = [];
  const onRemoteChanges = jest.fn();
  const onProfileChange = jest.fn();
  const preferences = fakePreferencesServer(USER).gateway;
  const engine = createSyncEngine({
    session,
    gateway,
    profiles,
    preferences,
    recommendations: fakeRecommendationServer().gateway,
    covers: { upload: jest.fn(), downloadToLocal: jest.fn(), remove: jest.fn() },
    avatars: fakeAvatars().service,
    readingEvents: fakeReadingEventServer().gateway,
    network,
    now,
    onSnapshot: (s) => snapshots.push(s),
    onRemoteChanges,
    onProfileChange,
  });
  const onWrite = jest.fn();
  const repo = createSqliteProfileRepository({ session, now, onWrite });
  return {
    opener,
    session,
    db,
    engine,
    network,
    profiles,
    preferences,
    gateway,
    repo,
    onWrite,
    onRemoteChanges,
    onProfileChange,
    last: () => snapshots[snapshots.length - 1],
    remoteEdit: (patch: Partial<ProfileRow>) => {
      serverClock += 1000;
      remote = { ...remote, ...patch, updated_at: new Date(serverClock).toISOString() };
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('offline profile', () => {
  it('caches the pulled profile and reads it offline', async () => {
    const t = await setup();
    expect(await t.repo.getProfile(USER)).toEqual({ ok: false, error: 'not_found' });
    await t.engine.syncNow();
    expect(t.onProfileChange).toHaveBeenCalledTimes(1);

    t.network.set(false);
    expect(await t.repo.getProfile(USER)).toEqual({
      ok: true,
      data: {
        id: USER,
        displayName: 'Ana',
        theme: 'system',
        avatarPath: null,
        avatarLocalUri: null,
        avatarUpdatedAt: null,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    });
    // The same server version again is not a change.
    t.network.set(true);
    await t.engine.syncNow();
    expect(t.onProfileChange).toHaveBeenCalledTimes(1);
  });

  it('renames offline, queues the change and pushes it when the connection returns', async () => {
    const t = await setup();
    await t.engine.syncNow();
    t.network.set(false);

    const result = await t.repo.updateDisplayName(USER, '  Ana María ');
    expect(result).toMatchObject({ ok: true, data: { displayName: 'Ana María' } });
    expect(t.onWrite).toHaveBeenCalled();
    await t.repo.updateTheme(USER, 'dark');
    expect(await listSyncQueue(t.db)).toMatchObject([
      { entity: 'profile', entity_id: USER, operation: 'upsert' },
    ]);

    await t.engine.syncNow();
    expect(t.profiles.pushProfile).not.toHaveBeenCalled();
    expect(t.last()).toMatchObject({ status: 'offline', pendingCount: 1 });

    t.network.set(true);
    await t.engine.syncNow();
    expect(t.profiles.pushProfile).toHaveBeenCalledWith(USER, {
      display_name: 'Ana María',
      theme: 'dark',
      avatar_path: null,
      avatar_updated_at: null,
    });
    expect(await getLocalProfile(t.db, USER)).toMatchObject({
      display_name: 'Ana María',
      sync_state: 'synced',
    });
    expect(t.last()).toMatchObject({ status: 'idle', pendingCount: 0 });
  });

  it('keeps a pending local profile over a remote change until it is pushed (then last write wins)', async () => {
    const t = await setup();
    await t.engine.syncNow();
    t.network.set(false);
    await t.repo.updateDisplayName(USER, 'Local');
    t.remoteEdit({ display_name: 'Other device' });
    t.profiles.pushProfile.mockResolvedValueOnce({
      ok: false,
      cause: { message: 'Network request failed' },
    } as never);

    t.network.set(true);
    await t.engine.syncNow(); // push fails (network), pull must not overwrite the pending row
    expect(await getLocalProfile(t.db, USER)).toMatchObject({
      display_name: 'Local',
      sync_state: 'pending',
    });

    t.advance(60 * 60 * 1000);
    await t.engine.syncNow();
    expect(await getLocalProfile(t.db, USER)).toMatchObject({
      display_name: 'Local',
      sync_state: 'synced',
    });
  });

  it('applies remote profile changes when nothing is pending', async () => {
    const t = await setup();
    await t.engine.syncNow();
    t.remoteEdit({ theme: 'dark' });
    await t.engine.syncNow();
    expect(await getLocalProfile(t.db, USER)).toMatchObject({ theme: 'dark' });
    expect(t.onProfileChange).toHaveBeenCalledTimes(2);
  });
});

describe('first run offline', () => {
  it('reports the missing first download and resumes it when the connection returns', async () => {
    const book = { id: 'r1', updated_at: '2026-10-05T00:00:00.000Z' } as UserBookRow;
    const remoteBooks: UserBookRow[] = [
      {
        ...book,
        user_id: USER,
        title: 'Remote',
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
        deleted_at: null,
      },
    ];
    const t = await setup({ online: false, remoteBooks });
    t.engine.start();
    await t.engine.syncNow();
    expect(t.last()).toMatchObject({ status: 'offline', initialPullDone: false });
    expect(t.gateway.pullPage).not.toHaveBeenCalled();

    t.network.set(true); // connectivity restored -> sync
    await t.engine.syncNow();
    expect(t.gateway.pullPage).toHaveBeenCalled();
    expect(t.onRemoteChanges).toHaveBeenCalled();
    expect(t.last()).toMatchObject({ status: 'idle', initialPullDone: true });
    t.engine.stop();
    expect(t.last()).toMatchObject({ status: 'idle', initialPullDone: null, pendingCount: 0 });
  });

  it('remembers the last successful sync across app starts', async () => {
    const t = await setup();
    await t.engine.syncNow();
    expect(t.last().lastSyncAt).toBe('2026-10-11T10:00:00.000Z');
    expect(await getMeta(t.db, 'last_sync_at')).toBe('2026-10-11T10:00:00.000Z');

    const snapshots: SyncSnapshot[] = [];
    const restarted = createSyncEngine({
      session: t.session,
      gateway: t.gateway,
      profiles: t.profiles,
      preferences: t.preferences,
      recommendations: fakeRecommendationServer().gateway,
      covers: { upload: jest.fn(), downloadToLocal: jest.fn(), remove: jest.fn() },
      avatars: fakeAvatars().service,
      readingEvents: fakeReadingEventServer().gateway,
      network: fakeNetwork(false),
      onSnapshot: (s) => snapshots.push(s),
    });
    await restarted.syncNow();
    expect(snapshots[snapshots.length - 1]).toMatchObject({
      status: 'offline',
      lastSyncAt: '2026-10-11T10:00:00.000Z',
    });
  });
});

describe('sign-out flow', () => {
  async function signOutSetup({ finalSyncClears = false } = {}) {
    const opener = createMemoryOpener();
    const session = createLibrarySession({ open: (u) => openUserDatabase(u, opener) });
    await session.start(USER);
    let ids = 0;
    const books = createSqliteBookRepository({ session, newId: () => `b${++ids}` });
    const deps = {
      session,
      syncNow: jest.fn(async () => {
        if (!finalSyncClears) return;
        await (await session.current())!.db.runAsync('DELETE FROM sync_queue');
      }),
      signOut: jest.fn(async () => ({ ok: true as const, data: null })),
      stopEngine: jest.fn(),
      deleteDatabase: jest.fn(async (userId: string) => {
        opener.files.delete(databaseNameFor(userId));
        return true;
      }),
      deleteCovers: jest.fn(() => true),
      deleteAvatars: jest.fn(() => true),
    };
    return { opener, session, books, deps, flow: createSignOutFlow(deps) };
  }

  it('with nothing to sync: signs out, stops the engine, closes and deletes local data', async () => {
    const s = await signOutSetup();
    expect(await s.flow.prepare()).toBe('clean');
    expect(s.deps.syncNow).not.toHaveBeenCalled();
    expect(await s.flow.signOut()).toEqual({ ok: true, data: null });
    expect(s.deps.stopEngine).toHaveBeenCalled();
    expect(await s.session.current()).toBeNull();
    expect(s.deps.deleteDatabase).toHaveBeenCalledWith(USER);
    expect(s.deps.deleteCovers).toHaveBeenCalledWith(USER);
    expect(s.deps.deleteAvatars).toHaveBeenCalledWith(USER);
    expect(s.opener.files.size).toBe(0);
  });

  it('tries a final sync; if it clears the queue, the sign-out is clean', async () => {
    const s = await signOutSetup({ finalSyncClears: true });
    await s.books.create({ title: 'Pending', pageCount: 200 });
    expect(await s.flow.prepare()).toBe('clean');
    expect(s.deps.syncNow).toHaveBeenCalledTimes(1);
  });

  it('with changes left: asks to confirm and, once confirmed, keeps the files for the same user', async () => {
    const s = await signOutSetup();
    await s.books.create({ title: 'Unsynced', pageCount: 200 });
    expect(await s.flow.prepare()).toBe('unsynced');
    expect(s.deps.syncNow).toHaveBeenCalledTimes(1);

    await s.flow.signOut();
    expect(s.deps.signOut).toHaveBeenCalled();
    expect(s.deps.deleteDatabase).not.toHaveBeenCalled();
    expect(s.deps.deleteCovers).not.toHaveBeenCalled();
    expect(s.deps.deleteAvatars).not.toHaveBeenCalled();

    // Signing in again as the same user: the pending change is still there to sync.
    await s.session.start(USER);
    const db = (await s.session.current())!.db;
    expect(await listSyncQueue(db)).toHaveLength(1);
  });

  it('keeps everything when the sign-out itself fails', async () => {
    const s = await signOutSetup();
    s.deps.signOut.mockResolvedValueOnce({ ok: false, error: 'unknown' } as never);
    expect(await s.flow.signOut()).toEqual({ ok: false, error: 'unknown' });
    expect(s.deps.stopEngine).not.toHaveBeenCalled();
    expect(await s.session.current()).not.toBeNull();
    expect(s.deps.deleteDatabase).not.toHaveBeenCalled();
    expect(s.deps.deleteAvatars).not.toHaveBeenCalled();
  });

  it('deleteUserDatabase deletes the user file and never throws', async () => {
    const deleter = jest.fn(async () => undefined);
    expect(await deleteUserDatabase(USER, deleter)).toBe(true);
    expect(deleter).toHaveBeenCalledWith(databaseNameFor(USER));
    expect(
      await deleteUserDatabase(USER, async () => {
        throw new Error('missing');
      }),
    ).toBe(false);
  });
});
