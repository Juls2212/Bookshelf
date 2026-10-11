import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BookCover } from '@/components/BookCover';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ProgressBar } from '@/components/ProgressBar';
import { Screen } from '@/components/Screen';
import { ShelfLine } from '@/components/ShelfLine';
import { Skeleton } from '@/components/Skeleton';
import { coverHeightFactorFor } from '@/design/coverColor';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { fonts, radii, sizes, spacing } from '@/design/tokens';
import { currentReading, recentBooks } from '@/features/library/libraryCopy';
import { useCoverUris, type WithCover } from '@/features/library/useCoverUris';
import { firstNameOf, useDisplayName } from '@/features/profile/displayName';
import { format, t } from '@/i18n';
import { computeProgressPercent } from '@/lib/book';
import { buildGreeting, formatLongDate } from '@/lib/dates';
import { useLibraryStore } from '@/stores/libraryStore';
import type { Book } from '@/types/book';

function Header() {
  const router = useRouter();
  const { colors } = useTheme();
  const now = new Date();
  const { greeting, name } = buildGreeting(now, firstNameOf(useDisplayName()));
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <AppText variant="label" color="textSecondary">
          {formatLongDate(now)}
        </AppText>
        <AppText variant="display" accessibilityRole="header">
          {greeting}
          {name ? (
            <>
              {'\n'}
              <AppText variant="display" style={{ fontFamily: fonts.serifItalic }}>
                {name}
              </AppText>
            </>
          ) : null}
        </AppText>
      </View>
      <Pressable
        onPress={() => router.navigate('/profile')}
        accessibilityRole="button"
        accessibilityLabel={t.home.profileA11y}
        style={[styles.avatar, { borderColor: colors.textPrimary }]}
      >
        {name ? (
          <AppText variant="heading">{name.charAt(0).toLocaleUpperCase()}</AppText>
        ) : (
          <Icon name="user" />
        )}
      </Pressable>
    </View>
  );
}

function ReadingProgress({ book }: { book: Book }) {
  const page = book.currentPage ?? 0;
  // Without a page count there is no meaningful percentage: show the page only.
  if (!book.pageCount) {
    return (
      <AppText variant="caption">
        {page > 0 ? format(t.home.pageOnly, { page }) : t.home.notStarted}
      </AppText>
    );
  }
  const percent = computeProgressPercent(page, book.pageCount);
  return (
    <View style={styles.gapXs}>
      <ProgressBar percent={percent} />
      <View style={styles.between}>
        <AppText variant="caption">
          {format(t.home.pageOf, { page, total: book.pageCount })}
        </AppText>
        <AppText variant="caption" color="textPrimary" style={styles.bold}>
          {format(t.bookDetail.percent, { percent })}
        </AppText>
      </View>
    </View>
  );
}

function ReadingCard({ book }: { book: WithCover<Book> }) {
  const router = useRouter();
  const { colors } = useTheme();
  const open = () => router.push({ pathname: '/book/[id]', params: { id: book.id } });
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <AppText variant="label">{t.home.readingLabel}</AppText>
      <View style={styles.readingRow}>
        <BookCover
          title={book.title}
          author={book.author}
          coverUri={book.coverUri}
          coverCacheKey={book.coverCacheKey}
          size="lg"
        />
        <View style={styles.readingInfo}>
          <View style={styles.gapXs}>
            <AppText variant="title" numberOfLines={3}>
              {book.title}
            </AppText>
            {book.author ? (
              <AppText variant="caption" style={styles.author}>
                {book.author}
              </AppText>
            ) : null}
          </View>
          <ReadingProgress book={book} />
        </View>
      </View>
      <View style={styles.actions}>
        <View style={styles.flex}>
          <Button label={t.home.continueReading} onPress={open} />
        </View>
        <View style={styles.flex}>
          <Button variant="secondary" label={t.home.myPage} onPress={open} />
        </View>
      </View>
    </View>
  );
}

function NoReadingCard() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <AppText variant="label">{t.home.readingLabel}</AppText>
      <AppText variant="heading">{t.home.noReadingTitle}</AppText>
      <AppText variant="body" color="textSecondary">
        {t.home.noReadingText}
      </AppText>
      <Button
        variant="secondary"
        icon="sparkles"
        label={t.home.noReadingAction}
        onPress={() => router.navigate('/librarian')}
      />
    </View>
  );
}

// The saved-recommendation card returns in Phase 7; until then Inicio shows this state.
function NoRecommendationCard() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { borderColor: colors.border, borderWidth: sizes.borderWidth }]}>
      <AppText variant="label">{t.home.recommendationLabel}</AppText>
      <AppText variant="heading">{t.home.noRecommendationTitle}</AppText>
      <AppText variant="body" color="textSecondary">
        {t.home.noRecommendationText}
      </AppText>
      <Button
        variant="secondary"
        icon="sparkles"
        label={t.home.noRecommendationAction}
        onPress={() => router.navigate('/librarian')}
      />
    </View>
  );
}

