import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing, typeScale } from '@/design/tokens';

export type SegmentOption<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: Props<T>) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[styles.container, { backgroundColor: colors.field, borderColor: colors.border }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            style={[styles.segment, selected && { backgroundColor: colors.actionPrimary }]}
          >
            <Text
              style={[
                typeScale.button,
                styles.text,
                { color: selected ? colors.actionPrimaryText : colors.textPrimary },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: spacing.xs,
    borderRadius: radii.field,
    borderWidth: sizes.borderWidth,
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    minHeight: sizes.minTouchTarget,
    borderRadius: radii.field - spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 14 },
});
