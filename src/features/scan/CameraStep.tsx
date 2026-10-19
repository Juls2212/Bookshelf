// Camera view of the scan flow: live preview with a frame for ONE book, Portada/Lomo selector,
// shutter, gallery and manual entry. Explains and asks for the camera permission first.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { SegmentedControl } from '@/components/SegmentedControl';
import { useToast } from '@/components/Toast';
import { Icon, type IconName } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing } from '@/design/tokens';
import { coverService, type LocalImage } from '@/features/library/coverService';
import { t } from '@/i18n';
import { appForeground } from '@/lib/network';

import type { ScanMode } from './bookIdentifier';
import { cameraAccessFor } from './cameraAccess';
import { FrameCorners, RoundIconButton, Scrim } from './ScanChrome';

const s = t.scan;

type Props = {
  mode: ScanMode;
  onModeChange: (mode: ScanMode) => void;
  onPhoto: (photo: LocalImage) => void;
  onManual: () => void;
  onClose: () => void;
};

const modeOptions = [
  { value: 'cover', label: s.modeCover },
  { value: 'spine', label: s.modeSpine },
] as const;

function SideAction({
  icon,
  label,
  a11yLabel,
  onPress,
}: {
  icon: IconName;
  label: string;
  a11yLabel: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      style={({ pressed }) => [styles.side, pressed && styles.pressed]}
    >
      <Scrim style={[styles.sideBox, { borderColor: colors.border }]}>
        <Icon name={icon} size={sizes.iconLg} />
      </Scrim>
      <AppText variant="caption" color="textPrimary">
        {label}
      </AppText>
    </Pressable>
  );
}

