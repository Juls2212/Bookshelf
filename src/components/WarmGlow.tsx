import { StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/design/ThemeProvider';

type Props = {
  /** Glow center as fractions of the box (0-1). */
  cx?: number;
  cy?: number;
  radius?: number;
  id: string;
};

// The only "light" in the UI: a soft warm glow behind recommendations. Decorative.
export function WarmGlow({ cx = 0.7, cy = 0.4, radius = 0.6, id }: Props) {
  const { colors } = useTheme();
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <RadialGradient id={id} cx={cx} cy={cy} r={radius} gradientUnits="objectBoundingBox">
          <Stop offset="0" stopColor={colors.featureGlow} stopOpacity={0.9} />
          <Stop offset="1" stopColor={colors.featureGlow} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