function Collection({ books }: { books: WithCover<Book>[] }) {
  const router = useRouter();
  return (
    <View style={styles.gapMd}>
      <View style={styles.between}>
        <AppText variant="title">{t.home.collectionTitle}</AppText>
        <Button variant="link" label={t.home.seeAll} onPress={() => router.navigate('/library')} />
      </View>
      <View style={styles.bleed}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.carousel}
        >
          {books.map((book) => (
            <Pressable
              key={book.id}
              onPress={() => router.push({ pathname: '/book/[id]', params: { id: book.id } })}
              accessibilityRole="button"
              accessibilityLabel={
                book.author
                  ? format(t.book.tileA11y, { title: book.title, author: book.author })
                  : book.title
              }
            >
              <BookCover
                title={book.title}
                coverUri={book.coverUri}
                coverCacheKey={book.coverCacheKey}
                size="md"
                heightFactor={coverHeightFactorFor(book.title)}
                decorative
              />
            </Pressable>
          ))}
        </ScrollView>
        <ShelfLine />
      </View>
    </View>
  );
}

function HomeSkeleton() {
  return (
    <View style={styles.gapLg}>
      <Skeleton width="45%" height={14} />
      <Skeleton width="70%" height={40} />
      <Skeleton height={260} radius={radii.surface} />
      <Skeleton height={180} radius={radii.surface} />
    </View>
  );
}

function EmptyLibrary() {
  const router = useRouter();
  return (
    <EmptyState
      eyebrow={t.emptyLibrary.eyebrow}
      title={t.emptyLibrary.title}
      description={t.emptyLibrary.text}
      primaryAction={{
        label: t.emptyLibrary.scanFirst,
        icon: 'scan',
        onPress: () => router.push('/scan'),
      }}
      secondaryAction={{
        label: t.emptyLibrary.addManually,
        onPress: () => router.push('/book/new'),
      }}
    />
  );
}

function LoadErrorCard({ offline }: { offline: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { borderColor: colors.border, borderWidth: sizes.borderWidth }]}>
      <AppText variant="heading">{t.library.errorTitle}</AppText>
      <AppText variant="body" color="textSecondary">
        {offline ? t.library.errorOffline : t.library.errorGeneric}
      </AppText>
      <Button
        variant="secondary"
        icon="refresh"
        label={t.library.retry}
        onPress={() => useLibraryStore.getState().load()}
      />
    </View>
  );
}

const COLLECTION_SIZE = 8;

export default function HomeScreen() {
  const books = useLibraryStore((state) => state.books);
  const status = useLibraryStore((state) => state.status);
  const errorCode = useLibraryStore((state) => state.errorCode);

  useEffect(() => {
    const store = useLibraryStore.getState();
    if (store.status === 'idle') store.load();
    else store.refresh();
  }, []);

  const reading = currentReading(books);
  const collection = recentBooks(books, COLLECTION_SIZE, reading?.id);
  // One batch of signed URLs for every cover on screen.
  const covered = useCoverUris(reading ? [reading, ...collection] : collection);
  const shownReading = reading ? covered[0] : null;
  const shownCollection = reading ? covered.slice(1) : covered;

  const firstLoad = (status === 'idle' || status === 'loading') && books.length === 0;

  return (
    <Screen scroll contentStyle={styles.content}>
      {firstLoad ? (
        <HomeSkeleton />
      ) : (
        <>
          <Header />
          {status === 'error' && books.length === 0 ? (
            <LoadErrorCard offline={errorCode === 'network_error'} />
          ) : books.length === 0 ? (
            <EmptyLibrary />
          ) : (
            <>
              {shownReading ? <ReadingCard book={shownReading} /> : <NoReadingCard />}
              <NoRecommendationCard />
              {shownCollection.length > 0 ? <Collection books={shownCollection} /> : null}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingHorizontal: spacing.lg + spacing.xs,
    paddingBottom: spacing.xxl,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.lg },
  headerText: { flex: 1, gap: spacing.sm },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: sizes.borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { borderRadius: radii.surface, padding: spacing.lg + spacing.xs, gap: spacing.lg },
  readingRow: { flexDirection: 'row', gap: spacing.lg },
  readingInfo: { flex: 1, justifyContent: 'space-between' },
  author: { fontSize: 15 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bold: { fontFamily: fonts.sansBold },
  actions: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  gapXs: { gap: spacing.xs },
  gapSm: { gap: spacing.sm },
  gapMd: { gap: spacing.md },
  gapLg: { gap: spacing.lg, paddingTop: spacing.lg },
  tilted: { transform: [{ rotate: '4deg' }] },
  bleed: { marginHorizontal: -(spacing.lg + spacing.xs) },
  carousel: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg + spacing.xs,
    paddingTop: spacing.lg,
    alignItems: 'flex-end',
  },
});
