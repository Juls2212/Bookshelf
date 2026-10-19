import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing } from '@/design/tokens';
import { t } from '@/i18n';

/**
 * First run without connection: nothing to show yet. Loading resumes on its own when the
 * connection returns (the sync engine pulls and the library store refreshes).
 */
export function FirstRunOffline() {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.card, { borderColor: colors.border }]}
      accessibilityLiveRegion="polite"
      testID="first-run-offline"
    >
      <Icon name="cloud-off" size={28} color={colors.textSecondary} />
      <AppText variant="heading" accessibilityRole="header">
        {t.library.firstRunOfflineTitle}
      </AppText>
      <AppText variant="body" color="textSecondary">
        {t.library.firstRunOffline}
      </AppText>
      <AppText variant="caption">{t.library.firstRunOfflineHint}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: sizes.borderWidth,
    borderRadius: radii.surface,
    padding: spacing.lg + spacing.xs,
    gap: spacing.sm,
  },
});
