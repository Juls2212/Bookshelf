// Small building blocks shared by the dark camera and processing views.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { radii, scrimOpacity, sizes, spacing } from '@/design/tokens';

/** Translucent backdrop so text stays readable over the live camera image. */
export function Scrim({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors, scheme } = useTheme();
  return (
    <View style={[styles.scrim, { borderColor: colors.border }, style]}>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: colors.scrim, opacity: scrimOpacity[scheme] },
        ]}
      />
      {children}
    </View>
  );
}

export function RoundIconButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const { colors, scheme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.round,
        { borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: colors.scrim, opacity: scrimOpacity[scheme] },
        ]}
      />
      <Icon name={icon} size={sizes.iconLg} />
    </Pressable>
  );
}

const FRAME_CORNER = 28;
const FRAME_STROKE = 3;

/** The four golden corners that frame a single book. */
export function FrameCorners() {
  const { colors } = useTheme();
  const corner = { borderColor: colors.highlight, width: FRAME_CORNER, height: FRAME_CORNER };
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.corner, corner, styles.topLeft]} />
      <View style={[styles.corner, corner, styles.topRight]} />
      <View style={[styles.corner, corner, styles.bottomLeft]} />
      <View style={[styles.corner, corner, styles.bottomRight]} />
    </View>
  );
}

const ROUND = sizes.minTouchTarget + 4;

const styles = StyleSheet.create({
  scrim: { overflow: 'hidden', borderRadius: radii.pill, borderWidth: sizes.borderWidth },
  round: {
    width: ROUND,
    height: ROUND,
    borderRadius: ROUND / 2,
    borderWidth: sizes.borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pressed: { opacity: 0.85 },
  corner: { position: 'absolute' },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: FRAME_STROKE,
    borderLeftWidth: FRAME_STROKE,
    borderTopLeftRadius: spacing.md,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: FRAME_STROKE,
    borderRightWidth: FRAME_STROKE,
    borderTopRightRadius: spacing.md,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: FRAME_STROKE,
    borderLeftWidth: FRAME_STROKE,
    borderBottomLeftRadius: spacing.md,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: FRAME_STROKE,
    borderRightWidth: FRAME_STROKE,
    borderBottomRightRadius: spacing.md,
  },
});
