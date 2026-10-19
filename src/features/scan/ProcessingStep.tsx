// While the book is identified: the photo inside the frame with a calm scan line, and a panel
// with the steps and a Cancel that aborts the request. Also hosts the failure card.
import { Image } from 'expo-image';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Icon } from '@/design/icons';
import { SchemeOverride, useTheme } from '@/design/ThemeProvider';
import { fonts, radii, sizes, spacing, type ColorScheme } from '@/design/tokens';
import type { LocalImage } from '@/features/library/coverService';
import { t } from '@/i18n';

import type { ScanMode } from './bookIdentifier';
import { FrameCorners, RoundIconButton } from './ScanChrome';

const p = t.scan.processing;
const SCAN_LINE_MS = 1600;

function ScanLine() {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0.5);

  useEffect(() => {
    if (reduceMotion) {
      progress.set(0.5);
      return;
    }
    progress.set(0.1);
    progress.set(
      withRepeat(
        withTiming(0.9, { duration: SCAN_LINE_MS, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion]);

  const style = useAnimatedStyle(() => ({ top: `${progress.get() * 100}%` }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.scanLine, { backgroundColor: colors.highlight }, style]}
    />
  );
}

/** The photo being identified, framed like on the camera. */
export function PhotoPreview({ photo, scanning }: { photo: LocalImage; scanning: boolean }) {
  return (
    <View style={styles.photoArea}>
      <View style={styles.photoFrame}>
        <Image
          source={{ uri: photo.uri }}
          style={styles.photo}
          contentFit="cover"
          accessible
          accessibilityLabel={p.photoA11y}
        />
        <FrameCorners />
        {scanning ? <ScanLine /> : null}
      </View>
    </View>
  );
}

type StepState = 'done' | 'active' | 'pending';

function StepRow({ label, state }: { label: string; state: StepState }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const stateLabel = { done: p.stepDone, active: p.stepActive, pending: p.stepPending }[state];
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${stateLabel}`}
      style={[styles.step, { borderColor: colors.border }]}
    >
      <View
        style={[
          styles.stepMark,
          state === 'done'
            ? { backgroundColor: colors.actionPrimary }
            : { borderColor: colors.border, borderWidth: 2 },
        ]}
      >
        {state === 'done' ? (
          <Icon name="check" size={sizes.iconSm} color={colors.actionPrimaryText} />
        ) : state === 'active' ? (
          reduceMotion ? (
            <Icon name="clock" size={sizes.iconSm} color={colors.accentText} />
          ) : (
            <ActivityIndicator size="small" color={colors.accent} />
          )
        ) : null}
      </View>
      <AppText
        variant="body"
        color={state === 'pending' ? 'textSecondary' : 'textPrimary'}
        style={state === 'active' && styles.activeStep}
      >
        {label}
      </AppText>
    </View>
  );
}

/** Bottom panel in the app's own theme over the always-dark camera background. */
export function ScanPanel({ scheme, children }: { scheme: ColorScheme; children: ReactNode }) {
  return (
    <SchemeOverride scheme={scheme}>
      <PanelSurface>{children}</PanelSurface>
    </SchemeOverride>
  );
}

function PanelSurface({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.background, paddingBottom: spacing.xl + insets.bottom },
      ]}
    >
      {children}
    </View>
  );
}

type Props = {
  photo: LocalImage;
  mode: ScanMode;
  panelScheme: ColorScheme;
  onCancel: () => void;
};

export function ProcessingStep({ photo, mode, panelScheme, onCancel }: Props) {
  return (
    <View style={styles.root} testID="scan-processing">
      <View style={styles.topBar}>
        <RoundIconButton icon="chevron-left" label={p.cancel} onPress={onCancel} />
      </View>
      <PhotoPreview photo={photo} scanning />
      <ScanPanel scheme={panelScheme}>
        <View style={styles.eyebrow}>
          <Icon name="sparkles" size={sizes.iconSm} />
          <AppText variant="label">{p.eyebrow}</AppText>
        </View>
        <AppText variant="title" accessibilityRole="header" accessibilityLiveRegion="polite">
          {p.title}
        </AppText>
        <AppText variant="body" color="textSecondary">
          {mode === 'cover' ? p.messageCover : p.messageSpine}
        </AppText>
        <View>
          <StepRow label={p.stepPhoto} state="done" />
          <StepRow label={p.stepSearch} state="active" />
          <StepRow label={p.stepForm} state="pending" />
        </View>
        <Button variant="secondary" label={p.cancel} onPress={onCancel} />
      </ScanPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  photoArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  photoFrame: { height: '100%', aspectRatio: 3 / 4, padding: spacing.md },
  photo: { flex: 1, borderRadius: radii.tag },
  scanLine: { position: 'absolute', left: 0, right: 0, height: 2 },
  panel: {
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.minTouchTarget,
    borderTopWidth: sizes.borderWidth,
    paddingVertical: spacing.xs,
  },
  stepMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeStep: { fontFamily: fonts.sansSemiBold },
});
