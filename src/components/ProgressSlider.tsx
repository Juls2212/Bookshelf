import { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
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
import { sizes } from '@/design/tokens';
import { format, t } from '@/i18n';

type Props = {
  /** Saved current page. */
  page: number;
  /** Known page count (> 0). */
  pageCount: number;
  /** Called once when the user releases the marker (or taps the line) on a different page. */
  onCommit: (page: number) => void;
  /** Live page while dragging, null when the drag ends (for the page/percentage labels). */
  onPreview?: (page: number | null) => void;
  /** Percentage the marker starts from when it first appears (e.g. status became reading). */
  animateFrom?: number;
  testID?: string;
};

const RIBBON = { width: 14, height: 24, notch: 6 };
const LINE_TOP = 9;
const TARGET = sizes.minTouchTarget;
const RIBBON_PATH = `M0 0 H${RIBBON.width} V${RIBBON.height} L${RIBBON.width / 2} ${
  RIBBON.height - RIBBON.notch
} L0 ${RIBBON.height} Z`;

const clampPage = (page: number, total: number) => Math.min(total, Math.max(0, page));

/** Integer page under an x position of a track of `width` px. */
export function pageAtPosition(x: number, width: number, pageCount: number): number {
  if (width <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, x / width)) * pageCount);
}

/**
 * Draggable reading progress: the bookmark follows the finger and snaps to whole pages; the
 * page is committed once on release. Tapping the line jumps there. Screen readers get an
 * adjustable control with "next/previous page" actions.
 */
export function ProgressSlider({
  page,
  pageCount,
  onCommit,
  onPreview,
  animateFrom,
  testID = 'progress-slider',
}: Props) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  // Gesture state kept in shared values (read in gesture callbacks, never during render).
  const dragging = useSharedValue(false);
  const lastPreview = useSharedValue(-1);
  const savedFraction = clampPage(page, pageCount) / pageCount;
  const fraction = useSharedValue(
    animateFrom !== undefined && !reduceMotion
      ? Math.min(1, Math.max(0, animateFrom / 100))
      : savedFraction,
  );

  // Follow the saved page (after a commit, a rollback or the numeric sheet).
  useEffect(() => {
    if (dragging.get()) return;
    if (reduceMotion) fraction.set(savedFraction);
    else
      fraction.set(
        withTiming(savedFraction, {
          duration: motion.bookmarkSlide.durationMs,
          easing: Easing.inOut(Easing.cubic),
        }),
      );
  }, [savedFraction, reduceMotion, fraction, dragging]);

  const moveTo = (x: number) => {
    const next = pageAtPosition(x, width, pageCount);
    fraction.set(next / pageCount);
    if (next !== lastPreview.get()) {
      lastPreview.set(next);
      onPreview?.(next);
    }
    return next;
  };

  const finish = (target: number | null) => {
    dragging.set(false);
    lastPreview.set(-1);
    onPreview?.(null);
    if (target === null || target === page) {
      fraction.set(savedFraction);
      return;
    }
    onCommit(target);
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-4, 4])
    .failOffsetY([-12, 12])
    .onStart((e) => {
      dragging.set(true);
      moveTo(e.x);
    })
    .onUpdate((e) => {
      moveTo(e.x);
    })
    .onEnd((e, success) => {
      finish(success ? pageAtPosition(e.x, width, pageCount) : null);
    })
    .withTestId(`${testID}-pan`);

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e, success) => {
      if (success) finish(pageAtPosition(e.x, width, pageCount));
    })
    .withTestId(`${testID}-tap`);

  const fillStyle = useAnimatedStyle(() => ({ width: `${fraction.get() * 100}%` }));
  const markerStyle = useAnimatedStyle(() => ({ left: `${fraction.get() * 100}%` }));

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') onCommit(clampPage(page + 1, pageCount));
    if (event.nativeEvent.actionName === 'decrement') onCommit(clampPage(page - 1, pageCount));
  };

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View
        testID={testID}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t.reading.sliderLabel}
        accessibilityHint={t.reading.sliderHint}
        accessibilityValue={{
          min: 0,
          max: pageCount,
          now: clampPage(page, pageCount),
          text: format(t.reading.sliderValue, {
            page: clampPage(page, pageCount),
            total: pageCount,
          }),
        }}
        accessibilityActions={[
          { name: 'increment', label: t.reading.sliderIncrement },
          { name: 'decrement', label: t.reading.sliderDecrement },
        ]}
        onAccessibilityAction={onAccessibilityAction}
        style={styles.container}
      >
        <View style={[styles.track, { backgroundColor: colors.track }]}>
          <Animated.View
            style={[styles.fill, { backgroundColor: colors.textPrimary }, fillStyle]}
          />
        </View>
        {/* 44 px touch target centred on the bookmark. */}
        <Animated.View style={[styles.marker, markerStyle]} pointerEvents="none">
          <Svg width={RIBBON.width} height={RIBBON.height}>
            <Path d={RIBBON_PATH} fill={colors.accent} />
          </Svg>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { height: TARGET, justifyContent: 'flex-start' },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: LINE_TOP,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 2 },
  marker: {
    position: 'absolute',
    top: 0,
    width: TARGET,
    height: TARGET,
    marginLeft: -TARGET / 2,
    alignItems: 'center',
  },
});
