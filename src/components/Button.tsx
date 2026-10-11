import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing, typeScale, type ColorToken } from '@/design/tokens';
import { t } from '@/i18n';

/** `ghost` / `ghostDanger`: plain icon + text actions without a box (e.g. "Eliminar libro"). */
export type ButtonVariant =
  'primary' | 'secondary' | 'destructive' | 'link' | 'ghost' | 'ghostDanger';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

type VariantStyle = { background?: ColorToken; border?: ColorToken; text: ColorToken };

const variantStyles: Record<ButtonVariant, VariantStyle> = {
  primary: { background: 'actionPrimary', text: 'actionPrimaryText' },
  secondary: { border: 'textPrimary', text: 'textPrimary' },
  destructive: { background: 'dangerSoft', border: 'danger', text: 'danger' },
  link: { text: 'accentText' },
  ghost: { text: 'textPrimary' },
  ghostDanger: { text: 'danger' },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
  accessibilityHint,
  testID,
}: Props) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const isLink = variant === 'link';
  const isPlain = isLink || variant === 'ghost' || variant === 'ghostDanger';
  const v = variantStyles[variant];
  const textColor = disabled && !isPlain ? colors.disabledText : colors[v.text];

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole={isLink ? 'link' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        !isPlain && styles.boxed,
        v.background && { backgroundColor: colors[v.background] },
        v.border && { borderColor: colors[v.border], borderWidth: sizes.borderWidth },
        disabled && !isPlain && { backgroundColor: colors.disabledSurface, borderWidth: 0 },
        disabled && isPlain && styles.dimmed,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator size="small" color={textColor} accessibilityLabel={t.common.loading} />
        ) : icon ? (
          <Icon name={icon} size={sizes.iconSm} color={textColor} />
        ) : null}
        <Text
          style={[
            typeScale.button,
            { color: textColor },
            isLink && { textDecorationLine: 'underline' },
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: sizes.minTouchTarget,
    minWidth: sizes.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  boxed: {
    paddingHorizontal: spacing.lg + 2,
    borderRadius: radii.button,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pressed: { opacity: 0.85 },
  dimmed: { opacity: 0.5 },
});
