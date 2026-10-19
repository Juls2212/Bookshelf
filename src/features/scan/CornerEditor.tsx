// "Ajustar esquinas": the photo with the 4 corners of the cover as draggable handles (44 pt touch
// targets) joined by a polygon. The shape always stays inside the photo, convex and big enough
// (a move that would break that is ignored). "Aplicar" returns normalized corners. Nothing
// animates (reduce motion is respected by design).
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polygon } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { useTheme } from '@/design/ThemeProvider';
import { sizes, spacing } from '@/design/tokens';
import { containSize, type Size } from '@/features/library/coverCrop';
import { coverService, type CoverService, type LocalImage } from '@/features/library/coverService';
import { t } from '@/i18n';

import { moveCorner, type Point, type Quad } from './coverGeometry';

const c = t.cornerEditor;
const HANDLE = sizes.minTouchTarget;
const HANDLE_MARK = 18;
const CORNER_NAMES = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;

type Props = {
  image: LocalImage;
  initialCorners: Quad;
  onApply: (corners: Quad) => void;
  onCancel: () => void;
  covers?: Pick<CoverService, 'measure'>;
};

type Measured = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; size: Size };

function Handle({
  index,
  point,
  frame,
  onMove,
}: {
  index: number;
  point: Point;
  frame: Size;
  onMove: (index: number, to: Point) => void;
}) {
  const { colors } = useTheme();
  // Gesture state lives in a shared value (read in gesture callbacks, never during render).
  const start = useSharedValue<Point>({ x: 0, y: 0 });
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onStart(() => {
      start.set(point);
    })
    .onUpdate((e) =>
      onMove(index, {
        x: start.get().x + e.translationX / frame.width,
        y: start.get().y + e.translationY / frame.height,
      }),
    )
    .withTestId(`corner-${index}`);
  return (
    <GestureDetector gesture={pan}>
      <View
        style={[
          styles.handle,
          // Handles live in the stage margin (half a handle around the photo): always touchable.
          { left: point.x * frame.width, top: point.y * frame.height },
        ]}
        accessible
        accessibilityLabel={c.corners[CORNER_NAMES[index]]}
        testID={`corner-handle-${index}`}
      >
        <View
          style={[styles.mark, { backgroundColor: colors.highlight, borderColor: colors.scrim }]}
        />
      </View>
    </GestureDetector>
  );
}

export function CornerEditor({
  image,
  initialCorners,
  onApply,
  onCancel,
  covers = coverService,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [measured, setMeasured] = useState<Measured>({ status: 'loading' });
  const [area, setArea] = useState<Size | null>(null);
  const [corners, setCorners] = useState<Quad>(initialCorners);

  // The size as decoded (orientation applied), the same one the corners refer to.
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

  const frame =
    measured.status === 'ready' && area
      ? containSize(measured.size, { width: area.width - HANDLE, height: area.height - HANDLE })
      : null;

  const onStageLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > HANDLE && height > HANDLE) setArea({ width, height });
  };

  const move = (index: number, to: Point) =>
    setCorners((current) => moveCorner(current, index, to));

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
            {c.title}
          </AppText>
          <AppText variant="caption">{c.hint}</AppText>
        </View>
        <View style={styles.stage} onLayout={onStageLayout} testID="corner-area">
          {measured.status === 'failed' ? (
            <AppText variant="body" style={styles.center}>
              {c.failed}
            </AppText>
          ) : frame ? (
            <View
              style={{ width: frame.width + HANDLE, height: frame.height + HANDLE }}
              testID="corner-stage"
            >
              <View style={[styles.photo, { width: frame.width, height: frame.height }]}>
                <Image
                  source={{ uri: image.uri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="fill"
                  transition={0}
                  accessibilityIgnoresInvertColors
                />
                <Svg
                  width={frame.width}
                  height={frame.height}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                >
                  <Polygon
                    points={corners
                      .map((p) => `${p.x * frame.width},${p.y * frame.height}`)
                      .join(' ')}
                    fill={colors.highlight}
                    fillOpacity={0.15}
                    stroke={colors.highlight}
                    strokeWidth={2}
                  />
                </Svg>
              </View>
              {corners.map((point, index) => (
                <Handle
                  key={CORNER_NAMES[index]}
                  index={index}
                  point={point}
                  frame={frame}
                  onMove={move}
                />
              ))}
            </View>
          ) : (
            <ActivityIndicator
              color={colors.textSecondary}
              accessibilityLabel={c.loading}
              testID="corner-loading"
            />
          )}
        </View>
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button variant="secondary" label={c.cancel} onPress={onCancel} />
          </View>
          <View style={styles.flex}>
            <Button label={c.apply} onPress={() => onApply(corners)} disabled={!frame} />
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
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: HANDLE_MARK,
    height: HANDLE_MARK,
    borderRadius: HANDLE_MARK / 2,
    borderWidth: sizes.borderWidth,
  },
});
