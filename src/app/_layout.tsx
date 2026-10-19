import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from '@expo-google-fonts/hanken-grotesk';
import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from '@expo-google-fonts/instrument-serif';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ToastProvider } from '@/components/Toast';
import { ThemeProvider, useTheme } from '@/design/ThemeProvider';
import { palettes } from '@/design/tokens';
import { useProfileSync } from '@/features/profile/useProfileSync';
import { useSyncLifecycle } from '@/features/sync/syncRuntime';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { bindUserMemoryToAuth } from '@/stores/userMemory';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Splash may already be hidden (e.g. fast refresh); nothing to do.
});

function ThemedStack() {
  const { colors, scheme } = useTheme();
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  useProfileSync();
  useSyncLifecycle();
  useEffect(() => bindUserMemoryToAuth(), []);
  return (
    <>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
      >
        {/* Route guard: the app only while signed in, the auth group only while signed out. */}
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          {/* Full-screen routes outside the tabs, so no tab bar is shown. */}
          <Stack.Screen
            name="scan"
            options={{
              presentation: 'fullScreenModal',
              contentStyle: { backgroundColor: palettes.dark.background },
            }}
          />
          <Stack.Screen name="book/new" />
          <Stack.Screen name="book/[id]" />
          <Stack.Screen name="book/edit/[id]" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Screen name="dev-gallery" />
      </Stack>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
  });
  const themeHydrated = useThemeStore((state) => state.hasHydrated);
  const authReady = useAuthStore((state) => state.status !== 'loading');
  // On a font error we continue with system fonts instead of blocking the app.
  const ready = (fontsLoaded || fontError !== null) && themeHydrated && authReady;

  useEffect(() => {
    useAuthStore.getState().initialize();
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    // Required by react-native-gesture-handler (draggable reading progress).
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider>
        <ToastProvider>
          <ThemedStack />
        </ToastProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
