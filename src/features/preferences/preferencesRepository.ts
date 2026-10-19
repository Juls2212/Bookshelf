// Reading preferences data access contract. The UI uses it (via the preferences store), never
// Supabase or SQLite. The app implementation is local-first (sqlitePreferencesRepository); the
// sync engine pushes and pulls the row with supabasePreferencesGateway.
import type { ReadingPreferences } from './preferencesRules';

export type StoredPreferences = {
  preferences: ReadingPreferences;
  /** Saved on this device but not yet synced. */
  pending: boolean;
};

export type PreferencesErrorCode = 'not_found' | 'unknown';

export type PreferencesResult<T> =
  { ok: true; data: T } | { ok: false; error: PreferencesErrorCode };

export interface PreferencesRepository {
  /** The cached preferences, or null while this device has none yet (defaults apply). */
  getPreferences(userId: string): Promise<PreferencesResult<StoredPreferences | null>>;
  /** Saves locally (creating the row if needed) and queues the change for sync. */
  savePreferences(
    userId: string,
    preferences: ReadingPreferences,
  ): Promise<PreferencesResult<StoredPreferences>>;
}
