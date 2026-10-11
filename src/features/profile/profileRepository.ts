// Profile data access. The UI uses this repository (via the profile store), never Supabase.
import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';
import type { ProfileRow, ThemePreference } from '@/types/database';

export type Profile = {
  id: string;
  displayName: string | null;
  theme: ThemePreference;
  createdAt: string;
};

export type ProfileErrorCode = 'not_found' | 'network_error' | 'unknown';

export type RepoResult<T> = { ok: true; data: T } | { ok: false; error: ProfileErrorCode };

export interface ProfileRepository {
  getProfile(userId: string): Promise<RepoResult<Profile>>;
  updateDisplayName(userId: string, displayName: string): Promise<RepoResult<Profile>>;
  updateTheme(userId: string, theme: ThemePreference): Promise<RepoResult<null>>;
}

const PROFILE_COLUMNS = 'id, display_name, theme, created_at, updated_at';

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    theme: row.theme,
    createdAt: row.created_at,
  };
}

/** Maps PostgREST/fetch errors to internal codes without exposing them. */
export function mapProfileError(error: unknown): ProfileErrorCode {
  if (error === null || typeof error !== 'object') return 'unknown';
  const e = error as { name?: unknown; message?: unknown; code?: unknown };
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  if (
    e.name === 'AbortError' ||
    message.includes('network request failed') ||
    message.includes('failed to fetch')
  ) {
    return 'network_error';
  }
  if (e.code === 'PGRST116') return 'not_found';
  return 'unknown';
}

export function createSupabaseProfileRepository(
  getClient: () => AppSupabaseClient = getSupabaseClient,
): ProfileRepository {
  return {
    async getProfile(userId) {
      try {
        const { data, error } = await getClient()
          .from('profiles')
          .select(PROFILE_COLUMNS)
          .eq('id', userId)
          .maybeSingle();
        if (error) return { ok: false, error: mapProfileError(error) };
        if (!data) return { ok: false, error: 'not_found' };
        return { ok: true, data: toProfile(data) };
      } catch (error) {
        return { ok: false, error: mapProfileError(error) };
      }
    },

    async updateDisplayName(userId, displayName) {
      try {
        const { data, error } = await getClient()
          .from('profiles')
          .update({ display_name: displayName.trim() })
          .eq('id', userId)
          .select(PROFILE_COLUMNS)
          .maybeSingle();
        if (error) return { ok: false, error: mapProfileError(error) };
        if (!data) return { ok: false, error: 'not_found' };
        return { ok: true, data: toProfile(data) };
      } catch (error) {
        return { ok: false, error: mapProfileError(error) };
      }
    },

    async updateTheme(userId, theme) {
      try {
        const { error } = await getClient().from('profiles').update({ theme }).eq('id', userId);
        return error ? { ok: false, error: mapProfileError(error) } : { ok: true, data: null };
      } catch (error) {
        return { ok: false, error: mapProfileError(error) };
      }
    },
  };
}

export const profileRepository: ProfileRepository = createSupabaseProfileRepository();
