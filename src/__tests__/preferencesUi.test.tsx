// Preferences store (optimistic changes, rollback) and the Perfil preferences section.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import type {
  PreferencesRepository,
  PreferencesResult,
  StoredPreferences,
} from '@/features/preferences/preferencesRepository';
import { PreferencesSection } from '@/features/preferences/PreferencesSection';
import {
  defaultPreferences,
  type ReadingPreferences,
} from '@/features/preferences/preferencesRules';
import { t } from '@/i18n';
import { createPreferencesStore, usePreferencesStore } from '@/stores/preferencesStore';
import { useSyncStore } from '@/stores/syncStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
// The app store delegates to whichever fake repository the test installs.
const mockRepository: { current: PreferencesRepository | null } = { current: null };
jest.mock('@/features/preferences/sqlitePreferencesRepository', () => ({
  sqlitePreferencesRepository: {
    getPreferences: (userId: string) => mockRepository.current!.getPreferences(userId),
    savePreferences: (userId: string, preferences: ReadingPreferences) =>
      mockRepository.current!.savePreferences(userId, preferences),
  },
}));

const USER = 'user-1';

/** In-memory repository; `failNext` makes the next save fail. */
function fakeRepository(stored: StoredPreferences | null = null) {
  let current = stored;
  const state = { failNext: false };
  const repository: PreferencesRepository & {
    getPreferences: jest.Mock;
    savePreferences: jest.Mock;
  } = {
    getPreferences: jest.fn(async (): Promise<PreferencesResult<StoredPreferences | null>> => ({
      ok: true,
      data: current,
    })),
    savePreferences: jest.fn(
      async (
        _userId: string,
        preferences: ReadingPreferences,
      ): Promise<PreferencesResult<StoredPreferences>> => {
        if (state.failNext) {
          state.failNext = false;
          return { ok: false, error: 'unknown' };
        }
        current = { preferences, pending: true };
        return { ok: true, data: current };
      },
    ),
  };
  return {
    repository,
    state,
    /** The sync engine pushed the row. */
    markSynced() {
      if (current) current = { ...current, pending: false };
    },
  };
}

describe('preferences store', () => {
  it('loads the defaults while this device has no preferences', async () => {
    const store = createPreferencesStore(fakeRepository(null).repository);
    await store.getState().load(USER);
    expect(store.getState()).toMatchObject({
      userId: USER,
      status: 'ready',
      pending: false,
      preferences: defaultPreferences(),
    });
  });

  it('applies a change at once and saves it locally (pending until synced)', async () => {
    const fake = fakeRepository(null);
    const store = createPreferencesStore(fake.repository);
    await store.getState().load(USER);
    const saving = store.getState().toggleGenre('poetry');
    // Optimistic: visible before the save finishes.
    expect(store.getState().preferences.favoriteGenres).toEqual(['poetry']);
    await expect(saving).resolves.toBe(true);
    expect(store.getState().pending).toBe(true);
    await expect(store.getState().setOption('considerMood', false)).resolves.toBe(true);
    expect(fake.repository.savePreferences).toHaveBeenLastCalledWith(USER, {
      ...defaultPreferences(),
      favoriteGenres: ['poetry'],
      considerMood: false,
    });

    // After a sync the engine asks the store to reload: saved.
    fake.markSynced();
    await store.getState().load(USER);
    expect(store.getState().pending).toBe(false);
  });

  it('rolls back when the local save fails', async () => {
    const fake = fakeRepository({
      preferences: { ...defaultPreferences(), favoriteGenres: ['novel'] },
      pending: false,
    });
    const store = createPreferencesStore(fake.repository);
    await store.getState().load(USER);
    fake.state.failNext = true;
    await expect(store.getState().toggleGenre('novel')).resolves.toBe(false);
    expect(store.getState().preferences.favoriteGenres).toEqual(['novel']);
    expect(store.getState().pending).toBe(false);
  });

  it('saves changes in order, each with everything chosen so far', async () => {
    const fake = fakeRepository(null);
    const store = createPreferencesStore(fake.repository);
    await store.getState().load(USER);
    await Promise.all([
      store.getState().toggleGenre('essay'),
      store.getState().toggleGenre('history'),
      store.getState().setOption('preferShortWeekdays', true),
    ]);
    const saved = fake.repository.savePreferences.mock.calls.map(
      ([, p]: [string, ReadingPreferences]) => p,
    );
    // Genres are kept in the canonical order (history before essay).
    expect(saved.map((p) => p.favoriteGenres)).toEqual([
      ['essay'],
      ['history', 'essay'],
      ['history', 'essay'],
    ]);
    expect(saved[2].preferShortWeekdays).toBe(true);
    expect(store.getState().preferences).toEqual({
      ...defaultPreferences(),
      favoriteGenres: ['history', 'essay'],
      preferShortWeekdays: true,
    });
  });

  it('does nothing without a signed-in user', async () => {
    const fake = fakeRepository(null);
    const store = createPreferencesStore(fake.repository);
    await expect(store.getState().toggleGenre('novel')).resolves.toBe(false);
    expect(fake.repository.savePreferences).not.toHaveBeenCalled();
  });
});

