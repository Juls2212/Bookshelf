import { Pressable, StyleSheet, Text } from 'react-native';

import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing, typeScale } from '@/design/tokens';

type Props = {
  label: string;
  selected: boolean;
  onPress?: () => void;
  /** Shows a check mark while selected, so the state is not told by color alone. */
  checkWhenSelected?: boolean;
  accessibilityHint?: string;
};

export function Chip({
  label,
  selected,
  onPress,
  checkWhenSelected = false,
  accessibilityHint,
}: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      // A multi-select chip is a checkbox; a single-choice chip stays a button.
      accessibilityRole={checkWhenSelected ? 'checkbox' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={checkWhenSelected ? { checked: selected } : { selected }}
      style={({ pressed }) => [
        styles.chip,
        selected
          ? { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary }
          : { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      {checkWhenSelected && selected ? (
        <Icon name="check" size={16} color={colors.actionPrimaryText} strokeWidth={2.5} />
      ) : null}
      <Text
        style={[
          typeScale.button,
          styles.text,
          { color: selected ? colors.actionPrimaryText : colors.textPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: sizes.minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: sizes.borderWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: { fontSize: 14 },
  pressed: { opacity: 0.85 },
});
