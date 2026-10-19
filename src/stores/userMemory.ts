// Everything kept in memory for the signed-in user. It is all cleared when the user signs out
// (or another account signs in), so a second person on the same device never sees the first
// one's books, profile, preferences, recommendations, sync state or cached answers.
// The SQLite files stay on the device (per user, closed on sign-out); this is only memory.
import { coverService } from '@/features/library/coverService';
import { avatarService } from '@/features/profile/avatarService';
import { supabaseBookSuggester } from '@/features/suggestions/supabaseBookSuggester';
import { EMPTY_SYNC_SNAPSHOT } from '@/features/sync/syncEngine';

import { useAuthStore } from './authStore';
import { useLibraryStore } from './libraryStore';
import { usePreferencesStore } from './preferencesStore';
import { useProfileStore } from './profileStore';
import { useRecommendationsStore } from './recommendationsStore';
import { useSyncStore } from './syncStore';

export function clearUserMemory(): void {
  useLibraryStore.getState().reset();
  useProfileStore.getState().clear();
  usePreferencesStore.getState().clear();
  useRecommendationsStore.getState().clear();
  useSyncStore.setState({ ...EMPTY_SYNC_SNAPSHOT });
  coverService.clearCache();
  avatarService.clearCache();
  supabaseBookSuggester.clearCache();
}

/** Clears the memory on sign-out and whenever the signed-in account changes. Returns unbind. */
export function bindUserMemoryToAuth(): () => void {
  return useAuthStore.subscribe((state, previous) => {
    const before = previous.user?.id ?? null;
    const now = state.user?.id ?? null;
    if (before !== null && before !== now) clearUserMemory();
  });
}
