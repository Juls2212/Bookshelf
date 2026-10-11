import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { useThemeStore, type ThemeMode } from '@/stores/themeStore';

import { palettes, type ColorScheme, type Palette } from './tokens';

export type Theme = {
  colors: Palette;
  scheme: ColorScheme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);
  const systemScheme = useColorScheme();

  useEffect(() => {
    // RN 0.86 uses 'unspecified' (not null) to return control to the system.
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }, [mode]);

  const scheme: ColorScheme =
    mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  return (
    <ThemeContext.Provider value={{ colors: palettes[scheme], scheme, mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Forces a scheme for a subtree (e.g. the always-dark camera screen). */
export function SchemeOverride({ scheme, children }: { scheme: ColorScheme; children: ReactNode }) {
  const parent = useTheme();
  return (
    <ThemeContext.Provider value={{ ...parent, colors: palettes[scheme], scheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside ThemeProvider');
  return theme;
}
