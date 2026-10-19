// The recommended book on its shelf, with the data-based explanation and the actions:
// "Empezar a leer", "Leer después", "Ver ficha" and "Otra recomendación". It rises and fades in
// when a new recommendation arrives (static with reduce motion).
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
import { Button } from '@/components/Button';
import { ShelfLine } from '@/components/ShelfLine';
import { WarmGlow } from '@/components/WarmGlow';
import { Icon } from '@/design/icons';
import { motion } from '@/design/motion';
import { useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';
import type { WithCover } from '@/features/library/useCoverUris';
import type { Recommendation } from '@/features/recommendations/recommendationRules';
import { format, t } from '@/i18n';
import type { Book } from '@/types/book';

import { DispositionTag, PADDING, panelStyles, ShelfScene } from './LibrarianPanels';

type RecommendationActions = {
  onStartReading: () => void;
  onReadLater: () => void;
  onViewBook: () => void;
  onAnother: () => void;
};

type Props = RecommendationActions & {
  recommendation: Recommendation;
  book: WithCover<Book>;
  /** Shown from the cache without a connection: a note, and no new request. */
  offline: boolean;
};

/** Fade + rise of motion.recommendationArrival each time a different recommendation shows. */
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

function detailsLine(book: Book): string {
  const parts = [
    book.author && book.genre
      ? format(t.librarian.authorGenre, { author: book.author, genre: book.genre })
      : (book.author ?? book.genre),
    book.pageCount ? format(t.librarian.pages, { pages: book.pageCount }) : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

export function RecommendationCard({
  recommendation,
  book,
  offline,
  onStartReading,
  onReadLater,
  onViewBook,
  onAnother,
}: Props) {
  const { colors } = useTheme();
  const arrival = useArrival(recommendation.id);
  const savedForLater = recommendation.disposition === 'read_later';
  const details = detailsLine(book);

  return (
    <Animated.View
      style={[panelStyles.panel, { backgroundColor: colors.featureSurface }, arrival]}
      testID="librarian-result"
    >
      <WarmGlow id="librarian-glow" cx={0.5} cy={0.62} radius={0.5} />
      <ShelfScene
        title={book.title}
        author={book.author}
        coverUri={book.coverUri}
        coverCacheKey={book.coverCacheKey}
      />
      <ShelfLine />
      <View style={styles.text}>
        {offline ? (
          <View style={styles.note} accessibilityLiveRegion="polite">
            <Icon name="cloud-off" size={16} color={colors.textSecondary} />
            <AppText variant="caption" style={styles.flexShrink}>
              {t.recommendations.errors.offline}
            </AppText>
          </View>
        ) : null}
        <AppText variant="label" color="highlight" style={styles.center}>
          {t.librarian.pickLabel}
        </AppText>
        <AppText
          variant="display"
          style={styles.center}
          accessibilityRole="header"
          numberOfLines={4}
        >
          {book.title}
        </AppText>
        {details ? (
          <AppText variant="body" color="textSecondary" style={styles.center} numberOfLines={3}>
            {details}
          </AppText>
        ) : null}
        {recommendation.disposition !== 'suggested' ? (
          <View style={styles.tagRow}>
            <DispositionTag disposition={recommendation.disposition} />
          </View>
        ) : null}
        <AppText variant="body" style={[styles.center, styles.reason]}>
          {recommendation.rationale}
        </AppText>
      </View>
      <View style={styles.row}>
        {book.readingStatus === 'to_read' ? (
          <View style={styles.flex}>
            <Button label={t.librarian.startReading} icon="book" onPress={onStartReading} />
          </View>
        ) : null}
        <View style={styles.flex}>
          <Button
            variant="secondary"
            icon={savedForLater ? 'check' : 'clock'}
            label={savedForLater ? t.librarian.savedLater : t.librarian.readLater}
            disabled={savedForLater}
            onPress={onReadLater}
          />
        </View>
      </View>
      <View style={styles.links}>
        <Button variant="link" icon="eye" label={t.librarian.viewBook} onPress={onViewBook} />
        {offline ? null : (
          <Button variant="link" icon="refresh" label={t.librarian.another} onPress={onAnother} />
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  text: { gap: spacing.xs, paddingHorizontal: PADDING, paddingTop: spacing.sm },
  center: { textAlign: 'center' },
  reason: { marginTop: spacing.sm },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  flexShrink: { flexShrink: 1 },
  tagRow: { alignItems: 'center', marginTop: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, paddingHorizontal: PADDING },
  flex: { flex: 1 },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.lg,
  },
});
