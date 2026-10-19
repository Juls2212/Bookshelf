// "Ajustar recorte": the photo with a frame the user drags (move) or resizes from its corners.
// The frame keeps a fixed aspect (the BookCover proportions by default; 1:1 with a circular
// guide for the profile photo), stays inside the photo and never gets smaller than 30 % of the
// largest frame. Nothing is saved here; "Aplicar" returns the crop.
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { COVER_ASPECT as BOOK_COVER_HEIGHT_RATIO } from '@/components/BookCover';
import { Button } from '@/components/Button';
import { useTheme } from '@/design/ThemeProvider';
import { scrimOpacity, sizes, spacing } from '@/design/tokens';
import { t } from '@/i18n';

import {
  containSize,
  fitToAspect,
  moveRect,
  resizeFromCorner,
  scaleRect,
  toCropRect,
  toDisplayRect,
  type CropCorner,
  type CropRect,
  type Rect,
  type Size,
} from './coverCrop';
import { coverService, type CoverService, type LocalImage } from './coverService';

const c = t.cropEditor;
/** Width / height of a BookCover (the default frame). */
const COVER_CROP_ASPECT = 1 / BOOK_COVER_HEIGHT_RATIO;
const WHOLE_IMAGE: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const NO_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };
const HANDLE = sizes.minTouchTarget;
const HANDLE_MARK = 16;
const FRAME_BORDER = 2;
const STEP_UP = 1.1;
const STEP_DOWN = 1 / STEP_UP;
const CORNERS: CropCorner[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

type Props = {
  image: LocalImage;
  /** Current crop, or null for the whole image. */
  initialCrop: CropRect | null;
  onApply: (crop: CropRect) => void;
  onCancel: () => void;
  covers?: Pick<CoverService, 'measure'>;
  /** Frame width / height (default: the BookCover proportions). */
  aspect?: number;
  /** Draws a circle inside the frame (what a round avatar will show). */
  circleGuide?: boolean;
  title?: string;
  hint?: string;
};

type Measured = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; size: Size };

/**
 * 44 pt touch target centered on a corner of the frame. Handles live in the stage's outer
 * margin (half a handle around the photo), so they stay touchable at the photo's edges.
 */
function CornerHandle({
  corner,
  rect,
  frame,
  aspect,
}: {
  corner: CropCorner;
  rect: SharedValue<Rect>;
  frame: Size;
  aspect: number;
}) {
  const { colors } = useTheme();
  const start = useSharedValue<Rect>(NO_RECT);
  const right = corner === 'topRight' || corner === 'bottomRight';
  const bottom = corner === 'bottomLeft' || corner === 'bottomRight';

  const style = useAnimatedStyle(() => {
    const r = rect.get();
    return {
      left: right ? r.x + r.width : r.x,
      top: bottom ? r.y + r.height : r.y,
    };
  });

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onStart(() => start.set(rect.get()))
    .onUpdate((e) =>
      rect.set(
        resizeFromCorner(start.get(), corner, e.translationX, e.translationY, frame, aspect),
      ),
    )
    .withTestId(`crop-corner-${corner}`);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.handle, style]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View
          style={[
            styles.handleMark,
            { backgroundColor: colors.highlight, borderColor: colors.scrim },
          ]}
        />
      </Animated.View>
    </GestureDetector>
  );
}

/** The photo, the dimmed outside area, the frame and its corners. */
function CropStage({
  uri,
  frame,
  rect,
  aspect,
  circleGuide,
}: {
  uri: string;
  frame: Size;
  rect: SharedValue<Rect>;
  aspect: number;
  circleGuide: boolean;
}) {
  const { colors, scheme } = useTheme();
  const start = useSharedValue<Rect>(NO_RECT);
  const dim = { backgroundColor: colors.scrim, opacity: scrimOpacity[scheme] };

  const frameStyle = useAnimatedStyle(() => {
    const r = rect.get();
    return { left: r.x, top: r.y, width: r.width, height: r.height };
  });
  const topBand = useAnimatedStyle(() => ({ height: rect.get().y }));
  const bottomBand = useAnimatedStyle(() => {
    const r = rect.get();
    return { top: r.y + r.height };
  });
  const leftBand = useAnimatedStyle(() => {
    const r = rect.get();
    return { top: r.y, height: r.height, width: r.x };
  });
  const rightBand = useAnimatedStyle(() => {
    const r = rect.get();
    return { top: r.y, height: r.height, left: r.x + r.width };
  });

  const move = Gesture.Pan()
    .runOnJS(true)
    .onStart(() => start.set(rect.get()))
    .onUpdate((e) => rect.set(moveRect(start.get(), e.translationX, e.translationY, frame)))
    .withTestId('crop-frame-pan');

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName;
    if (name === 'increment') rect.set(scaleRect(rect.get(), STEP_UP, frame, aspect));
    if (name === 'decrement') rect.set(scaleRect(rect.get(), STEP_DOWN, frame, aspect));
  };

  return (
    <View
      style={{ width: frame.width + HANDLE, height: frame.height + HANDLE }}
      testID="crop-stage"
    >
      <View style={[styles.photo, { width: frame.width, height: frame.height }]}>
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="fill"
          transition={0}
          accessibilityIgnoresInvertColors
        />
        <Animated.View pointerEvents="none" style={[styles.band, styles.top, dim, topBand]} />
        <Animated.View pointerEvents="none" style={[styles.band, styles.bottom, dim, bottomBand]} />
        <Animated.View pointerEvents="none" style={[styles.side, styles.left, dim, leftBand]} />
        <Animated.View pointerEvents="none" style={[styles.side, styles.right, dim, rightBand]} />
        <GestureDetector gesture={move}>
          <Animated.View
            testID="crop-frame"
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={c.frameLabel}
            accessibilityHint={c.frameHint}
            accessibilityActions={[
              { name: 'increment', label: c.grow },
              { name: 'decrement', label: c.shrink },
            ]}
            onAccessibilityAction={onAccessibilityAction}
            style={[styles.frame, { borderColor: colors.highlight }, frameStyle]}
          >
            {circleGuide ? (
              <View
                pointerEvents="none"
                testID="crop-circle-guide"
                style={[styles.circle, { borderColor: colors.highlight }]}
              />
            ) : null}
          </Animated.View>
        </GestureDetector>
      </View>
      {CORNERS.map((corner) => (
        <CornerHandle key={corner} corner={corner} rect={rect} frame={frame} aspect={aspect} />
      ))}
    </View>
  );
}

