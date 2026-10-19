// Shared pieces of the Librero's dark panel: the shelf scene behind the cover, message panels
// (invitation, errors, empty states), the loading state and the disposition tag.
import { StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { BookCover } from '@/components/BookCover';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { WarmGlow } from '@/components/WarmGlow';
import { Icon, type IconName } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import {
  radii,
  sceneSpineBand,
  sceneSpines,
  sizes,
  spacing,
  typeScale,
  type ColorToken,
} from '@/design/tokens';
import type { Disposition } from '@/features/recommendations/recommendationRules';
import { t } from '@/i18n';

export const PADDING = spacing.lg + spacing.xs;

// Decorative spines on both sides of the recommended cover (viewBox units).
const SPINES = [
  { x: 0, w: 22, h: 150, band: 30 },
  { x: 24, w: 18, h: 170 },
  { x: 44, w: 30, h: 140, band: 110 },
  { x: 76, w: 22, h: 162 },
  { x: 100, w: 26, h: 146 },
  { x: 250, w: 22, h: 156, band: 120 },
  { x: 274, w: 28, h: 138 },
  { x: 304, w: 20, h: 172, band: 40 },
  { x: 326, w: 22, h: 150 },
  { x: 350, w: 26, h: 160 },
];
const SCENE_HEIGHT = 190;

export function ShelfScene({
  title,
  author,
  coverUri,
  coverCacheKey,
}: {
  title: string;
  author: string | null;
  coverUri?: string | null;
  coverCacheKey?: string | null;
}) {
  return (
    <View style={styles.scene}>
      <Svg
        width="100%"
        height={SCENE_HEIGHT}
        viewBox={`0 0 376 ${SCENE_HEIGHT}`}
        preserveAspectRatio="xMidYMax slice"
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {SPINES.map((s, i) => (
          <Rect
            key={s.x}
            x={s.x}
            y={SCENE_HEIGHT - s.h}
            width={s.w}
            height={s.h}
            fill={sceneSpines[i % sceneSpines.length]}
          />
        ))}
        {SPINES.filter((s) => s.band).map((s) => (
          <Rect
            key={`band-${s.x}`}
            x={s.x + 3}
            y={SCENE_HEIGHT - (s.band ?? 0)}
            width={s.w - 6}
            height={2}
            fill={sceneSpineBand}
          />
        ))}
      </Svg>
      <View style={styles.sceneCover}>
        <BookCover
          title={title}
          author={author}
          coverUri={coverUri}
          coverCacheKey={coverCacheKey}
          size="xl"
        />
      </View>
    </View>
  );
}

type PanelAction = { label: string; onPress: () => void; icon?: IconName };

export function MessagePanel({
  icon,
  title,
  text,
  action,
  testID,
}: {
  icon: IconName;
  title: string;
  text: string;
  action?: PanelAction;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.panel, styles.message, { backgroundColor: colors.featureSurface }]}
      testID={testID}
      accessibilityLiveRegion="polite"
    >
      <WarmGlow id="librarian-message-glow" cx={0.5} cy={0.2} radius={0.6} />
      <Icon name={icon} size={28} color={colors.highlight} />
      <AppText variant="title" style={styles.center} accessibilityRole="header">
        {title}
      </AppText>
      <AppText variant="body" color="textSecondary" style={styles.center}>
        {text}
      </AppText>
      {action ? <Button label={action.label} icon={action.icon} onPress={action.onPress} /> : null}
    </View>
  );
}

/**
 * While the Librero thinks: a pulsing placeholder (static with reduce motion) and, for a
 * request, Cancelar.
 */
export function LoadingPanel({
  onCancel,
  message = t.librarian.loading,
}: {
  onCancel?: () => void;
  message?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.panel, styles.message, { backgroundColor: colors.featureSurface }]}
      testID="librarian-loading"
    >
      <Skeleton width={150} height={210} radius={radii.tag} />
      <AppText
        variant="body"
        color="textSecondary"
        style={styles.center}
        accessibilityLiveRegion="polite"
      >
        {message}
      </AppText>
      {onCancel ? (
        <Button variant="secondary" icon="x" label={t.librarian.cancel} onPress={onCancel} />
      ) : null}
    </View>
  );
}

const dispositionLook: Record<Disposition, { icon: IconName; color: ColorToken }> = {
  suggested: { icon: 'sparkles', color: 'accentText' },
  viewed: { icon: 'eye', color: 'textSecondary' },
  read_later: { icon: 'clock', color: 'success' },
  skipped: { icon: 'x', color: 'textMuted' },
};

/** Icon + words (never color alone). */
export function DispositionTag({ disposition }: { disposition: Disposition }) {
  const { colors } = useTheme();
  const look = dispositionLook[disposition];
  const color = colors[look.color];
  return (
    <View style={[styles.tag, { borderColor: color }]}>
      <Icon name={look.icon} size={12} color={color} strokeWidth={2} />
      <AppText style={[typeScale.tag, styles.tagText, { color }]}>
        {t.librarian.dispositions[disposition]}
      </AppText>
    </View>
  );
}

export const panelStyles = StyleSheet.create({
  panel: {
    flexGrow: 1,
    overflow: 'hidden',
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
});

const styles = StyleSheet.create({
  panel: panelStyles.panel,
  scene: { height: SCENE_HEIGHT + spacing.lg, justifyContent: 'flex-end' },
  sceneCover: { alignItems: 'center' },
  center: { textAlign: 'center' },
  message: {
    alignItems: 'center',
    paddingHorizontal: PADDING,
    paddingTop: spacing.xxl,
    minHeight: 360,
    gap: spacing.md,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    borderWidth: sizes.borderWidth,
    borderRadius: radii.tag,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  tagText: { textTransform: 'uppercase' },
});
