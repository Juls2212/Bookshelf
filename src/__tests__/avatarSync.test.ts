import { openUserDatabase } from '@/db/database';
import { getUserVersion, migrate, MIGRATIONS, SCHEMA_VERSION } from '@/db/schema';
import { enqueueAvatarChange, listSyncQueue } from '@/db/syncQueue';
import { createLibrarySession } from '@/features/library/librarySession';
import {
  AVATAR_JPEG_QUALITY,
  AVATAR_SIZE,
  avatarPixelCrop,
  createAvatarService,
} from '@/features/profile/avatarService';
import { getLocalProfile, isRemoteAvatarNewer, timestampMs } from '@/features/profile/localProfile';
import { createSqliteProfileRepository } from '@/features/profile/sqliteProfileRepository';
import type { RemoteProfilePatch } from '@/features/profile/supabaseProfileGateway';
import { createSyncEngine } from '@/features/sync/syncEngine';
import { createProfileStore } from '@/stores/profileStore';
import { fakeAvatars } from '@/test-utils/fakeAvatars';
import { fakeReadingEventServer } from '@/test-utils/fakeReadingEventServer';
import { fakePreferencesServer } from '@/test-utils/fakePreferencesServer';
import { fakeRecommendationServer } from '@/test-utils/fakeRecommendationServer';
import { createMemoryDatabase, createMemoryOpener } from '@/test-utils/nodeSqlite';
import type { ProfileRow } from '@/types/database';

const mockManipulator = {
  crop: jest.fn(),
  resize: jest.fn(),
  save: jest.fn(),
};

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Directory: jest.fn(), Paths: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => {
  // A decoded 4000x3000 photo; crop/resize are recorded, the saved JPEG is 512x512.
  const context = {
    renderAsync: async () => ({
      width: 4000,
      height: 3000,
      saveAsync: async (options: unknown) => {
        mockManipulator.save(options);
        return { uri: 'file:///cache/avatar.jpg', width: 512, height: 512 };
      },
    }),
    crop: (rect: unknown) => (mockManipulator.crop(rect), context),
    resize: (size: unknown) => (mockManipulator.resize(size), context),
  };
  return {
    ImageManipulator: { manipulate: () => context },
    SaveFormat: { JPEG: 'jpeg' },
  };
});
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const AVATAR_PATH = `${USER}/avatar.jpg`;

describe('local migration 7', () => {
  it('adds the photo columns and avatar queue operations, keeping data; idempotent', async () => {
    const db = createMemoryDatabase();
    for (const migration of MIGRATIONS.filter((m) => m.version <= 6)) {
      for (const statement of migration.statements) await db.execAsync(statement);
    }
    await db.execAsync('PRAGMA user_version = 6');
    await db.runAsync(
      "INSERT INTO profile (id, display_name, created_at, updated_at) VALUES (?, 'Ana', 'x', 'y')",
      [USER],
    );
    await db.runAsync(
      "INSERT INTO sync_queue (entity, entity_id, operation, attempts, created_at) VALUES ('profile', ?, 'upsert', 3, 'z')",
      [USER],
    );

    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(await getLocalProfile(db, USER)).toMatchObject({
      display_name: 'Ana',
      avatar_local_uri: null,
      avatar_path: null,
      avatar_updated_at: null,
    });
    expect(await listSyncQueue(db)).toMatchObject([{ operation: 'upsert', attempts: 3 }]);
    await db.runAsync(
      "INSERT INTO sync_queue (entity, entity_id, operation, created_at) VALUES ('profile', ?, 'avatar_upload', 'z')",
      [USER],
    );
    await expect(
      db.runAsync(
        "INSERT INTO sync_queue (entity, entity_id, operation, created_at) VALUES ('profile', ?, 'avatar_crop', 'z')",
        [USER],
      ),
    ).rejects.toThrow();
  });
});

describe('avatar queue', () => {
  it('upload and removal supersede each other, and both queue the profile row', async () => {
    const db = createMemoryDatabase();
    await migrate(db);
    await enqueueAvatarChange(db, USER, 'avatar_upload', '2026-10-12T10:00:00.000Z');
    await enqueueAvatarChange(db, USER, 'avatar_remove', '2026-10-12T10:01:00.000Z');
    expect((await listSyncQueue(db)).map((e) => e.operation).sort()).toEqual([
      'avatar_remove',
      'upsert',
    ]);
    await enqueueAvatarChange(db, USER, 'avatar_upload', '2026-10-12T10:02:00.000Z');
    expect((await listSyncQueue(db)).map((e) => e.operation).sort()).toEqual([
      'avatar_upload',
      'upsert',
    ]);
  });
});

