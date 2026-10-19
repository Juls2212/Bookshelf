import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { motion } from '@/design/motion';
import { useTheme } from '@/design/ThemeProvider';
import { format, t } from '@/i18n';

type Props = {
  percent: number;
  /** `default`: line + caramel bookmark ribbon. `mini`: thin line only (tiles). */
  variant?: 'default' | 'mini';
  /**
   * The bookmark slides to new values (280 ms). Off by default: lists and tiles stay static.
   * Ignored for `mini`.
   */
  animated?: boolean;
  /** With `animated`, the value the bookmark starts from when it first appears. */
  animateFrom?: number;
};

const RIBBON = { width: 14, height: 24, notch: 6 };
const LINE_TOP = 9;
const RIBBON_PATH = `M0 0 H${RIBBON.width} V${RIBBON.height} L${RIBBON.width / 2} ${
  RIBBON.height - RIBBON.notch
} L0 ${RIBBON.height} Z`;

const clamp = (percent: number) => Math.min(100, Math.max(0, Math.round(percent)));

function Ribbon() {
  const { colors } = useTheme();
  return (
    <Svg width={RIBBON.width} height={RIBBON.height}>
      <Path d={RIBBON_PATH} fill={colors.accent} />
    </Svg>
  );
}

/** Bookmark that slides on a soft curve; with reduce motion it jumps to the final state. */
function AnimatedLine({ value, from }: { value: number; from?: number }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion || from === undefined ? value : clamp(from));

  useEffect(() => {
    if (reduceMotion) {
      progress.set(value);
      return;
    }
    progress.set(
      withTiming(value, {
        duration: motion.bookmarkSlide.durationMs,
        easing: Easing.inOut(Easing.cubic),
      }),
    );
  }, [value, reduceMotion, progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.get()}%` }));
  const ribbonStyle = useAnimatedStyle(() => ({ left: `${progress.get()}%` }));

  return (
    <>
      <View style={[styles.track, { height: 4, top: LINE_TOP, backgroundColor: colors.track }]}>
        <Animated.View style={[styles.fill, { backgroundColor: colors.textPrimary }, fillStyle]} />
      </View>
      <Animated.View style={[styles.ribbon, ribbonStyle]}>
        <Ribbon />
      </Animated.View>
    </>
  );
}

export function ProgressBar({
  percent,
  variant = 'default',
  animated = false,
  animateFrom,
}: Props) {
  const { colors } = useTheme();
  const value = clamp(percent);
  const mini = variant === 'mini';
  const lineHeight = mini ? 3 : 4;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={format(t.book.progressA11y, { percent: value })}
      accessibilityValue={{ min: 0, max: 100, now: value }}
      style={mini ? styles.mini : styles.default}
    >
      {animated && !mini ? (
        <AnimatedLine value={value} from={animateFrom} />
      ) : (
        <>
          <View
            style={[
              styles.track,
              { height: lineHeight, top: mini ? 0 : LINE_TOP, backgroundColor: colors.track },
            ]}
          >
            <View
              style={[styles.fill, { width: `${value}%`, backgroundColor: colors.textPrimary }]}
            />
          </View>
          {mini ? null : (
            <View style={[styles.ribbon, { left: `${value}%` }]}>
              <Ribbon />
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  default: { height: RIBBON.height + 2, justifyContent: 'flex-start' },
  mini: { height: 3, flex: 1 },
  track: { position: 'absolute', left: 0, right: 0, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
  ribbon: { position: 'absolute', top: 0, marginLeft: -RIBBON.width / 2 },
});
