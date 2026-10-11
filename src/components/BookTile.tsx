import { Pressable, StyleSheet, View } from 'react-native';

import { coverHeightFactorFor } from '@/design/coverColor';
import { fonts, spacing } from '@/design/tokens';
import { format, t } from '@/i18n';
import { computeProgressPercent, isLent } from '@/lib/book';
import type { Book } from '@/types/book';

import { AppText } from './AppText';
import { BookCover, COVER_ASPECT } from './BookCover';
import { ProgressBar } from './ProgressBar';

export type BookTileData = Pick<
  Book,
  'id' | 'title' | 'author' | 'coverUri' | 'readingStatus' | 'currentPage' | 'pageCount' | 'lentTo'
> & { coverCacheKey?: string | null };

type Props = {
  book: BookTileData;
  width: number;
  onPress?: (book: BookTileData) => void;
  /** Defaults to true while the book is being read. */
  showProgress?: boolean;
  /** Space between the cover area and the text (the grid puts the shelf there). */
  infoSpacing?: number;
};

export function BookTile({ book, width, onPress, showProgress, infoSpacing = spacing.sm }: Props) {
  const reading = book.readingStatus === 'reading';
  const lent = isLent(book);
  const percent = computeProgressPercent(book.currentPage, book.pageCount);
  const withProgress = showProgress ?? reading;

  const labelParts = [
    book.author ? format(t.book.tileA11y, { title: book.title, author: book.author }) : book.title,
    withProgress ? format(t.book.progressA11y, { percent }) : null,
    lent ? t.statusTag.lent : null,
  ];

  return (
    <Pressable
      onPress={onPress ? () => onPress(book) : undefined}
      accessibilityRole="button"
      accessibilityLabel={labelParts.filter(Boolean).join(', ')}
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
    >
      <View style={[styles.coverArea, { height: Math.round(width * COVER_ASPECT) }]}>
        <BookCover
          title={book.title}
          author={book.author}
          coverUri={book.coverUri}
          coverCacheKey={book.coverCacheKey}
          width={width}
          heightFactor={coverHeightFactorFor(book.title)}
          ribbon={reading}
          lent={lent}
          decorative
        />
      </View>
      <View style={[styles.info, { marginTop: infoSpacing }]}>
        <AppText numberOfLines={2} style={styles.title}>
          {book.title}
        </AppText>
        {book.author ? (
          <AppText variant="caption" numberOfLines={1}>
            {book.author}
          </AppText>
        ) : null}
        {withProgress ? (
          <View style={styles.progressRow} importantForAccessibility="no-hide-descendants">
            <ProgressBar percent={percent} variant="mini" />
            <AppText variant="caption" color="accentText" style={styles.percent}>
              {format(t.book.progressShort, { percent })}
            </AppText>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  coverArea: { justifyContent: 'flex-end' },
  info: { gap: spacing.xxs },
  title: { fontFamily: fonts.sansMedium, fontSize: 15, lineHeight: 19 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 },
  percent: { fontFamily: fonts.sansBold, fontSize: 12 },
  pressed: { opacity: 0.85 },
});
