import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BookShelfGrid } from '@/components/BookShelfGrid';
import type { BookTileData } from '@/components/BookTile';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { FilterTabs, type LibraryFilter } from '@/components/FilterTabs';
import { Screen } from '@/components/Screen';
import { SearchField } from '@/components/SearchField';
import { ShelfLine } from '@/components/ShelfLine';
import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { Icon } from '@/design/icons';
import { shelfArrivalTotalMs } from '@/design/motion';
import { useTheme } from '@/design/ThemeProvider';
import { fonts, radii, sizes, spacing } from '@/design/tokens';
import { filterBooks } from '@/features/library/filterBooks';
import { libraryCountLabel } from '@/features/library/libraryCopy';
import { shelfSession } from '@/features/library/shelfSession';
import { useCoverUris } from '@/features/library/useCoverUris';
import { format, t } from '@/i18n';
import { useLibraryStore } from '@/stores/libraryStore';

const PADDING = spacing.lg + spacing.xs;

function TitleRow({ count, onAdd }: { count: number | null; onAdd?: () => void }) {
  return (
    <View style={styles.titleRow}>
      <View style={styles.titleText}>
        <AppText variant="display" accessibilityRole="header">
          {t.library.title}
        </AppText>
        {count === null ? (
          <Skeleton width={160} height={14} />
        ) : (
          <AppText variant="body" color="textSecondary">
            {libraryCountLabel(count)}
          </AppText>
        )}
      </View>
      {onAdd ? <Button icon="plus" label={t.library.add} onPress={onAdd} /> : null}
    </View>
  );
}

function SkeletonShelves() {
  return (
    <View style={styles.gapXl}>
      {[0, 1].map((row) => (
        <View key={row}>
          <View style={[styles.skeletonRow, { paddingHorizontal: PADDING }]}>
            {[0, 1, 2, 3].map((col) => (
              <View key={col} style={styles.flex}>
                <Skeleton height={110} radius={radii.tag} />
              </View>
            ))}
          </View>
          <ShelfLine />
        </View>
      ))}
    </View>
  );
}

function NoResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <View style={[styles.message, { paddingHorizontal: PADDING }]}>
      <AppText variant="heading">{t.library.noResultsTitle}</AppText>
      <AppText variant="body" color="textSecondary">
        {query.trim()
          ? format(t.library.noResultsQuery, { query: query.trim() })
          : t.library.noResultsFilter}
      </AppText>
      <AppText variant="caption">{t.library.noResultsHint}</AppText>
      {query ? (
        <Button variant="secondary" label={t.library.clearSearch} onPress={onClear} />
      ) : null}
    </View>
  );
}

function LoadError({ offline, onRetry }: { offline: boolean; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.message, { paddingHorizontal: PADDING }]} accessibilityLiveRegion="polite">
      <Icon name="alert-circle" size={28} color={colors.danger} />
      <AppText variant="heading" accessibilityRole="header">
        {t.library.errorTitle}
      </AppText>
      <AppText variant="body" color="textSecondary">
        {offline ? t.library.errorOffline : t.library.errorGeneric}
      </AppText>
      <Button icon="refresh" label={t.library.retry} onPress={onRetry} />
    </View>
  );
}

/** Temporary filter set by "Ver {genre}" in the ficha; dismissible. */
function GenreChip({ genre, onClear }: { genre: string; onClear: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onClear}
      accessibilityRole="button"
      accessibilityLabel={format(t.library.genreChip, { genre })}
      accessibilityHint={t.library.clearGenre}
      style={[styles.genreChip, { backgroundColor: colors.actionPrimary }]}
    >
      <AppText variant="caption" color="actionPrimaryText" style={styles.genreText}>
        {format(t.library.genreChip, { genre })}
      </AppText>
      <Icon name="x" size={sizes.iconSm} color={colors.actionPrimaryText} />
    </Pressable>
  );
}

/** How long the dropped cover keeps its animation slot before the param is cleared. */
const DROP_CLEAR_MS = 800;

