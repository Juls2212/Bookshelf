// Reading preferences of the signed-in user. Every change is applied at once, saved locally
// (which queues it and schedules a sync) and rolled back if the local save fails.
import { create } from 'zustand';

import type {
  PreferencesRepository,
  PreferencesResult,
  StoredPreferences,
} from '@/features/preferences/preferencesRepository';
import {
  defaultPreferences,
  samePreferences,
  toggleGenre,
  type GenreKey,
  type PreferenceOption,
  type ReadingPreferences,
} from '@/features/preferences/preferencesRules';
import { sqlitePreferencesRepository } from '@/features/preferences/sqlitePreferencesRepository';

type PreferencesState = {
  userId: string | null;
  preferences: ReadingPreferences;
  /** Saved on this device but not yet synced. */
  pending: boolean;
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Reads the cached preferences (defaults while this device has none). */
  load: (userId: string) => Promise<void>;
  /** false when the change could not be saved (it was rolled back). */
  toggleGenre: (genre: GenreKey) => Promise<boolean>;
  setOption: (option: PreferenceOption, value: boolean) => Promise<boolean>;
  clear: () => void;
};

const initial = {
  userId: null,
  preferences: defaultPreferences(),
  pending: false,
  status: 'idle' as const,
};

export function createPreferencesStore(repository: PreferencesRepository) {
  /** Saves run one after another, so an older save never lands after a newer one. */
  let queue: Promise<unknown> = Promise.resolve();

  return create<PreferencesState>()((set, get) => {
    const change = (next: (current: ReadingPreferences) => ReadingPreferences) => {
      const { userId, preferences: before, pending: wasPending } = get();
      if (!userId) return Promise.resolve(false);
      const after = next(before);
      set({ preferences: after, pending: true });
      const save = queue.then(() => repository.savePreferences(userId, after));
      queue = save.catch(() => undefined);
      return save
        .catch((): PreferencesResult<StoredPreferences> => ({ ok: false, error: 'unknown' }))
        .then((result) => {
          // Ignore results for another user or that a newer change already replaced.
          if (get().userId !== userId || get().preferences !== after) return result.ok;
          if (result.ok)
            set({ preferences: result.data.preferences, pending: result.data.pending });
          else set({ preferences: before, pending: wasPending });
          return result.ok;
        });
    };

    return {
      ...initial,

      load: async (userId) => {
        if (get().userId !== userId) set({ ...initial, userId, status: 'loading' });
        const result = await repository.getPreferences(userId);
        if (get().userId !== userId) return;
        if (!result.ok) {
          set({ status: 'error' });
          return;
        }
        const stored = result.data;
        const preferences = stored?.preferences ?? defaultPreferences();
        // Keep the current object when nothing changed (no needless re-render).
        const current = get().preferences;
        set({
          preferences: samePreferences(current, preferences) ? current : preferences,
          pending: stored?.pending ?? false,
          status: 'ready',
        });
      },

      toggleGenre: (genre) =>
        change((current) => ({
          ...current,
          favoriteGenres: toggleGenre(current.favoriteGenres, genre),
        })),

      setOption: (option, value) => change((current) => ({ ...current, [option]: value })),

      clear: () => set({ ...initial, preferences: defaultPreferences() }),
    };
  });
}

export const usePreferencesStore = createPreferencesStore(sqlitePreferencesRepository);
