import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, type DimensionValue } from 'react-native';

import { useTheme } from '@/design/ThemeProvider';
import { radii } from '@/design/tokens';

type Props = {
  width?: DimensionValue;
  height?: number;
  radius?: number;
};

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduce(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

// Loading placeholder with a calm opacity pulse; static when reduce motion is on.
export function Skeleton({ width = '100%', height = 16, radius = radii.field / 2 }: Props) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.7);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity, reduceMotion]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: radius, backgroundColor: colors.track, opacity }}
    />
  );
}
