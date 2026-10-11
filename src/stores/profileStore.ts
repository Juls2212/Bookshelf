import { create } from 'zustand';

import {
  profileRepository,
  type Profile,
  type RepoResult,
} from '@/features/profile/profileRepository';
import type { ThemePreference } from '@/types/database';

/**
 * How the theme is reconciled the next time the profile loads:
 * `push` after sign-up (local theme -> profile), `pull` after sign-in (profile -> local),
 * `none` when an existing session is restored (keep the local choice).
 */
export type ThemeSyncIntent = 'push' | 'pull' | 'none';

type ProfileState = {
  profile: Profile | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  themeSyncIntent: ThemeSyncIntent;
  setThemeSyncIntent: (intent: ThemeSyncIntent) => void;
  load: (userId: string) => Promise<RepoResult<Profile>>;
  updateDisplayName: (displayName: string) => Promise<RepoResult<Profile>>;
  /** Best-effort: failures are ignored on purpose (the local theme already changed). */
  saveTheme: (theme: ThemePreference) => Promise<void>;
  clear: () => void;
};

const notLoaded: RepoResult<never> = { ok: false, error: 'not_found' };

export const useProfileStore = create<ProfileState>()((set, get) => ({
  profile: null,
  status: 'idle',
  themeSyncIntent: 'none',

  setThemeSyncIntent: (themeSyncIntent) => set({ themeSyncIntent }),

  load: async (userId) => {
    set({ status: 'loading' });
    const result = await profileRepository.getProfile(userId);
    if (result.ok) set({ profile: result.data, status: 'ready' });
    else set({ status: 'error' });
    return result;
  },

  updateDisplayName: async (displayName) => {
    const current = get().profile;
    if (!current) return notLoaded;
    const result = await profileRepository.updateDisplayName(current.id, displayName);
    if (result.ok) set({ profile: result.data });
    return result;
  },

  saveTheme: async (theme) => {
    const current = get().profile;
    if (!current) return;
    set({ profile: { ...current, theme } });
    await profileRepository.updateTheme(current.id, theme);
  },

  clear: () => set({ profile: null, status: 'idle', themeSyncIntent: 'none' }),
}));
