// Local reading preferences row (SQLite table `reading_preferences`, schema v4) and its mapping.
import type { SqlExecutor } from '@/db/sql';
import type { ReadingPreferencesRow } from '@/types/database';

import {
  defaultPreferences,
  normalizeGenres,
  normalizePreferences,
  type ReadingPreferences,
} from './preferencesRules';

export type LocalPreferencesRow = {
  user_id: string;
  /** JSON array of genre keys. */
  favorite_genres: string;
  prioritize_unread: number;
  consider_mood: number;
  prefer_short_weekdays: number;
  /** Server updated_at; null until synced once. */
  updated_at: string | null;
  sync_state: 'synced' | 'pending';
  local_updated_at: string | null;
};

function parseGenres(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

export function localRowToPreferences(row: LocalPreferencesRow): ReadingPreferences {
  return normalizePreferences({
    favoriteGenres: parseGenres(row.favorite_genres),
    prioritizeUnread: row.prioritize_unread === 1,
    considerMood: row.consider_mood === 1,
    preferShortWeekdays: row.prefer_short_weekdays === 1,
  });
}

/** Remote (server) row -> preferences; unknown genres from the server are dropped. */
function remoteRowToPreferences(row: ReadingPreferencesRow): ReadingPreferences {
  return normalizePreferences({
    favoriteGenres: row.favorite_genres,
    prioritizeUnread: row.prioritize_unread,
    considerMood: row.consider_mood,
    preferShortWeekdays: row.prefer_short_weekdays,
  });
}

/** Column values for SQLite, in the order of the INSERT statements below. */
function columns(preferences: ReadingPreferences): [string, number, number, number] {
  return [
    JSON.stringify(normalizeGenres(preferences.favoriteGenres)),
    preferences.prioritizeUnread ? 1 : 0,
    preferences.considerMood ? 1 : 0,
    preferences.preferShortWeekdays ? 1 : 0,
  ];
}

export function getLocalPreferences(
  db: SqlExecutor,
  userId: string,
): Promise<LocalPreferencesRow | null> {
  return db.getFirstAsync<LocalPreferencesRow>(
    'SELECT * FROM reading_preferences WHERE user_id = ?',
    [userId],
  );
}

/** Saves a local edit: the row (created if missing) becomes pending. */
export async function writeLocalPreferences(
  tx: SqlExecutor,
  userId: string,
  preferences: ReadingPreferences,
  nowIso: string,
): Promise<void> {
  await tx.runAsync(
    `INSERT INTO reading_preferences (user_id, favorite_genres, prioritize_unread, consider_mood,
       prefer_short_weekdays, sync_state, local_updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)
     ON CONFLICT (user_id) DO UPDATE SET favorite_genres = excluded.favorite_genres,
       prioritize_unread = excluded.prioritize_unread, consider_mood = excluded.consider_mood,
       prefer_short_weekdays = excluded.prefer_short_weekdays, sync_state = 'pending',
       local_updated_at = excluded.local_updated_at`,
    [userId, ...columns(preferences), nowIso],
  );
}

/**
 * The server has no row: keep the local copy (or create the defaults) and mark it pending, so
 * the push creates the server row.
 */
export async function ensurePendingPreferences(
  tx: SqlExecutor,
  userId: string,
  nowIso: string,
): Promise<void> {
  const current = await getLocalPreferences(tx, userId);
  const preferences = current ? localRowToPreferences(current) : defaultPreferences();
  await writeLocalPreferences(tx, userId, preferences, nowIso);
}

/**
 * Stores the server preferences unless the local copy has unsynced changes (local edits win
 * until pushed) or it is already the same version. Returns the number of rows written.
 */
export async function upsertRemotePreferences(
  tx: SqlExecutor,
  row: ReadingPreferencesRow,
): Promise<number> {
  const result = await tx.runAsync(
    `INSERT INTO reading_preferences (user_id, favorite_genres, prioritize_unread, consider_mood,
       prefer_short_weekdays, updated_at, sync_state)
     VALUES (?, ?, ?, ?, ?, ?, 'synced')
     ON CONFLICT (user_id) DO UPDATE SET favorite_genres = excluded.favorite_genres,
       prioritize_unread = excluded.prioritize_unread, consider_mood = excluded.consider_mood,
       prefer_short_weekdays = excluded.prefer_short_weekdays, updated_at = excluded.updated_at,
       sync_state = 'synced'
     WHERE reading_preferences.sync_state <> 'pending'
       AND reading_preferences.updated_at IS NOT excluded.updated_at`,
    [row.user_id, ...columns(remoteRowToPreferences(row)), row.updated_at],
  );
  return result.changes;
}