describe('photo crop', () => {
  it('a square crop in whole pixels (the smaller side wins, centered)', () => {
    expect(
      avatarPixelCrop({ x: 0.25, y: 0, width: 0.5, height: 1 }, { width: 4000, height: 3000 }),
    ).toEqual({ originX: 1000, originY: 500, width: 2000, height: 2000 });
    const square = avatarPixelCrop(
      { x: 0.1, y: 0.1, width: 0.333, height: 0.444 },
      { width: 3000, height: 2250 },
    );
    expect(square.width).toBe(square.height);
  });

  it('prepare renders the crop at 512x512 as JPEG quality 0.8', async () => {
    const service = createAvatarService();
    const result = await service.prepare({
      uri: 'file:///photo.jpg',
      width: 4000,
      height: 3000,
      crop: { x: 0.125, y: 0, width: 0.75, height: 1 },
    });
    expect(result).toEqual({ ok: true, data: 'file:///cache/avatar.jpg' });
    expect(mockManipulator.crop).toHaveBeenCalledWith({
      originX: 500,
      originY: 0,
      width: 3000,
      height: 3000,
    });
    expect(mockManipulator.resize).toHaveBeenCalledWith({
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
    });
    expect(AVATAR_SIZE).toBe(512);
    expect(mockManipulator.save).toHaveBeenCalledWith({
      format: 'jpeg',
      compress: AVATAR_JPEG_QUALITY,
    });
    expect(AVATAR_JPEG_QUALITY).toBe(0.8);
  });
});

describe('timestamps', () => {
  it('reads SQLite and Postgres formats alike (microseconds, +00:00)', () => {
    expect(timestampMs('2026-10-11T10:00:00.123456+00:00')).toBe(
      timestampMs('2026-10-11T10:00:00.123Z'),
    );
    expect(timestampMs(null)).toBeNull();
    expect(
      isRemoteAvatarNewer('2026-10-11T10:00:00.000000+00:00', '2026-10-11T10:00:00.000Z'),
    ).toBe(false);
    expect(isRemoteAvatarNewer('2026-10-11T10:00:01+00:00', '2026-10-11T10:00:00.000Z')).toBe(true);
    expect(isRemoteAvatarNewer('2026-10-11T10:00:00Z', null)).toBe(true);
    expect(isRemoteAvatarNewer(null, '2026-10-11T10:00:00Z')).toBe(false);
  });
});

function remoteProfileServer() {
  let clock = Date.parse('2026-10-11T12:00:00.000Z');
  let remote: ProfileRow = {
    id: USER,
    display_name: 'Ana',
    theme: 'system',
    avatar_path: null,
    avatar_updated_at: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };
  const gateway = {
    pullProfile: jest.fn(async () => ({ ok: true as const, data: { ...remote } })),
    pushProfile: jest.fn(async (_userId: string, patch: RemoteProfilePatch) => {
      clock += 1000;
      remote = { ...remote, ...patch, updated_at: new Date(clock).toISOString() };
      return { ok: true as const, data: { ...remote } };
    }),
  };
  /** An edit made on another device (the server sets updated_at). */
  const edit = (patch: Partial<ProfileRow>) => {
    clock += 1000;
    remote = { ...remote, ...patch, updated_at: new Date(clock).toISOString() };
  };
  return { gateway, edit, current: () => remote };
}

