// In-memory stand-in for the reading_preferences table (one row per user), for sync tests.
import type {
  PreferencesSyncGateway,
  RemotePreferencesPatch,
} from '@/features/preferences/supabasePreferencesGateway';
import type { ReadingPreferencesRow } from '@/types/database';

const SERVER_DEFAULT_PREFERENCES: Omit<ReadingPreferencesRow, 'user_id' | 'updated_at'> = {
  favorite_genres: [],
  prioritize_unread: true,
  consider_mood: true,
  prefer_short_weekdays: false,
};

/** `row: null` simulates a user without a server row. Each push advances updated_at. */
export function fakePreferencesServer(
  userId: string,
  row: ReadingPreferencesRow | null = {
    user_id: userId,
    ...SERVER_DEFAULT_PREFERENCES,
    updated_at: '2026-10-01T00:00:00.000Z',
  },
) {
  let remote = row;
  let clock = Date.parse('2026-10-11T12:00:00.000Z');
  const gateway = {
    pullPreferences: jest.fn<
      ReturnType<PreferencesSyncGateway['pullPreferences']>,
      Parameters<PreferencesSyncGateway['pullPreferences']>
    >(async () => ({ ok: true, data: remote ? { ...remote } : null })),
    pushPreferences: jest.fn<
      ReturnType<PreferencesSyncGateway['pushPreferences']>,
      [string, RemotePreferencesPatch]
    >(async (user, patch) => {
      clock += 1000;
      remote = { user_id: user, ...patch, updated_at: new Date(clock).toISOString() };
      return { ok: true, data: { ...remote } };
    }),
  };
  return {
    gateway,
    get row() {
      return remote;
    },
    /** A change made elsewhere (e.g. the Supabase dashboard). */
    setRemote(patch: Partial<ReadingPreferencesRow>) {
      clock += 1000;
      remote = {
        user_id: userId,
        ...SERVER_DEFAULT_PREFERENCES,
        ...remote,
        ...patch,
        updated_at: new Date(clock).toISOString(),
      };
    },
  };
}
