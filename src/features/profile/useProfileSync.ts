import { useEffect } from 'react';

import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useThemeStore } from '@/stores/themeStore';

/**
 * Loads the profile whenever the signed-in user changes and applies the theme rule:
 * after sign-up the local theme is pushed to the profile; after sign-in the profile wins.
 * Clears profile data on sign-out. Mounted once in the root layout.
 */
export function useProfileSync(): void {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  useEffect(() => {
    const profileStore = useProfileStore.getState();
    if (!userId) {
      profileStore.clear();
      return;
    }
    let active = true;
    profileStore.load(userId).then((result) => {
      if (!active || !result.ok) return;
      const { themeSyncIntent, saveTheme, setThemeSyncIntent } = useProfileStore.getState();
      const theme = useThemeStore.getState();
      if (themeSyncIntent === 'push') {
        saveTheme(theme.mode);
      } else if (themeSyncIntent === 'pull' && result.data.theme !== theme.mode) {
        theme.setMode(result.data.theme);
      }
      setThemeSyncIntent('none');
    });
    return () => {
      active = false;
    };
  }, [userId]);
}
