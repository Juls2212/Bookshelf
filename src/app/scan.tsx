import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { Icon } from '@/design/icons';
import { SchemeOverride } from '@/design/ThemeProvider';
import { sizes, spacing } from '@/design/tokens';
import { t } from '@/i18n';

// Placeholder: the camera screen is always dark. Replaced in the scan phase.
export default function ScanScreen() {
  const router = useRouter();
  return (
    <SchemeOverride scheme="dark">
      <StatusBar style="light" />
      <Screen texture={false} edges={['top', 'bottom', 'left', 'right']}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t.scan.close}
          style={styles.close}
        >
          <Icon name="x" size={sizes.iconLg} />
        </Pressable>
        <View style={styles.center}>
          <AppText variant="title" accessibilityRole="header">
            {t.scan.title}
          </AppText>
          <AppText variant="caption" style={styles.caption}>
            {t.scan.placeholder}
          </AppText>
        </View>
      </Screen>
    </SchemeOverride>
  );
}

const styles = StyleSheet.create({
  close: {
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.sm,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  caption: { textAlign: 'center' },
});
