import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/design/ThemeProvider';
import { format, t } from '@/i18n';

type Props = {
  percent: number;
  /** `default`: line + caramel bookmark ribbon. `mini`: thin line only (tiles). */
  variant?: 'default' | 'mini';
};

const RIBBON = { width: 14, height: 24, notch: 6 };
const LINE_TOP = 9;

// Static editorial progress line. Animation comes in a later phase.
export function ProgressBar({ percent, variant = 'default' }: Props) {
  const { colors } = useTheme();
  const value = Math.min(100, Math.max(0, Math.round(percent)));
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
      <View
        style={[
          styles.track,
          { height: lineHeight, top: mini ? 0 : LINE_TOP, backgroundColor: colors.track },
        ]}
      >
        <View style={[styles.fill, { width: `${value}%`, backgroundColor: colors.textPrimary }]} />
      </View>
      {mini ? null : (
        <Svg
          width={RIBBON.width}
          height={RIBBON.height}
          style={[styles.ribbon, { left: `${value}%` }]}
        >
          <Path
            d={`M0 0 H${RIBBON.width} V${RIBBON.height} L${RIBBON.width / 2} ${
              RIBBON.height - RIBBON.notch
            } L0 ${RIBBON.height} Z`}
            fill={colors.accent}
          />
        </Svg>
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
