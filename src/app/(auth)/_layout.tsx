import { Stack } from 'expo-router';

import { useTheme } from '@/design/ThemeProvider';

// Signed-out area. The root layout only mounts this group while there is no session.
export default function AuthLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
    </Stack>
  );
}
