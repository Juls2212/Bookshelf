import { StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import type { IconName } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';

import { AppText } from './AppText';
import { Button } from './Button';
import { ShelfLine } from './ShelfLine';

export type EmptyStateAction = { label: string; onPress?: () => void; icon?: IconName };

type Props = {
  eyebrow?: string;
  title: string;
  description: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
};

// Dashed outlines of missing books standing on a shelf. Decorative.
const BOOKS = [
  { x: 2, y: 26, w: 52, h: 106 },
  { x: 66, y: 2, w: 44, h: 130 },
  { x: 122, y: 32, w: 58, h: 100 },
  { x: 192, y: 10, w: 46, h: 122 },
];
const LEANING = { x: 262, y: 34, w: 52, h: 96, angle: 9 };

function DashedShelf() {
  const { colors } = useTheme();
  const stroke = {
    stroke: colors.accent,
    strokeOpacity: 0.6,
    strokeWidth: 1,
    strokeDasharray: '4 3',
    fill: 'none',
  } as const;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height={134} viewBox="0 0 335 134" preserveAspectRatio="xMinYMax meet">
        {BOOKS.map((b) => (
          <Rect key={b.x} x={b.x} y={b.y} width={b.w} height={b.h} rx={4} {...stroke} />
        ))}
        <Rect
          x={LEANING.x}
          y={LEANING.y}
          width={LEANING.w}
          height={LEANING.h}
          rx={4}
          transform={`rotate(${LEANING.angle} ${LEANING.x + LEANING.w / 2} ${LEANING.y + LEANING.h})`}
          {...stroke}
        />
      </Svg>
      <ShelfLine />
    </View>
  );
}

export function EmptyState({ eyebrow, title, description, primaryAction, secondaryAction }: Props) {
  return (
    <View style={styles.container}>
      <DashedShelf />
      <View style={styles.text}>
        {eyebrow ? <AppText variant="label">{eyebrow}</AppText> : null}
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        <AppText variant="body" color="textSecondary">
          {description}
        </AppText>
      </View>
      {primaryAction || secondaryAction ? (
        <View style={styles.actions}>
          {primaryAction ? (
            <Button
              label={primaryAction.label}
              icon={primaryAction.icon}
              onPress={primaryAction.onPress}
            />
          ) : null}
          {secondaryAction ? (
            <Button
              variant="secondary"
              label={secondaryAction.label}
              icon={secondaryAction.icon}
              onPress={secondaryAction.onPress}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xl },
  text: { gap: spacing.sm },
  actions: { gap: spacing.sm },
});
