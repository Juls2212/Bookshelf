// Local-first reading preferences: read from the user's SQLite database; edits are saved there,
// marked pending and queued (entity 'preferences', one coalesced entry) for the sync engine.
import { enqueuePreferencesUpsert } from '@/db/syncQueue';
import { librarySession, type LibrarySession } from '@/features/library/librarySession';
import { notifyLocalWrite } from '@/features/sync/localWrites';

import {
  getLocalPreferences,
  localRowToPreferences,
  writeLocalPreferences,
  type LocalPreferencesRow,
} from './localPreferences';
import type { PreferencesRepository, StoredPreferences } from './preferencesRepository';

type Deps = {
  session?: Pick<LibrarySession, 'current'>;
  now?: () => Date;
  /** Called after each successful local write (the sync engine schedules a push). */
  onWrite?: () => void;
};

const toStored = (row: LocalPreferencesRow): StoredPreferences => ({
  preferences: localRowToPreferences(row),
  pending: row.sync_state === 'pending',
});

export function createSqlitePreferencesRepository({
  session = librarySession,
  now = () => new Date(),
  onWrite = notifyLocalWrite,
}: Deps = {}): PreferencesRepository {
  /** The open database of `userId`, or null if another user (or nobody) is signed in. */
  const dbFor = async (userId: string) => {
    try {
      const active = await session.current();
      return active?.userId === userId ? active.db : null;
    } catch {
      return null;
    }
  };

  return {
    async getPreferences(userId) {
      const db = await dbFor(userId);
      if (!db) return { ok: false, error: 'not_found' };
      try {
        const row = await getLocalPreferences(db, userId);
        return { ok: true, data: row ? toStored(row) : null };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },

    async savePreferences(userId, preferences) {
      const db = await dbFor(userId);
      if (!db) return { ok: false, error: 'not_found' };
      try {
        const nowIso = now().toISOString();
        const row = await db.transaction(async (tx) => {
          await writeLocalPreferences(tx, userId, preferences, nowIso);
          await enqueuePreferencesUpsert(tx, userId, nowIso);
          return getLocalPreferences(tx, userId);
        });
        if (!row) return { ok: false, error: 'unknown' };
        onWrite();
        return { ok: true, data: toStored(row) };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },
  };
}

export const sqlitePreferencesRepository: PreferencesRepository =
  createSqlitePreferencesRepository();
