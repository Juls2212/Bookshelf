import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing } from '@/design/tokens';

/** Form-level error (e.g. wrong credentials), announced to screen readers. */
export function FormError({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.box, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]}
    >
      <Icon name="alert-circle" size={sizes.iconSm} color={colors.danger} />
      <AppText variant="caption" color="danger" style={styles.text}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: sizes.borderWidth,
    borderRadius: radii.field,
    padding: spacing.md,
  },
  text: { flex: 1 },
});
