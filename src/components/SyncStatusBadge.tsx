import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing, typeScale, type ColorToken } from '@/design/tokens';
import { t } from '@/i18n';

export type SyncStatus = keyof typeof t.sync;

const statusStyle: Record<SyncStatus, { icon: IconName; color: ColorToken }> = {
  syncing: { icon: 'refresh', color: 'textSecondary' },
  synced: { icon: 'check', color: 'success' },
  error: { icon: 'alert-circle', color: 'danger' },
};

// Static badge; real sync state arrives with the data layer.
export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const { colors } = useTheme();
  const s = statusStyle[status];
  const color = colors[s.color];
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={t.sync[status]}
      style={[styles.badge, { borderColor: color }]}
    >
      <Icon name={s.icon} size={12} color={color} strokeWidth={2} />
      <Text style={[typeScale.tag, styles.text, { color }]}>{t.sync[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: sizes.borderWidth,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs + 1,
  },
  text: { textTransform: 'uppercase' },
});
