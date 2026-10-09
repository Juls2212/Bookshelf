import type { ReactNode } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';

// Temporary placeholder colors; Phase 1 replaces them with the design system.
const placeholderColors = {
  light: { background: '#FFFFFF', text: '#111111' },
  dark: { background: '#111111', text: '#F5F5F5' },
} as const;

type Props = {
  title: string;
  children?: ReactNode;
};

export function PlaceholderScreen({ title, children }: Props) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = placeholderColors[scheme];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function usePlaceholderTextColor(): string {
  return placeholderColors[useColorScheme() === 'dark' ? 'dark' : 'light'].text;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
});
