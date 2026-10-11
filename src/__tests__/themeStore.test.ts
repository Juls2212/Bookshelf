import AsyncStorage from '@react-native-async-storage/async-storage';

import { THEME_STORAGE_KEY, useThemeStore } from '@/stores/themeStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(async () => {
  await AsyncStorage.clear();
  useThemeStore.setState({ mode: 'system' });
});

describe('themeStore', () => {
  it('defaults to system mode and marks itself hydrated', async () => {
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().mode).toBe('system');
    expect(useThemeStore.getState().hasHydrated).toBe(true);
  });

  it('persists the chosen mode (without the hydration flag)', async () => {
    useThemeStore.getState().setMode('dark');
    const raw = await AsyncStorage.getItem(THEME_STORAGE_KEY);
    expect(JSON.parse(raw ?? '{}')).toEqual({ state: { mode: 'dark' }, version: 1 });
  });

  it('restores the stored mode after a restart', async () => {
    await AsyncStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ state: { mode: 'light' }, version: 1 }),
    );
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().mode).toBe('light');
  });
});
