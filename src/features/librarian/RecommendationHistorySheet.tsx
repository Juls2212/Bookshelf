// "Historial": past recommendations (newest first) with "Todas" / "Leer después". A shelf
// recommendation opens the ficha (a book no longer on the shelf is shown as unavailable); a
// "Nuevas aventuras" suggestion is tagged "Fuera de tu estante" and, when saved as an idea,
// offers "Añadir a mi estante".
import { useRouter } from 'expo-router';
import { memo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BookCover } from '@/components/BookCover';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { useTheme } from '@/design/ThemeProvider';
import { sizes, spacing } from '@/design/tokens';
import { useCoverUris, type WithCover } from '@/features/library/useCoverUris';
import { suggestionToParams } from '@/features/recommendations/addFromSuggestion';
import type { Recommendation } from '@/features/recommendations/recommendationRules';
import { format, t } from '@/i18n';
import { formatRelativeDays } from '@/lib/dates';
import type { Book } from '@/types/book';

import { discoveryDetails, OutsideShelfTag } from './DiscoveryCard';
import { DispositionTag } from './LibrarianPanels';
import { filterHistory, type HistoryFilter } from './librarianView';

const FILTERS: HistoryFilter[] = ['all', 'read_later'];
/** Keeps the sheet below the status bar on small screens. */
const LIST_MAX_HEIGHT = 420;

type Props = {
  visible: boolean;
  onClose: () => void;
  history: readonly Recommendation[];
  books: readonly Book[];
};

export function RecommendationHistorySheet({ visible, onClose, history, books }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const shown = filterHistory(history, filter);
  const byId = new Map(books.map((book) => [book.id, book]));
  const shownBooks = shown
    .map((r) => (r.bookId ? byId.get(r.bookId) : undefined))
    .filter((b): b is Book => Boolean(b));
  const covers = new Map(useCoverUris(shownBooks).map((book) => [book.id, book]));
  // One clock per open sheet keeps the memoized rows stable while scrolling.
  const [now] = useState(() => new Date());

  const open = (bookId: string) => {
    onClose();
    router.push({ pathname: '/book/[id]', params: { id: bookId } });
  };

  const add = (recommendation: Recommendation) => {
    const params = suggestionToParams(recommendation);
    if (!params) return;
    onClose();
    router.push({ pathname: '/book/new', params });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t.librarian.historyTitle}>
      <View style={styles.chips}>
        {FILTERS.map((value) => (
          <Chip
            key={value}
            label={t.librarian.historyFilters[value]}
            selected={filter === value}
            onPress={() => setFilter(value)}
          />
        ))}
      </View>
      {shown.length === 0 ? (
        <AppText variant="body" color="textSecondary" testID="history-empty">
          {filter === 'all' ? t.librarian.historyEmpty : t.librarian.historyEmptyLater}
        </AppText>
      ) : (
        // Virtualized: the history grows with every request.
        <FlatList
          data={shown}
          keyExtractor={keyOf}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          initialNumToRender={8}
          windowSize={5}
          renderItem={({ item }) => (
            <HistoryRow
              recommendation={item}
              book={item.bookId ? covers.get(item.bookId) : undefined}
              now={now}
              onOpen={open}
              onAdd={add}
            />
          )}
        />
      )}
    </BottomSheet>
  );
}

const keyOf = (recommendation: Recommendation) => recommendation.id;

type RowProps = {
  recommendation: Recommendation;
  book: WithCover<Book> | undefined;
  now: Date;
  onOpen: (bookId: string) => void;
  onAdd: (recommendation: Recommendation) => void;
};

const HistoryRow = memo(function HistoryRow({
  recommendation,
  book,
  now,
  onOpen,
  onAdd,
}: RowProps) {
  const { colors } = useTheme();
  const row = [styles.row, { borderBottomColor: colors.border }];
  const date = formatRelativeDays(new Date(recommendation.createdAt), now);
  const disposition = t.librarian.dispositions[recommendation.disposition];

  if (recommendation.kind === 'discovery' && recommendation.suggestion) {
    const s = recommendation.suggestion;
    const details = discoveryDetails(s);
    return (
      <View style={row} testID={`history-discovery-${recommendation.id}`}>
        <BookCover title={s.title} author={s.author} size="sm" decorative />
        <View style={styles.info}>
          <View
            accessible
            accessibilityLabel={format(t.librarian.discovery.historyItemA11y, {
              title: s.title,
              date,
              disposition,
            })}
            style={styles.info}
          >
            <AppText variant="body" color="textPrimary" numberOfLines={2}>
              {s.title}
            </AppText>
            {details ? <AppText variant="caption">{details}</AppText> : null}
            <AppText variant="caption">{date}</AppText>
            <View style={styles.tags}>
              <OutsideShelfTag />
              <DispositionTag disposition={recommendation.disposition} />
            </View>
          </View>
          {recommendation.disposition === 'read_later' ? (
            <Button
              variant="secondary"
              icon="plus"
              label={t.librarian.discovery.add}
              onPress={() => onAdd(recommendation)}
            />
          ) : null}
        </View>
      </View>
    );
  }

  if (!book) {
    return (
      <View
        style={row}
        accessible
        accessibilityLabel={format(t.librarian.historyUnavailableA11y, { date, disposition })}
        testID={`history-unavailable-${recommendation.id}`}
      >
        <View style={[styles.placeholder, { borderColor: colors.border }]} />
        <View style={styles.info}>
          <AppText variant="body" color="textSecondary">
            {t.librarian.historyUnavailable}
          </AppText>
          <AppText variant="caption">{date}</AppText>
          <DispositionTag disposition={recommendation.disposition} />
        </View>
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => onOpen(book.id)}
      accessibilityRole="button"
      accessibilityLabel={format(t.librarian.historyItemA11y, {
        title: book.title,
        date,
        disposition,
      })}
      style={({ pressed }) => [...row, pressed && styles.pressed]}
      testID={`history-item-${recommendation.id}`}
    >
      <BookCover
        title={book.title}
        coverUri={book.coverUri}
        coverCacheKey={book.coverCacheKey}
        size="sm"
        decorative
      />
      <View style={styles.info}>
        <AppText variant="body" color="textPrimary" numberOfLines={2}>
          {book.title}
        </AppText>
        <AppText variant="caption">{date}</AppText>
        <DispositionTag disposition={recommendation.disposition} />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  list: { maxHeight: LIST_MAX_HEIGHT },
  listContent: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: sizes.minTouchTarget,
    borderBottomWidth: sizes.borderWidth,
  },
  placeholder: {
    width: 56,
    height: 80,
    borderWidth: sizes.borderWidth,
    borderStyle: 'dashed',
    borderRadius: 4,
  },
  info: { flex: 1, gap: spacing.xxs, alignItems: 'flex-start' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pressed: { opacity: 0.85 },
});
