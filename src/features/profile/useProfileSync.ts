import { useEffect } from 'react';

import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useThemeStore } from '@/stores/themeStore';

import type { Profile } from './profileRepository';

/**
 * Applies the theme rule when a profile becomes available or changes (cached or pulled):
 * after sign-up the local theme is pushed to the profile; otherwise the profile wins (it holds
 * the latest synced choice, and local edits are saved into it first, so they already match).
 */
function reconcileTheme(profile: Profile): void {
  const { themeSyncIntent, saveTheme, setThemeSyncIntent } = useProfileStore.getState();
  const theme = useThemeStore.getState();
  // Cleared first: saveTheme updates the profile, which calls this again.
  if (themeSyncIntent !== 'none') setThemeSyncIntent('none');
  if (themeSyncIntent === 'push') {
    if (profile.theme !== theme.mode) void saveTheme(theme.mode);
  } else if (profile.theme !== theme.mode) {
    theme.setMode(profile.theme);
  }
}

/**
 * Loads the cached profile whenever the signed-in user changes, reapplies the theme rule
 * whenever the profile changes (e.g. after the sync engine pulls it) and clears it on
 * sign-out. Mounted once in the root layout.
 */
export function useProfileSync(): void {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  useEffect(() => {
    const profileStore = useProfileStore.getState();
    if (!userId) {
      profileStore.clear();
      return;
    }
    const unsubscribe = useProfileStore.subscribe((state, previous) => {
      if (state.profile && state.profile !== previous.profile) reconcileTheme(state.profile);
    });
    void profileStore.load(userId);
    return unsubscribe;
  }, [userId]);
}
