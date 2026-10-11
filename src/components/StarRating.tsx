import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { sizes } from '@/design/tokens';
import { format, t } from '@/i18n';

const STARS = [1, 2, 3, 4, 5] as const;

type Props = {
  /** 1-5, or null/0 when not rated. */
  value: number | null;
  /** When provided the rating is interactive (44px targets). */
  onChange?: (value: number) => void;
  size?: number;
};

export function StarRating({ value, onChange, size = 22 }: Props) {
  const { colors } = useTheme();
  const current = value ?? 0;
  const summary = current > 0 ? format(t.rating.summaryA11y, { value: current }) : t.rating.none;

  if (!onChange) {
    return (
      <View accessible accessibilityRole="text" accessibilityLabel={summary} style={styles.row}>
        {STARS.map((n) => (
          <Icon
            key={n}
            name="star"
            size={size}
            color={colors.accent}
            fill={n <= current ? colors.accent : 'none'}
          />
        ))}
      </View>
    );
  }

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={summary} style={styles.row}>
      {STARS.map((n) => (
        <Pressable
          key={n}
          onPress={() => onChange(n)}
          accessibilityRole="radio"
          accessibilityLabel={n === 1 ? t.rating.starOne : format(t.rating.starMany, { value: n })}
          accessibilityState={{ checked: n === current }}
          style={styles.target}
        >
          <Icon
            name="star"
            size={size}
            color={colors.accent}
            fill={n <= current ? colors.accent : 'none'}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  target: {
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
