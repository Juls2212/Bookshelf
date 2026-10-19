// A "Nuevas aventuras" suggestion: a book that is NOT on the shelf. It is always tagged as such,
// shows whether an open catalog confirmed it, carries an AI disclaimer (and a stronger warning
// when the model was unsure) and never links to a store. It becomes a book only through the
// editable add form. It rises and fades in when it arrives (static with reduce motion).
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { BookCover } from '@/components/BookCover';
import { Button } from '@/components/Button';
import { WarmGlow } from '@/components/WarmGlow';
import { Icon, type IconName } from '@/design/icons';
import { motion } from '@/design/motion';
import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing, typeScale, type ColorToken } from '@/design/tokens';
import type {
  Recommendation,
  SuggestedBookInfo,
} from '@/features/recommendations/recommendationRules';
import { format, t } from '@/i18n';

import { DispositionTag, PADDING, panelStyles } from './LibrarianPanels';

const d = t.librarian.discovery;

type DiscoveryActions = {
  onAdd: () => void;
  onSaveIdea: () => void;
  onAnother: () => void;
};

type Props = DiscoveryActions & {
  recommendation: Recommendation & { suggestion: SuggestedBookInfo };
  /** Shown from the cache without a connection: a note, and no new request. */
  offline: boolean;
};

function useArrival(key: string) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      progress.set(1);
      return;
    }
    progress.set(0);
    progress.set(
      withTiming(1, {
        duration: motion.recommendationArrival.durationMs,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [key, reduceMotion, progress]);
  return useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * motion.recommendationArrival.offsetY }],
  }));
}

/** "Fuera de tu estante": icon + words, used on the card and in the history. */
export function OutsideShelfTag() {
  const { colors } = useTheme();
  return (
    <View style={[styles.tag, { borderColor: colors.accentText }]} testID="outside-shelf-tag">
      <Icon name="sparkles" size={12} color={colors.accentText} strokeWidth={2} />
      <AppText style={[typeScale.tag, styles.tagText, { color: colors.accentText }]}>
        {d.outsideTag}
      </AppText>
    </View>
  );
}

/** One line with an icon (never color alone). */
function Note({
  icon,
  color,
  text,
  testID,
}: {
  icon: IconName;
  color: ColorToken;
  text: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.note} testID={testID}>
      <Icon name={icon} size={16} color={colors[color]} />
      <AppText variant="caption" color="textSecondary" style={styles.flexShrink}>
        {text}
      </AppText>
    </View>
  );
}

export function discoveryDetails(s: SuggestedBookInfo): string {
  return [s.author, s.genre, s.pageCount ? format(t.librarian.pages, { pages: s.pageCount }) : null]
    .filter(Boolean)
    .join(' · ');
}

export function DiscoveryCard({ recommendation, offline, onAdd, onSaveIdea, onAnother }: Props) {
  const { colors } = useTheme();
  const arrival = useArrival(recommendation.id);
  const s = recommendation.suggestion;
  const saved = recommendation.disposition === 'read_later';
  const details = discoveryDetails(s);

  return (
    <Animated.View
      style={[panelStyles.panel, styles.panel, { backgroundColor: colors.featureSurface }, arrival]}
      testID="discovery-result"
    >
      <WarmGlow id="discovery-glow" cx={0.5} cy={0.3} radius={0.55} />
      {offline ? <Note icon="cloud-off" color="textSecondary" text={d.offlineNote} /> : null}
      <View style={styles.top}>
        <BookCover title={s.title} author={s.author} size="lg" />
        <View style={styles.info}>
          <OutsideShelfTag />
          <AppText variant="title" accessibilityRole="header" numberOfLines={5}>
            {s.title}
          </AppText>
          {details ? (
            <AppText variant="body" color="textSecondary" numberOfLines={3}>
              {details}
            </AppText>
          ) : null}
          {recommendation.disposition !== 'suggested' ? (
            <DispositionTag disposition={recommendation.disposition} />
          ) : null}
        </View>
      </View>
      <AppText variant="body">{recommendation.rationale}</AppText>
      <View style={styles.notes}>
        <Note
          icon={s.verified ? 'check' : 'alert-circle'}
          color={s.verified ? 'success' : 'warning'}
          text={s.verified ? d.verified : d.unverified}
          testID={s.verified ? 'discovery-verified' : 'discovery-unverified'}
        />
        {s.confidence === 'low' ? (
          <Note icon="alert-circle" color="warning" text={d.lowConfidence} testID="discovery-low" />
        ) : null}
        <Note icon="sparkles" color="textSecondary" text={d.aiDisclaimer} />
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button label={d.add} icon="plus" onPress={onAdd} />
        </View>
        <View style={styles.flex}>
          <Button
            variant="secondary"
            icon={saved ? 'check' : 'clock'}
            label={saved ? d.ideaSaved : d.saveIdea}
            disabled={saved}
            onPress={onSaveIdea}
          />
        </View>
      </View>
      {offline ? null : (
        <View style={styles.links}>
          <Button variant="link" icon="refresh" label={d.another} onPress={onAnother} />
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: PADDING, paddingTop: spacing.xl },
  top: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  info: { flex: 1, gap: spacing.xs, alignItems: 'flex-start' },
  notes: { gap: spacing.sm },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flexShrink: { flexShrink: 1 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex: { flex: 1 },
  links: { alignItems: 'center' },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: sizes.borderWidth,
    borderRadius: radii.tag,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  tagText: { textTransform: 'uppercase' },
});
