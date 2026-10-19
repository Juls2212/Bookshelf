// Remote gateway for the profiles table, used only by the sync engine. RLS scopes every query
// to the signed-in user. The row is created by a server trigger at sign-up, so a push is an
// update (never an insert) and never sends updated_at (set by the server).
import {
  REMOTE_TIMEOUT_MS,
  toCause,
  withTimeout,
  type RemoteResult,
} from '@/features/library/supabaseBookGateway';
import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';
import type { ProfileRow } from '@/types/database';

const PROFILE_COLUMNS =
  'id, display_name, theme, avatar_path, avatar_updated_at, created_at, updated_at';

export type RemoteProfilePatch = Pick<
  ProfileRow,
  'display_name' | 'theme' | 'avatar_path' | 'avatar_updated_at'
>;

export interface ProfileSyncGateway {
  /** The user's profile row, or null if it does not exist (or RLS hides it). */
  pullProfile(userId: string): Promise<RemoteResult<ProfileRow | null>>;
  /** Updates name, theme and photo columns; returns the server row (with the new updated_at). */
  pushProfile(userId: string, patch: RemoteProfilePatch): Promise<RemoteResult<ProfileRow>>;
}

export function createSupabaseProfileGateway(
  getClient: () => AppSupabaseClient = getSupabaseClient,
  timeoutMs = REMOTE_TIMEOUT_MS,
): ProfileSyncGateway {
  return {
    pullProfile(userId) {
      return withTimeout(
        (async (): Promise<RemoteResult<ProfileRow | null>> => {
          try {
            const { data, error, status } = await getClient()
              .from('profiles')
              .select(PROFILE_COLUMNS)
              .eq('id', userId)
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

    pushProfile(userId, patch) {
      return withTimeout(
        (async (): Promise<RemoteResult<ProfileRow>> => {
          try {
            const { data, error, status } = await getClient()
              .from('profiles')
              .update({
                display_name: patch.display_name,
                theme: patch.theme,
                avatar_path: patch.avatar_path,
                avatar_updated_at: patch.avatar_updated_at,
              })
              .eq('id', userId)
              .select(PROFILE_COLUMNS)
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

export const supabaseProfileGateway = createSupabaseProfileGateway();