describe('Perfil preferences section', () => {
  let fake: ReturnType<typeof fakeRepository>;

  async function renderSection(stored: StoredPreferences | null = null) {
    fake = fakeRepository(stored);
    mockRepository.current = fake.repository;
    usePreferencesStore.getState().clear();
    await usePreferencesStore.getState().load(USER);
    await render(
      <ThemeProvider>
        <ToastProvider>
          <PreferencesSection />
        </ToastProvider>
      </ThemeProvider>,
    );
  }

  afterEach(() => {
    usePreferencesStore.getState().clear();
    useSyncStore.setState({ status: 'idle' });
  });

  it('shows the 8 genres as checkboxes and the three switches with their descriptions', async () => {
    await renderSection({
      preferences: { ...defaultPreferences(), favoriteGenres: ['novel', 'chronicle'] },
      pending: false,
    });
    for (const label of Object.values(t.profile.genres)) {
      expect(screen.getByRole('checkbox', { name: label })).toBeOnTheScreen();
    }
    expect(screen.getByRole('checkbox', { name: t.profile.genres.novel })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: t.profile.genres.poetry })).not.toBeChecked();
    expect(
      screen.getByRole('switch', { name: t.profile.prefs.prioritizeUnread.title }),
    ).toBeChecked();
    expect(screen.getByRole('switch', { name: t.profile.prefs.considerMood.title })).toBeChecked();
    expect(
      screen.getByRole('switch', { name: t.profile.prefs.preferShortWeekdays.title }),
    ).not.toBeChecked();
    expect(screen.getByText(t.profile.prefs.preferShortWeekdays.text)).toBeOnTheScreen();
    expect(screen.getByLabelText(t.profile.prefsStatusA11y.saved)).toBeOnTheScreen();
  });

  it('a tap on a genre selects it at once and saves it (pending until synced)', async () => {
    await renderSection();
    await fireEvent.press(screen.getByRole('checkbox', { name: t.profile.genres.poetry }));
    expect(screen.getByRole('checkbox', { name: t.profile.genres.poetry })).toBeChecked();
    expect(fake.repository.savePreferences).toHaveBeenCalledWith(USER, {
      ...defaultPreferences(),
      favoriteGenres: ['poetry'],
    });
    expect(screen.getByText(t.profile.prefsStatus.pending)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('checkbox', { name: t.profile.genres.poetry }));
    expect(screen.getByRole('checkbox', { name: t.profile.genres.poetry })).not.toBeChecked();
  });

  it('toggling a switch saves it; offline the badge says so', async () => {
    await renderSection();
    await act(async () => useSyncStore.setState({ status: 'offline' }));
    await fireEvent(
      screen.getByRole('switch', { name: t.profile.prefs.preferShortWeekdays.title }),
      'valueChange',
      true,
    );
    expect(
      screen.getByRole('switch', { name: t.profile.prefs.preferShortWeekdays.title }),
    ).toBeChecked();
    expect(fake.repository.savePreferences).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ preferShortWeekdays: true }),
    );
    expect(screen.getByLabelText(t.profile.prefsStatusA11y.offline)).toBeOnTheScreen();
  });

  it('a failed save is rolled back with a Spanish toast', async () => {
    await renderSection();
    fake.state.failNext = true;
    await fireEvent.press(screen.getByRole('checkbox', { name: t.profile.genres.essay }));
    expect(screen.getByRole('checkbox', { name: t.profile.genres.essay })).not.toBeChecked();
    expect(await screen.findByText(t.profile.prefsSaveFailed)).toBeOnTheScreen();
  });
});
