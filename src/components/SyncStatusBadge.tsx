import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing, typeScale, type ColorToken } from '@/design/tokens';

export type SyncBadgeKind = 'synced' | 'syncing' | 'pending' | 'offline' | 'error';

// Every state has its own icon and text, so color is never the only signal.
const kindStyle: Record<SyncBadgeKind, { icon: IconName; color: ColorToken }> = {
  synced: { icon: 'check', color: 'success' },
  syncing: { icon: 'refresh', color: 'textSecondary' },
  pending: { icon: 'clock', color: 'accentText' },
  offline: { icon: 'cloud-off', color: 'textSecondary' },
  error: { icon: 'alert-circle', color: 'danger' },
};

type Props = {
  kind: SyncBadgeKind;
  label: string;
  accessibilityLabel: string;
  /** Makes the badge a button (e.g. retry in the error state). */
  onPress?: () => void;
  accessibilityHint?: string;
};

export function SyncStatusBadge({
  kind,
  label,
  accessibilityLabel,
  onPress,
  accessibilityHint,
}: Props) {
  const { colors } = useTheme();
  const s = kindStyle[kind];
  const color = colors[s.color];
  const badge = (
    <View style={[styles.badge, { borderColor: color }]}>
      <Icon name={s.icon} size={12} color={color} strokeWidth={2} />
      <Text style={[typeScale.tag, styles.text, { color }]}>{label}</Text>
    </View>
  );

  if (!onPress) {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={accessibilityLabel}
        accessibilityLiveRegion="polite"
        style={styles.wrap}
      >
        {badge}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityLiveRegion="polite"
      style={({ pressed }) => [styles.wrap, styles.touch, pressed && styles.pressed]}
    >
      {badge}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'flex-start' },
  // The visual badge stays small; the touch area is at least 44 x 44.
  touch: {
    minHeight: sizes.minTouchTarget,
    minWidth: sizes.minTouchTarget,
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
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