/** Permission and "no camera" states: what happened and what the user can do instead. */
function AccessCard({
  icon,
  title,
  message,
  children,
}: {
  icon: IconName;
  title: string;
  message: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.accessWrap}>
      <View
        style={[styles.access, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Icon name={icon} size={sizes.iconLg} color={colors.accentText} />
        <AppText variant="heading" accessibilityRole="header">
          {title}
        </AppText>
        <AppText variant="body" color="textSecondary">
          {message}
        </AppText>
        <View style={styles.accessActions}>{children}</View>
      </View>
    </View>
  );
}

export function CameraStep({ mode, onModeChange, onPhoto, onManual, onClose }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [cameraFailed, setCameraFailed] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const camera = useRef<CameraView>(null);
  const access = cameraAccessFor(permission, cameraFailed);

  // Coming back from the system settings: read the permission again.
  useEffect(
    () =>
      appForeground.subscribe((active) => {
        if (active) void getPermission();
      }),
    [getPermission],
  );

  const capture = async () => {
    if (capturing || !camera.current) return;
    setCapturing(true);
    try {
      const picture = await camera.current.takePictureAsync({ quality: 1 });
      onPhoto({ uri: picture.uri, width: picture.width, height: picture.height, source: 'camera' });
    } catch {
      toast.show(s.captureFailed, 'error');
    } finally {
      setCapturing(false);
    }
  };

  const pickFromGallery = async () => {
    const result = await coverService.pickFromGallery();
    if (result.ok) onPhoto({ ...result.data, source: 'gallery' });
    else if (result.error !== 'cancelled') toast.show(t.bookForm.pickFailed, 'error');
  };

  const fallbackActions = (
    <>
      <Button
        variant="secondary"
        icon="image"
        label={s.permission.gallery}
        onPress={pickFromGallery}
      />
      <Button variant="ghost" icon="pencil" label={s.permission.manual} onPress={onManual} />
    </>
  );

  return (
    <View style={styles.root}>
      {access === 'ready' ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          animateShutter={false}
          onMountError={() => setCameraFailed(true)}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}

      <View style={styles.topBar}>
        <RoundIconButton icon="x" label={s.close} onPress={onClose} />
        <AppText variant="body" color="textPrimary" accessibilityRole="header" style={styles.title}>
          {s.title}
        </AppText>
        <View style={styles.spacer} />
      </View>

      {access === 'checking' ? (
        <View style={styles.center}>
          <ActivityIndicator
            color={colors.textPrimary}
            accessibilityLabel={s.permission.checking}
          />
        </View>
      ) : access === 'request' ? (
        <AccessCard
          icon="scan"
          title={s.permission.requestTitle}
          message={s.permission.requestMessage}
        >
          <Button label={s.permission.allow} onPress={() => void requestPermission()} />
          <Button variant="ghost" icon="pencil" label={s.permission.manual} onPress={onManual} />
        </AccessCard>
      ) : access === 'denied' ? (
        <AccessCard
          icon="eye-off"
          title={s.permission.deniedTitle}
          message={s.permission.deniedMessage}
        >
          {permission?.canAskAgain ? (
            <Button label={s.permission.allow} onPress={() => void requestPermission()} />
          ) : null}
          <Button
            variant={permission?.canAskAgain ? 'secondary' : 'primary'}
            label={s.permission.openSettings}
            onPress={() => void Linking.openSettings()}
          />
          {fallbackActions}
        </AccessCard>
      ) : access === 'unavailable' ? (
        <AccessCard
          icon="alert-circle"
          title={s.permission.unavailableTitle}
          message={s.permission.unavailableMessage}
        >
          {fallbackActions}
        </AccessCard>
      ) : (
        <>
          <Scrim style={styles.guidance}>
            <AppText variant="body" color="textPrimary" style={styles.centerText}>
              {s.guidance}
            </AppText>
            <AppText variant="caption" color="textPrimary" style={styles.centerText}>
              {mode === 'cover' ? s.frameCover : s.frameSpine}
            </AppText>
          </Scrim>

          <View style={styles.frameArea} pointerEvents="none">
            <View style={[styles.frame, mode === 'cover' ? styles.frameCover : styles.frameSpine]}>
              <FrameCorners />
            </View>
          </View>

          <Scrim style={styles.tip}>
            <Icon name="sun" size={sizes.iconSm} color={colors.highlight} />
            <AppText variant="caption" color="textPrimary">
              {s.tip}
            </AppText>
          </Scrim>

          <View style={styles.modes}>
            <SegmentedControl<ScanMode>
              options={modeOptions}
              value={mode}
              onChange={onModeChange}
              accessibilityLabel={s.modeLabel}
            />
          </View>

          <View style={styles.controls}>
            <SideAction
              icon="image"
              label={s.gallery}
              a11yLabel={s.galleryA11y}
              onPress={pickFromGallery}
            />
            <Pressable
              onPress={capture}
              disabled={capturing}
              accessibilityRole="button"
              accessibilityLabel={s.shutter}
              accessibilityHint={s.shutterHint}
              accessibilityState={{ disabled: capturing, busy: capturing }}
              style={({ pressed }) => [
                styles.shutter,
                { borderColor: colors.textPrimary },
                (pressed || capturing) && styles.pressed,
              ]}
            >
              <View style={[styles.shutterInner, { backgroundColor: colors.textPrimary }]} />
            </Pressable>
            <SideAction
              icon="pencil"
              label={s.manual}
              a11yLabel={s.manualA11y}
              onPress={onManual}
            />
          </View>

          <AppText variant="caption" color="textPrimary" style={styles.centerText}>
            {s.reviewPromise}
          </AppText>
        </>
      )}
    </View>
  );
}

const SHUTTER = 76;
const SIDE = 56;

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  title: { flex: 1, textAlign: 'center' },
  spacer: { width: sizes.minTouchTarget + 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  guidance: {
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.surface,
  },
  frameArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { height: '92%', maxWidth: '86%' },
  frameCover: { aspectRatio: 3 / 4 },
  frameSpine: { aspectRatio: 1 / 4 },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  modes: { alignSelf: 'center', width: 240 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  side: { alignItems: 'center', gap: spacing.xs, minWidth: sizes.minTouchTarget },
  sideBox: {
    width: SIDE,
    height: SIDE,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutter: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: SHUTTER - 18, height: SHUTTER - 18, borderRadius: (SHUTTER - 18) / 2 },
  pressed: { opacity: 0.7 },
  accessWrap: { flex: 1, justifyContent: 'center' },
  access: {
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.surface,
    borderWidth: sizes.borderWidth,
  },
  accessActions: { gap: spacing.sm, alignSelf: 'stretch' },
});
