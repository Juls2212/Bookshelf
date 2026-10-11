import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';

import { useTheme } from '@/design/ThemeProvider';
import { spacing, textureDotOpacity } from '@/design/tokens';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  texture?: boolean;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
};

function DotTexture() {
  const { colors, scheme } = useTheme();
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <Pattern id="paper-dots" width={6} height={6} patternUnits="userSpaceOnUse">
          <Circle
            cx={1}
            cy={1}
            r={0.6}
            fill={colors.textureDot}
            fillOpacity={textureDotOpacity[scheme]}
          />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#paper-dots)" />
    </Svg>
  );
}

// Safe-area screen with the paper background. `texture={false}` gives a plain color.
export function Screen({
  children,
  scroll = false,
  texture = true,
  edges = ['top', 'left', 'right'],
  contentStyle,
}: Props) {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {texture ? <DotTexture /> : null}
      <SafeAreaView style={styles.root} edges={edges}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={[styles.content, contentStyle]}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.root, styles.content, contentStyle]}>{children}</View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.lg },
});
