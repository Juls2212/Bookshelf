import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/design/tokens';

import { AppText } from './AppText';
import { Screen } from './Screen';

type Props = {
  title: string;
  children?: ReactNode;
};

// Temporary placeholder; Phase 1 replaces every screen that uses it.
export function PlaceholderScreen({ title, children }: Props) {
  return (
    <Screen>
      <View style={styles.center}>
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        {children}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
});
