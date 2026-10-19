import { create } from 'zustand';

import type { LocalImage } from '@/features/library/coverService';
import { avatarService, type AvatarService } from '@/features/profile/avatarService';
import type { Profile, ProfileRepository, RepoResult } from '@/features/profile/profileRepository';
import { sqliteProfileRepository } from '@/features/profile/sqliteProfileRepository';
import type { ThemePreference } from '@/types/database';

/**
 * How the theme is reconciled the next time the profile loads:
 * `push` after sign-up (local theme -> profile), `pull` after sign-in (profile -> local),
 * `none` when an existing session is restored (keep the local choice).
 */
type ThemeSyncIntent = 'push' | 'pull' | 'none';

type ProfileState = {
  profile: Profile | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  themeSyncIntent: ThemeSyncIntent;
  setThemeSyncIntent: (intent: ThemeSyncIntent) => void;
  /** Reads the cached profile (offline-first; not_found until the first pull). */
  load: (userId: string) => Promise<RepoResult<Profile>>;
  updateDisplayName: (displayName: string) => Promise<RepoResult<Profile>>;
  /** Saved locally and synced later; the local theme store already changed. */
  saveTheme: (theme: ThemePreference) => Promise<void>;
  /** Crops (image.crop), resizes and saves the photo locally, then queues it. False on failure. */
  setAvatar: (image: LocalImage) => Promise<boolean>;
  /** Removes the photo locally and queues the remote removal. False on failure. */
  removeAvatar: () => Promise<boolean>;
  clear: () => void;
};

type AvatarFiles = Pick<AvatarService, 'prepare' | 'saveLocal' | 'removeLocal'>;

const notLoaded: RepoResult<never> = { ok: false, error: 'not_found' };

export function createProfileStore(
  repository: ProfileRepository,
  avatars: AvatarFiles = avatarService,
) {
  return create<ProfileState>()((set, get) => ({
    profile: null,
    status: 'idle',
    themeSyncIntent: 'none',

    setThemeSyncIntent: (themeSyncIntent) => set({ themeSyncIntent }),

    load: async (userId) => {
      if (!get().profile) set({ status: 'loading' });
      const result = await repository.getProfile(userId);
      if (result.ok) set({ profile: result.data, status: 'ready' });
      else set({ status: result.error === 'not_found' ? 'idle' : 'error' });
      return result;
    },

    updateDisplayName: async (displayName) => {
      const current = get().profile;
      if (!current) return notLoaded;
      const result = await repository.updateDisplayName(current.id, displayName);
      if (result.ok) set({ profile: result.data });
      return result;
    },

    saveTheme: async (theme) => {
      const current = get().profile;
      if (!current) return;
      set({ profile: { ...current, theme } });
      await repository.updateTheme(current.id, theme);
    },

    setAvatar: async (image) => {
      const current = get().profile;
      if (!current) return false;
      const prepared = await avatars.prepare(image);
      if (!prepared.ok) return false;
      const saved = await avatars.saveLocal(current.id, prepared.data);
      avatars.removeLocal(prepared.data); // the temporary render in the cache
      if (!saved.ok) return false;
      const result = await repository.setAvatar(current.id, saved.data);
      if (!result.ok) {
        avatars.removeLocal(saved.data);
        return false;
      }
      // The previous photo file is no longer used.
      if (current.avatarLocalUri && current.avatarLocalUri !== saved.data) {
        avatars.removeLocal(current.avatarLocalUri);
      }
      set({ profile: result.data });
      return true;
    },

    removeAvatar: async () => {
      const current = get().profile;
      if (!current) return false;
      const result = await repository.removeAvatar(current.id);
      if (!result.ok) return false;
      if (current.avatarLocalUri) avatars.removeLocal(current.avatarLocalUri);
      set({ profile: result.data });
      return true;
    },

    clear: () => set({ profile: null, status: 'idle', themeSyncIntent: 'none' }),
  }));
}

export const useProfileStore = createProfileStore(sqliteProfileRepository);