async function setup() {
  const opener = createMemoryOpener();
  const session = createLibrarySession({ open: (u) => openUserDatabase(u, opener) });
  await session.start(USER);
  const db = (await session.current())!.db;
  let clock = Date.parse('2026-10-12T10:00:00.000Z');
  const now = () => new Date(clock);
  const server = remoteProfileServer();
  const avatars = fakeAvatars();
  const calls: string[] = [];
  avatars.service.upload.mockImplementation(async (userId: string, localUri: string) => {
    calls.push('upload');
    avatars.stored.set(`${userId}/avatar.jpg`, localUri);
    return { ok: true as const, data: `${userId}/avatar.jpg` };
  });
  server.gateway.pushProfile.mockImplementation(
    ((push) => async (userId: string, patch: RemoteProfilePatch) => {
      calls.push('profile');
      return push(userId, patch);
    })(server.gateway.pushProfile.getMockImplementation()!),
  );
  const onProfileChange = jest.fn();
  const engine = createSyncEngine({
    session,
    gateway: {
      upsertBook: jest.fn(),
      pullChangedSince: jest.fn(async () => ({ ok: true as const, data: [] })),
      pullPage: jest.fn(async () => ({ ok: true as const, data: [] })),
      refreshSession: jest.fn(async () => true),
    },
    profiles: server.gateway,
    preferences: fakePreferencesServer(USER).gateway,
    recommendations: fakeRecommendationServer().gateway,
    covers: { upload: jest.fn(), downloadToLocal: jest.fn(), remove: jest.fn() },
    avatars: avatars.service,
    readingEvents: fakeReadingEventServer().gateway,
    network: { isOnline: async () => true, subscribe: () => () => undefined },
    now,
    random: () => 0,
    onProfileChange,
  });
  const repo = createSqliteProfileRepository({ session, now, onWrite: jest.fn() });
  await engine.syncNow(); // first pull: the profile row exists locally
  return {
    db,
    engine,
    server,
    avatars,
    repo,
    calls,
    onProfileChange,
    local: () => getLocalProfile(db, USER),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('avatar sync', () => {
  it('uploads the photo first, then pushes its path and time with the profile', async () => {
    const t = await setup();
    const saved = await t.repo.setAvatar(USER, 'file:///documents/avatars/u/avatar_1.jpg');
    expect(saved).toMatchObject({
      ok: true,
      data: { avatarPath: AVATAR_PATH, avatarLocalUri: 'file:///documents/avatars/u/avatar_1.jpg' },
    });
    t.calls.length = 0;
    await t.engine.syncNow();
    expect(t.calls).toEqual(['upload', 'profile']);
    expect(t.server.current()).toMatchObject({
      avatar_path: AVATAR_PATH,
      avatar_updated_at: '2026-10-12T10:00:00.000Z',
    });
    expect(await listSyncQueue(t.db)).toEqual([]);
    expect(await t.local()).toMatchObject({
      sync_state: 'synced',
      avatar_local_uri: 'file:///documents/avatars/u/avatar_1.jpg',
    });
  });

  it('a failed upload keeps the profile row waiting (never points at a missing photo)', async () => {
    const t = await setup();
    t.avatars.service.upload.mockResolvedValueOnce({
      ok: false,
      error: 'network_error',
      cause: new TypeError('Network request failed'),
    } as never);
    await t.repo.setAvatar(USER, 'file:///a.jpg');
    t.server.gateway.pushProfile.mockClear();
    await t.engine.syncNow();
    expect(t.server.gateway.pushProfile).not.toHaveBeenCalled();
    expect((await listSyncQueue(t.db)).map((e) => e.operation).sort()).toEqual([
      'avatar_upload',
      'upsert',
    ]);
  });

  it('removal deletes the remote photo and nulls the columns', async () => {
    const t = await setup();
    await t.repo.setAvatar(USER, 'file:///a.jpg');
    await t.engine.syncNow();
    t.advance(60_000);
    const removed = await t.repo.removeAvatar(USER);
    expect(removed).toMatchObject({ ok: true, data: { avatarPath: null, avatarLocalUri: null } });
    await t.engine.syncNow();
    expect(t.avatars.service.remove).toHaveBeenCalledWith(USER);
    expect(t.avatars.stored.size).toBe(0);
    expect(t.server.current()).toMatchObject({ avatar_path: null });
    expect(await listSyncQueue(t.db)).toEqual([]);
  });

  it('downloads a newer photo from another device, once, and drops the old file', async () => {
    const t = await setup();
    t.avatars.stored.set(AVATAR_PATH, 'remote');
    t.server.edit({
      avatar_path: AVATAR_PATH,
      avatar_updated_at: '2026-10-12T09:00:00.123456+00:00',
    });
    await t.engine.syncNow();
    const first = await t.local();
    expect(first?.avatar_local_uri).toMatch(/avatar_download_1\.jpg$/);
    expect(t.avatars.service.pruneLocal).toHaveBeenLastCalledWith(USER, first?.avatar_local_uri);
    expect(t.onProfileChange).toHaveBeenCalled();

    // Same photo again (another field changed): no new download.
    t.server.edit({ display_name: 'Ana María' });
    await t.engine.syncNow();
    expect(t.avatars.service.downloadToLocal).toHaveBeenCalledTimes(1);

    // A newer photo replaces it.
    t.server.edit({ avatar_updated_at: '2026-10-12T11:00:00+00:00' });
    await t.engine.syncNow();
    expect(t.avatars.service.downloadToLocal).toHaveBeenCalledTimes(2);
    expect((await t.local())?.avatar_local_uri).toMatch(/avatar_download_2\.jpg$/);
    expect(t.avatars.localFiles.size).toBe(1);

    // Removed on the other device: the local copy goes too.
    t.server.edit({ avatar_path: null, avatar_updated_at: '2026-10-12T12:00:00+00:00' });
    await t.engine.syncNow();
    expect((await t.local())?.avatar_local_uri).toBeNull();
    expect(t.avatars.localFiles.size).toBe(0);
  });

  it('a pending local photo wins over a newer remote one', async () => {
    const t = await setup();
    t.avatars.service.upload.mockResolvedValue({
      ok: false,
      error: 'network_error',
      cause: new TypeError('Network request failed'),
    } as never);
    await t.repo.setAvatar(USER, 'file:///mine.jpg');
    t.avatars.stored.set(AVATAR_PATH, 'theirs');
    t.server.edit({ avatar_path: AVATAR_PATH, avatar_updated_at: '2026-10-13T00:00:00+00:00' });
    await t.engine.syncNow();
    expect(t.avatars.service.downloadToLocal).not.toHaveBeenCalled();
    expect(await t.local()).toMatchObject({
      sync_state: 'pending',
      avatar_local_uri: 'file:///mine.jpg',
    });
  });
});

describe('profile store photo actions', () => {
  function storeWith(previousUri: string | null) {
    const profile = {
      id: USER,
      displayName: 'Ana',
      theme: 'system' as const,
      avatarPath: previousUri ? AVATAR_PATH : null,
      avatarLocalUri: previousUri,
      avatarUpdatedAt: null,
      createdAt: 'x',
    };
    const repository = {
      getProfile: jest.fn(),
      updateDisplayName: jest.fn(),
      updateTheme: jest.fn(),
      setAvatar: jest.fn(async (_userId: string, localUri: string) => ({
        ok: true as const,
        data: { ...profile, avatarPath: AVATAR_PATH, avatarLocalUri: localUri },
      })),
      removeAvatar: jest.fn(async () => ({
        ok: true as const,
        data: { ...profile, avatarPath: null, avatarLocalUri: null },
      })),
    };
    const avatars = {
      prepare: jest.fn(async () => ({ ok: true as const, data: 'file:///cache/render.jpg' })),
      saveLocal: jest.fn(async () => ({
        ok: true as const,
        data: 'file:///documents/avatars/u/avatar_2.jpg',
      })),
      removeLocal: jest.fn(),
    };
    const store = createProfileStore(repository, avatars);
    store.setState({ profile });
    return { store, repository, avatars };
  }

  it('saves the new photo and deletes the previous file and the temporary render', async () => {
    const s = storeWith('file:///documents/avatars/u/avatar_1.jpg');
    await expect(
      s.store.getState().setAvatar({ uri: 'file:///photo.jpg', width: 10, height: 10 }),
    ).resolves.toBe(true);
    expect(s.repository.setAvatar).toHaveBeenCalledWith(
      USER,
      'file:///documents/avatars/u/avatar_2.jpg',
    );
    expect(s.avatars.removeLocal).toHaveBeenCalledWith('file:///cache/render.jpg');
    expect(s.avatars.removeLocal).toHaveBeenCalledWith('file:///documents/avatars/u/avatar_1.jpg');
    expect(s.store.getState().profile?.avatarLocalUri).toBe(
      'file:///documents/avatars/u/avatar_2.jpg',
    );
  });

  it('reports a failed render without touching the profile', async () => {
    const s = storeWith(null);
    s.avatars.prepare.mockResolvedValueOnce({ ok: false, error: 'unknown' } as never);
    await expect(
      s.store.getState().setAvatar({ uri: 'file:///photo.jpg', width: 10, height: 10 }),
    ).resolves.toBe(false);
    expect(s.repository.setAvatar).not.toHaveBeenCalled();
  });

  it('removing deletes the local file', async () => {
    const s = storeWith('file:///documents/avatars/u/avatar_1.jpg');
    await expect(s.store.getState().removeAvatar()).resolves.toBe(true);
    expect(s.avatars.removeLocal).toHaveBeenCalledWith('file:///documents/avatars/u/avatar_1.jpg');
    expect(s.store.getState().profile?.avatarPath).toBeNull();
  });
});