export function CropEditor({
  image,
  initialCrop,
  onApply,
  onCancel,
  covers = coverService,
  aspect = COVER_CROP_ASPECT,
  circleGuide = false,
  title = c.title,
  hint = c.hint,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [measured, setMeasured] = useState<Measured>({ status: 'loading' });
  const [area, setArea] = useState<Size | null>(null);
  const rect = useSharedValue<Rect>({ x: 0, y: 0, width: 0, height: 0 });

  // The size as decoded (orientation applied), the same one the crop is applied to.
  useEffect(() => {
    let active = true;
    void covers.measure(image.uri).then((result) => {
      if (!active) return;
      setMeasured(result.ok ? { status: 'ready', size: result.data } : { status: 'failed' });
    });
    return () => {
      active = false;
    };
  }, [covers, image.uri]);

  // Room for the photo once the corner handles' margin is left around it.
  const frame =
    measured.status === 'ready' && area
      ? containSize(measured.size, { width: area.width - HANDLE, height: area.height - HANDLE })
      : null;
  const frameWidth = frame?.width ?? 0;
  const frameHeight = frame?.height ?? 0;

  // Starts from the current crop, reshaped to the cover proportions.
  useEffect(() => {
    if (frameWidth <= 0 || frameHeight <= 0) return;
    const bounds = { width: frameWidth, height: frameHeight };
    rect.set(fitToAspect(toDisplayRect(initialCrop ?? WHOLE_IMAGE, bounds), bounds, aspect));
  }, [frameWidth, frameHeight, initialCrop, rect, aspect]);

  const onStageLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > HANDLE && height > HANDLE) setArea({ width, height });
  };

  const apply = () => {
    if (frame) onApply(toCropRect(rect.get(), frame));
  };

  return (
    <Modal
      visible
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onCancel}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <GestureHandlerRootView
        style={[
          styles.root,
          {
            backgroundColor: colors.background,
            paddingTop: insets.top + spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <View style={styles.header}>
          <AppText variant="title" accessibilityRole="header">
            {title}
          </AppText>
          <AppText variant="caption">{hint}</AppText>
        </View>
        <View style={styles.stage} onLayout={onStageLayout} testID="crop-area">
          {measured.status === 'failed' ? (
            <AppText variant="body" style={styles.center}>
              {c.failed}
            </AppText>
          ) : frame ? (
            <CropStage
              uri={image.uri}
              frame={frame}
              rect={rect}
              aspect={aspect}
              circleGuide={circleGuide}
            />
          ) : (
            <ActivityIndicator
              color={colors.textSecondary}
              accessibilityLabel={c.loading}
              testID="crop-loading"
            />
          )}
        </View>
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button variant="secondary" label={c.cancel} onPress={onCancel} />
          </View>
          <View style={styles.flex}>
            <Button label={c.apply} onPress={apply} disabled={!frame} />
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.lg },
  header: { gap: spacing.xs },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  photo: { position: 'absolute', left: HANDLE / 2, top: HANDLE / 2, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  band: { position: 'absolute', left: 0, right: 0 },
  top: { top: 0 },
  bottom: { bottom: 0 },
  side: { position: 'absolute' },
  left: { left: 0 },
  right: { right: 0 },
  frame: { position: 'absolute', borderWidth: FRAME_BORDER },
  circle: { ...StyleSheet.absoluteFill, borderRadius: 9999, borderWidth: FRAME_BORDER },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleMark: {
    width: HANDLE_MARK,
    height: HANDLE_MARK,
    borderRadius: HANDLE_MARK / 2,
    borderWidth: sizes.borderWidth,
  },
});
