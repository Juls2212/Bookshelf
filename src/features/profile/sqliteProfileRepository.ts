// Local-first profile: reads the cached copy in the user's SQLite database; edits are saved
// there, marked pending and queued (entity 'profile') for the sync engine.
import { enqueueAvatarChange, enqueueProfileUpsert } from '@/db/syncQueue';
import { librarySession, type LibrarySession } from '@/features/library/librarySession';
import { notifyLocalWrite } from '@/features/sync/localWrites';
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { cleanLine, truncateChars } from '@/lib/inputSanitizers';
import type { ThemePreference } from '@/types/database';

import { avatarPathFor } from './avatarPath';

import { getLocalProfile, localRowToProfile } from './localProfile';
import type { Profile, ProfileRepository, RepoResult } from './profileRepository';

type Deps = {
  session?: Pick<LibrarySession, 'current'>;
  now?: () => Date;
  /** Called after each successful local write (the sync engine schedules a push). */
  onWrite?: () => void;
};

export function createSqliteProfileRepository({
  session = librarySession,
  now = () => new Date(),
  onWrite = notifyLocalWrite,
}: Deps = {}): ProfileRepository {
  /** The open database of `userId`, or null if another user (or nobody) is signed in. */
  const dbFor = async (userId: string) => {
    try {
      const active = await session.current();
      return active?.userId === userId ? active.db : null;
    } catch {
      return null;
    }
  };

  const write = async (
    userId: string,
    patch: { display_name: string } | { theme: ThemePreference },
  ): Promise<RepoResult<Profile>> => {
    const db = await dbFor(userId);
    if (!db) return { ok: false, error: 'not_found' };
    try {
      const [column, value] = Object.entries(patch)[0] as [string, string];
      const nowIso = now().toISOString();
      const row = await db.transaction(async (tx) => {
        // The column name comes from the fixed patch keys above, never from user input.
        const result = await tx.runAsync(
          `UPDATE profile SET ${column} = ?, sync_state = 'pending', local_updated_at = ?
           WHERE id = ?`,
          [value, nowIso, userId],
        );
        if (result.changes === 0) return null;
        await enqueueProfileUpsert(tx, userId, nowIso);
        return getLocalProfile(tx, userId);
      });
      if (!row) return { ok: false, error: 'not_found' };
      onWrite();
      return { ok: true, data: localRowToProfile(row) };
    } catch {
      return { ok: false, error: 'unknown' };
    }
  };

  /** Photo set or removed: the change time doubles as the photo's version (avatar_updated_at). */
  const writeAvatar = async (
    userId: string,
    operation: 'avatar_upload' | 'avatar_remove',
    avatar: { localUri: string | null; path: string | null },
  ): Promise<RepoResult<Profile>> => {
    const db = await dbFor(userId);
    if (!db) return { ok: false, error: 'not_found' };
    try {
      const nowIso = now().toISOString();
      const row = await db.transaction(async (tx) => {
        const result = await tx.runAsync(
          `UPDATE profile SET avatar_local_uri = ?, avatar_path = ?, avatar_updated_at = ?,
             sync_state = 'pending', local_updated_at = ?
           WHERE id = ?`,
          [avatar.localUri, avatar.path, nowIso, nowIso, userId],
        );
        if (result.changes === 0) return null;
        await enqueueAvatarChange(tx, userId, operation, nowIso);
        return getLocalProfile(tx, userId);
      });
      if (!row) return { ok: false, error: 'not_found' };
      onWrite();
      return { ok: true, data: localRowToProfile(row) };
    } catch {
      return { ok: false, error: 'unknown' };
    }
  };

  return {
    async getProfile(userId) {
      const db = await dbFor(userId);
      if (!db) return { ok: false, error: 'not_found' };
      try {
        const row = await getLocalProfile(db, userId);
        return row ? { ok: true, data: localRowToProfile(row) } : { ok: false, error: 'not_found' };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },

    updateDisplayName: (userId, displayName) =>
      write(userId, {
        display_name: truncateChars(cleanLine(displayName), INPUT_LIMITS.displayName),
      }),

    updateTheme: (userId, theme) => write(userId, { theme }),

    setAvatar: (userId, localUri) =>
      writeAvatar(userId, 'avatar_upload', {
        localUri,
        path: avatarPathFor(userId),
      }),

    removeAvatar: (userId) => writeAvatar(userId, 'avatar_remove', { localUri: null, path: null }),
  };
}

export const sqliteProfileRepository: ProfileRepository = createSqliteProfileRepository();
