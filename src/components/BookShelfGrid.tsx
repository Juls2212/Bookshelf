import { memo, useState, type ReactElement } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type RefreshControlProps,
} from 'react-native';

import { sizes, spacing } from '@/design/tokens';

import { BookTile, type BookTileData } from './BookTile';
import { COVER_ASPECT } from './BookCover';
import { ShelfLine } from './ShelfLine';
import { ShelfMotion, type ShelfMotionKind } from './ShelfMotion';

const COLUMNS = 4;
const COLUMN_GAP = spacing.md;

type Props = {
  books: readonly BookTileData[];
  onPressBook?: (book: BookTileData) => void;
  ListHeaderComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement | null;
  horizontalPadding?: number;
  /** Set to false when rendered inside another ScrollView (avoids nested virtualized lists). */
  virtualized?: boolean;
  /** Pull-to-refresh control (virtualized mode only). */
  refreshControl?: ReactElement<RefreshControlProps>;
  /** Entry animation per tile (index = position in `books`). Default: none. */
  motionFor?: (book: BookTileData, index: number) => ShelfMotionKind;
};

type Row = { key: string; books: BookTileData[]; start: number };

function toRows(books: readonly BookTileData[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < books.length; i += COLUMNS) {
    const slice = books.slice(i, i + COLUMNS);
    rows.push({ key: slice.map((b) => b.id).join('|'), books: slice, start: i });
  }
  return rows;
}

type ShelfRowProps = {
  row: Row;
  columnWidth: number;
  horizontalPadding: number;
  onPressBook?: (book: BookTileData) => void;
  motionFor?: (book: BookTileData, index: number) => ShelfMotionKind;
};

const ShelfRow = memo(function ShelfRow({
  row,
  columnWidth,
  horizontalPadding,
  onPressBook,
  motionFor,
}: ShelfRowProps) {
  const coverArea = Math.round(columnWidth * COVER_ASPECT);
  return (
    <View style={[styles.row, { paddingHorizontal: horizontalPadding }]}>
      <View style={[styles.shelf, { top: coverArea }]}>
        <ShelfLine />
      </View>
      {row.books.map((book, column) => {
        const index = row.start + column;
        return (
          <ShelfMotion key={book.id} kind={motionFor?.(book, index) ?? 'none'} index={index}>
            <BookTile
              book={book}
              width={columnWidth}
              onPress={onPressBook}
              infoSpacing={sizes.shelfHeight + spacing.md}
            />
          </ShelfMotion>
        );
      })}
    </View>
  );
});

// Four columns with a 9px wooden shelf under every row of covers.
export function BookShelfGrid({
  books,
  onPressBook,
  ListHeaderComponent,
  ListEmptyComponent,
  horizontalPadding = spacing.lg + spacing.xs,
  virtualized = true,
  refreshControl,
  motionFor,
}: Props) {
  const [width, setWidth] = useState(0);
  const rows = toRows(books);
  const columnWidth = Math.floor(
    (width - horizontalPadding * 2 - COLUMN_GAP * (COLUMNS - 1)) / COLUMNS,
  );
  const ready = columnWidth > 0;

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const renderRow = (row: Row) => (
    <ShelfRow
      key={row.key}
      row={row}
      columnWidth={columnWidth}
      horizontalPadding={horizontalPadding}
      onPressBook={onPressBook}
      motionFor={motionFor}
    />
  );

  if (!virtualized) {
    return (
      <View onLayout={onLayout}>
        {ListHeaderComponent}
        {rows.length === 0 ? ListEmptyComponent : ready ? rows.map(renderRow) : null}
      </View>
    );
  }

  return (
    <FlatList
      onLayout={onLayout}
      data={ready ? rows : []}
      keyExtractor={(row) => row.key}
      renderItem={({ item }) => renderRow(item)}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={books.length === 0 ? ListEmptyComponent : null}
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      windowSize={7}
      removeClippedSubviews
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: COLUMN_GAP,
    marginBottom: spacing.xl,
    paddingTop: spacing.md,
  },
  shelf: { position: 'absolute', left: 0, right: 0, marginTop: spacing.md },
});