export default function LibraryScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const books = useLibraryStore((state) => state.books);
  const status = useLibraryStore((state) => state.status);
  const errorCode = useLibraryStore((state) => state.errorCode);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const { genre, added } = useLocalSearchParams<{ genre?: string; added?: string }>();
  // The shelf arrival plays on the first library open of the session.
  const [arrivalActive, setArrivalActive] = useState(() => !shelfSession.arrivalPlayed);
  const hasBooks = books.length > 0;

  useEffect(() => {
    if (!arrivalActive || !hasBooks) return;
    shelfSession.arrivalPlayed = true;
    const timer = setTimeout(() => setArrivalActive(false), shelfArrivalTotalMs + 100);
    return () => clearTimeout(timer);
  }, [arrivalActive, hasBooks]);

  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => router.setParams({ added: undefined }), DROP_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [added, router]);

  useEffect(() => {
    const store = useLibraryStore.getState();
    if (store.status === 'idle') store.load();
    else store.refresh();
  }, []);

  const results = useCoverUris(filterBooks(books, { query, filter, genre }));

  const onRefresh = async () => {
    setRefreshing(true);
    await useLibraryStore.getState().refresh();
    setRefreshing(false);
    const { status: after, books: current } = useLibraryStore.getState();
    if (after === 'error' && current.length > 0) toast.show(t.library.refreshFailed, 'error');
  };
  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.accent}
      colors={[colors.accent]}
      progressBackgroundColor={colors.surface}
    />
  );
  const addBook = () => router.push('/book/new');
  const openBook = (book: BookTileData) =>
    router.push({ pathname: '/book/[id]', params: { id: book.id } });

  // First load: skeleton shelves.
  if ((status === 'idle' || status === 'loading') && books.length === 0) {
    return (
      <Screen contentStyle={styles.noPadding}>
        <View style={[styles.header, { paddingHorizontal: PADDING }]}>
          <TitleRow count={null} />
          <Skeleton height={52} radius={radii.surface} />
        </View>
        <SkeletonShelves />
      </Screen>
    );
  }

  // Nothing loaded and the request failed.
  if (status === 'error' && books.length === 0) {
    return (
      <Screen contentStyle={styles.noPadding}>
        <ScrollView refreshControl={refreshControl} contentContainerStyle={styles.emptyContent}>
          <View style={{ paddingHorizontal: PADDING }}>
            <TitleRow count={null} />
          </View>
          <LoadError
            offline={errorCode === 'network_error'}
            onRetry={() => useLibraryStore.getState().load()}
          />
        </ScrollView>
      </Screen>
    );
  }

  if (books.length === 0) {
    return (
      <Screen contentStyle={styles.noPadding}>
        <ScrollView refreshControl={refreshControl} contentContainerStyle={styles.emptyContent}>
          <View style={{ paddingHorizontal: PADDING }}>
            <TitleRow count={0} />
          </View>
          <View style={{ paddingHorizontal: PADDING }}>
            <EmptyState
              eyebrow={t.emptyLibrary.eyebrow}
              title={t.emptyLibrary.title}
              description={t.emptyLibrary.text}
              primaryAction={{
                label: t.emptyLibrary.scanFirst,
                icon: 'scan',
                onPress: () => router.push('/scan'),
              }}
              secondaryAction={{ label: t.emptyLibrary.addManually, onPress: addBook }}
            />
          </View>
        </ScrollView>
      </Screen>
    );
  }

  const header = (
    <View style={[styles.header, { paddingHorizontal: PADDING }]}>
      <TitleRow count={books.length} onAdd={addBook} />
      <SearchField value={query} onChangeText={setQuery} />
      <FilterTabs value={filter} onChange={setFilter} inset={PADDING} />
      {genre ? (
        <GenreChip genre={genre} onClear={() => router.setParams({ genre: undefined })} />
      ) : null}
    </View>
  );

  return (
    <Screen contentStyle={styles.noPadding}>
      <BookShelfGrid
        books={results}
        onPressBook={openBook}
        horizontalPadding={PADDING}
        ListHeaderComponent={header}
        ListEmptyComponent={<NoResults query={query} onClear={() => setQuery('')} />}
        refreshControl={refreshControl}
        motionFor={(book) => (book.id === added ? 'drop' : arrivalActive ? 'arrival' : 'none')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  noPadding: { padding: 0 },
  emptyContent: { gap: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  header: { gap: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  titleText: { flex: 1, gap: spacing.xs },
  skeletonRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end' },
  flex: { flex: 1 },
  gapXl: { gap: spacing.xl, paddingTop: spacing.lg },
  message: { gap: spacing.sm, paddingVertical: spacing.xl, alignItems: 'flex-start' },
  genreChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
  },
  genreText: { fontFamily: fonts.sansSemiBold },
});
