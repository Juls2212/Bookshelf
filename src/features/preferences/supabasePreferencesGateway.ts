// Remote gateway for the reading_preferences table, used only by the sync engine. RLS scopes
// every query to the signed-in user. A server trigger creates the row at sign-up, but the push
// is an upsert so a missing row is created too. updated_at is never sent (set by the server).
import {
  REMOTE_TIMEOUT_MS,
  toCause,
  withTimeout,
  type RemoteResult,
} from '@/features/library/supabaseBookGateway';
import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';
import type { ReadingPreferencesRow } from '@/types/database';

const PREFERENCES_COLUMNS =
  'user_id, favorite_genres, prioritize_unread, consider_mood, prefer_short_weekdays, updated_at';

export type RemotePreferencesPatch = Omit<ReadingPreferencesRow, 'user_id' | 'updated_at'>;

export interface PreferencesSyncGateway {
  /** The user's row, or null if it does not exist (or RLS hides it). */
  pullPreferences(userId: string): Promise<RemoteResult<ReadingPreferencesRow | null>>;
  /** Creates or updates the row; returns the server row (with the new updated_at). */
  pushPreferences(
    userId: string,
    patch: RemotePreferencesPatch,
  ): Promise<RemoteResult<ReadingPreferencesRow>>;
}

function createSupabasePreferencesGateway(
  getClient: () => AppSupabaseClient = getSupabaseClient,
  timeoutMs = REMOTE_TIMEOUT_MS,
): PreferencesSyncGateway {
  return {
    pullPreferences(userId) {
      return withTimeout(
        (async (): Promise<RemoteResult<ReadingPreferencesRow | null>> => {
          try {
            const { data, error, status } = await getClient()
              .from('reading_preferences')
              .select(PREFERENCES_COLUMNS)
              .eq('user_id', userId)
              .maybeSingle();
            if (error) return { ok: false, cause: toCause(error, status) };
            return { ok: true, data: data ?? null };
          } catch (error) {
            return { ok: false, cause: toCause(error) };
          }
        })(),
        timeoutMs,
      );
    },

    pushPreferences(userId, patch) {
      return withTimeout(
        (async (): Promise<RemoteResult<ReadingPreferencesRow>> => {
          try {
            const { data, error, status } = await getClient()
              .from('reading_preferences')
              .upsert(
                {
                  user_id: userId,
                  favorite_genres: patch.favorite_genres,
                  prioritize_unread: patch.prioritize_unread,
                  consider_mood: patch.consider_mood,
                  prefer_short_weekdays: patch.prefer_short_weekdays,
                },
                { onConflict: 'user_id' },
              )
              .select(PREFERENCES_COLUMNS)
              .single();
            if (error || !data) return { ok: false, cause: toCause(error, status) };
            return { ok: true, data };
          } catch (error) {
            return { ok: false, cause: toCause(error) };
          }
        })(),
        timeoutMs,
      );
    },
  };
}

export const supabasePreferencesGateway = createSupabasePreferencesGateway();
