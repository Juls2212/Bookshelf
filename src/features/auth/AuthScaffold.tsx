import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import Svg, { G, Path, Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { ShelfLine } from '@/components/ShelfLine';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { coverPalette, fonts, radii, sizes, spacing } from '@/design/tokens';
import { t } from '@/i18n';

export type AuthIllustrationVariant = 'login' | 'register';

const PADDING = spacing.lg + spacing.xs;
const VIEW_W = 360;
const VIEW_H = 150;

// Cover colors sampled from the mockups (same palette as the typographic covers).
const [olive, teal, terracotta, mustard, , rose, caramel, cream, burgundy] = coverPalette.map(
  (c) => c.background,
);

function Band({ x, y, w }: { x: number; y: number; w: number }) {
  const { colors } = useTheme();
  return <Rect x={x} y={y} width={w} height={2.5} rx={1} fill={colors.highlight} />;
}

/** Books standing on the left side of the shelf. */
function StandingBooks({ variant }: { variant: AuthIllustrationVariant }) {
  const ground = VIEW_H;
  if (variant === 'register') {
    return (
      <G>
        <Rect x={22} y={ground - 72} width={22} height={72} rx={2} fill={terracotta} />
        <Band x={26} y={ground - 60} w={14} />
        <Rect x={46} y={ground - 90} width={26} height={90} rx={2} fill={olive} />
        <Rect x={51} y={ground - 78} width={16} height={20} fill={cream} />
        <Rect x={74} y={ground - 64} width={20} height={64} rx={2} fill={mustard} />
        <G transform={`rotate(8 ${108} ${ground})`}>
          <Rect x={96} y={ground - 78} width={24} height={78} rx={2} fill={teal} />
          <Band x={100} y={ground - 70} w={14} />
        </G>
      </G>
    );
  }
  return (
    <G>
      <Rect x={20} y={ground - 74} width={24} height={74} rx={2} fill={olive} />
      <Band x={24} y={ground - 62} w={16} />
      <Band x={24} y={ground - 56} w={16} />
      <Rect x={46} y={ground - 92} width={20} height={92} rx={2} fill={terracotta} />
      <Rect x={50} y={ground - 78} width={12} height={22} fill={cream} />
      <Rect x={68} y={ground - 68} width={28} height={68} rx={2} fill={mustard} />
      <Rect x={74} y={ground - 12} width={16} height={2} fill={burgundy} />
      <Rect x={98} y={ground - 84} width={22} height={84} rx={2} fill={teal} />
      <Band x={102} y={ground - 76} w={14} />
      <G transform={`rotate(12 ${134} ${ground})`}>
        <Rect x={124} y={ground - 80} width={20} height={80} rx={2} fill={burgundy} />
      </G>
    </G>
  );
}

/** Horizontal stack (login) or stack with an open book (register) on the right side. */
function RightSide({ variant }: { variant: AuthIllustrationVariant }) {
  const { colors } = useTheme();
  const ground = VIEW_H;
  const stack = (
    <G>
      <Rect x={220} y={ground - 20} width={124} height={20} rx={3} fill={colors.tagStrong} />
      <Rect x={332} y={ground - 17} width={10} height={14} rx={2} fill={cream} />
      <Rect x={232} y={ground - 37} width={104} height={17} rx={3} fill={rose} />
      <Rect x={326} y={ground - 34} width={8} height={11} rx={2} fill={cream} />
    </G>
  );
  if (variant === 'register') {
    const top = ground - 37;
    return (
      <G>
        {stack}
        <Rect x={222} y={top - 22} width={122} height={22} rx={3} fill={colors.shelf} />
        <Path
          d={`M228 ${top - 20} Q250 ${top - 54} 282 ${top - 44} L282 ${top - 12} Q252 ${top - 20} 228 ${top - 12} Z`}
          fill={cream}
        />
        <Path
          d={`M282 ${top - 44} Q314 ${top - 54} 338 ${top - 20} L338 ${top - 12} Q312 ${top - 20} 282 ${top - 12} Z`}
          fill={cream}
        />
        {[0, 1, 2].map((i) => (
          <G key={i}>
            <Rect
              x={238}
              y={top - 36 + i * 7}
              width={34}
              height={1.5}
              fill={colors.accent}
              opacity={0.6}
            />
            <Rect
              x={292}
              y={top - 36 + i * 7}
              width={34}
              height={1.5}
              fill={colors.accent}
              opacity={0.6}
            />
          </G>
        ))}
        <Rect x={279} y={top - 14} width={6} height={8} fill={colors.accent} />
      </G>
    );
  }
  return (
    <G>
      {stack}
      <Rect x={226} y={ground - 54} width={98} height={17} rx={3} fill={caramel} />
      <Rect x={312} y={ground - 51} width={8} height={11} rx={2} fill={cream} />
      <Rect x={236} y={ground - 46} width={22} height={2} fill={colors.tagStrong} />
      <Rect x={236} y={ground - 11} width={30} height={2} fill={colors.highlight} />
    </G>
  );
}

function Ribbon() {
  const { colors } = useTheme();
  return (
    <Svg width={22} height={96} style={styles.ribbon}>
      <Path d="M0 0 H22 V96 L11 82 L0 96 Z" fill={colors.accent} />
    </Svg>
  );
}

function Header({ variant }: { variant: AuthIllustrationVariant }) {
  return (
    <View style={styles.header}>
      <Ribbon />
      <View
        style={styles.logo}
        accessible
        accessibilityRole="header"
        accessibilityLabel={t.auth.appName}
      >
        <Icon name="library" size={30} strokeWidth={2.25} />
        <AppText variant="display" style={styles.logoText}>
          {t.auth.appName}
        </AppText>
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg
          width="100%"
          height={VIEW_H}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMax meet"
        >
          <StandingBooks variant={variant} />
          <RightSide variant={variant} />
        </Svg>
        <ShelfLine />
      </View>
    </View>
  );
}

type Props = {
  variant: AuthIllustrationVariant;
  children: ReactNode;
};

// Shared layout of the auth screens: textured header with the shelf and a paper sheet below.
export function AuthScaffold({ variant, children }: Props) {
  const { colors } = useTheme();
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen scroll edges={['top', 'left', 'right']} contentStyle={styles.content}>
        <Header variant={variant} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.paperSheet,
              borderColor: colors.border,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <View style={[styles.edge, styles.edgeLeft, { borderColor: colors.border }]} />
          <View style={[styles.edge, styles.edgeRight, { borderColor: colors.border }]} />
          {children}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/** "Te damos la bienvenida *de nuevo*": serif title with an italic emphasis. */
export function AuthTitle({ start, emphasis }: { start: string; emphasis: string }) {
  return (
    <AppText variant="display" accessibilityRole="header">
      {start}
      <AppText variant="display" style={{ fontFamily: fonts.serifItalic }}>
        {emphasis}
      </AppText>
    </AppText>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 0, flexGrow: 1 },
  header: { paddingTop: spacing.lg },
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: PADDING,
    minHeight: sizes.minTouchTarget,
  },
  logoText: { fontSize: 36, lineHeight: 42 },
  ribbon: { position: 'absolute', top: -spacing.lg, right: 36 },
  sheet: {
    flexGrow: 1,
    marginTop: spacing.md,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderWidth: sizes.borderWidth,
    borderBottomWidth: 0,
    paddingHorizontal: PADDING,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  edge: { position: 'absolute', top: radii.sheet, bottom: 0, borderLeftWidth: sizes.borderWidth },
  edgeLeft: { left: 5 },
  edgeRight: { right: 5 },
});
