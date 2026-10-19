// Local profile row (SQLite table `profile`, schema v3, avatar columns since v7) and its mapping.
import type { SqlExecutor } from '@/db/sql';
import type { ProfileRow } from '@/types/database';

import type { Profile } from './profileRepository';

type LocalProfileRow = ProfileRow & {
  /** The photo file on this device (null: none, or not downloaded yet). */
  avatar_local_uri: string | null;
  sync_state: 'synced' | 'pending';
  local_updated_at: string | null;
};

export function localRowToProfile(row: LocalProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    theme: row.theme,
    avatarPath: row.avatar_path,
    avatarLocalUri: row.avatar_local_uri,
    avatarUpdatedAt: row.avatar_updated_at,
    createdAt: row.created_at,
  };
}

export function getLocalProfile(db: SqlExecutor, userId: string): Promise<LocalProfileRow | null> {
  return db.getFirstAsync<LocalProfileRow>('SELECT * FROM profile WHERE id = ?', [userId]);
}

/**
 * Milliseconds of an ISO timestamp from SQLite or Postgres. Postgres sends microseconds and a
 * "+00:00" offset, which not every JS engine parses; the fraction is cut to milliseconds.
 * Null for missing or unreadable values.
 */
export function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(ms) ? null : ms;
}

/** True when the server's photo is newer than the one this device has. */
export function isRemoteAvatarNewer(
  remoteUpdatedAt: string | null,
  localUpdatedAt: string | null,
): boolean {
  const remote = timestampMs(remoteUpdatedAt);
  if (remote === null) return false;
  const local = timestampMs(localUpdatedAt);
  return local === null || remote > local;
}

/**
 * Stores the server profile unless the local copy has unsynced changes (local edits win until
 * pushed) or it is already the same version. The local photo file is kept only while it still
 * shows the server's photo: a newer (or removed) remote photo clears avatar_local_uri, so the
 * sync engine downloads the new one. Returns the number of rows written.
 */
export async function upsertRemoteProfile(tx: SqlExecutor, row: ProfileRow): Promise<number> {
  const local = await getLocalProfile(tx, row.id);
  const keepLocalFile =
    row.avatar_path !== null &&
    !isRemoteAvatarNewer(row.avatar_updated_at, local?.avatar_updated_at ?? null);
  const result = await tx.runAsync(
    `INSERT INTO profile (id, display_name, theme, avatar_path, avatar_updated_at, created_at,
       updated_at, sync_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'synced')
     ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name,
       theme = excluded.theme, avatar_path = excluded.avatar_path,
       avatar_updated_at = excluded.avatar_updated_at,
       avatar_local_uri = CASE WHEN ? = 1 THEN profile.avatar_local_uri ELSE NULL END,
       created_at = excluded.created_at, updated_at = excluded.updated_at, sync_state = 'synced'
     WHERE profile.sync_state <> 'pending' AND profile.updated_at <> excluded.updated_at`,
    [
      row.id,
      row.display_name,
      row.theme,
      row.avatar_path,
      row.avatar_updated_at,
      row.created_at,
      row.updated_at,
      keepLocalFile ? 1 : 0,
    ],
  );
  return result.changes;
}
