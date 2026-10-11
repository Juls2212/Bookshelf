import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/design/ThemeProvider';
import { sizes } from '@/design/tokens';

// 9px wooden shelf that holds the covers. Decorative.
export function ShelfLine() {
  const { colors } = useTheme();
  return (
    <View
      style={styles.container}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width="100%" height={sizes.shelfHeight}>
        <Defs>
          <LinearGradient id="shelf-wood" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.shelf} />
            <Stop offset="1" stopColor={colors.shelfEnd} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height={sizes.shelfHeight} rx={2} fill="url(#shelf-wood)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: sizes.shelfHeight, width: '100%' },
});
