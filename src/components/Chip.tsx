import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing, typeScale } from '@/design/tokens';

type Props = {
  label: string;
  selected: boolean;
  onPress?: () => void;
};

export function Chip({ label, selected, onPress }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        selected
          ? { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary }
          : { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: { fontSize: 14 },
  pressed: { opacity: 0.85 },
});
