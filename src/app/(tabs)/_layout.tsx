import { Tabs } from 'expo-router/js-tabs';

import { t } from '@/i18n';

// Temporary plain tabs; Phase 1 replaces them.
export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: t.tabs.home }} />
      <Tabs.Screen name="library" options={{ title: t.tabs.library }} />
      <Tabs.Screen name="scan" options={{ title: t.tabs.scan }} />
      <Tabs.Screen name="librarian" options={{ title: t.tabs.librarian }} />
      <Tabs.Screen name="profile" options={{ title: t.tabs.profile }} />
    </Tabs>
  );
}
