import { useEffect, type ReactNode } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '@/design/motion';

export type ShelfMotionKind = 'none' | 'arrival' | 'drop';

type Props = {
  kind: ShelfMotionKind;
  /** Position in the list, used for the arrival stagger. */
  index: number;
  children: ReactNode;
};

/**
 * Plays once on mount: "arrival" (rise + fade, staggered) or "drop" (new book settles).
 * With the system "reduce motion" setting on, children are shown immediately.
 * Uses `.get()/.set()` on shared values, the React Compiler-safe Reanimated API.
 */
export function ShelfMotion({ kind, index, children }: Props) {
  const reduceMotion = useReducedMotion();
  const animate =
    !reduceMotion &&
    (kind === 'drop' || (kind === 'arrival' && index < motion.shelfArrival.maxAnimatedTiles));
  const progress = useSharedValue(animate ? 0 : 1);
  const offset = kind === 'drop' ? motion.newBookDrop.offsetY : motion.shelfArrival.offsetY;

  useEffect(() => {
    if (!animate) return;
    if (kind === 'drop') {
      progress.set(
        withTiming(1, {
          duration: motion.newBookDrop.durationMs,
          easing: Easing.out(Easing.back(1.4)),
        }),
      );
    } else {
      progress.set(
        withDelay(
          index * motion.shelfArrival.staggerMs,
          withTiming(1, {
            duration: motion.shelfArrival.durationMs,
            easing: Easing.out(Easing.cubic),
          }),
        ),
      );
    }
    // Plays once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: kind === 'drop' ? Math.min(1, p * 2) : p,
      transform: [{ translateY: (1 - p) * offset }],
    };
  });

  return <Animated.View style={style}>{children}</Animated.View>;
}
