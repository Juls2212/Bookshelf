import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { FirstRunOffline } from '@/features/library/FirstRunOffline';
import { recentBooks } from '@/features/library/libraryCopy';
import { ReadingStatsCard } from '@/features/library/ReadingStatsCard';
import { getProgressPercent } from '@/features/library/readingRules';
import { pickCurrentlyReading } from '@/features/library/readingSelectors';
import { UpdatePageSheet } from '@/features/library/UpdatePageSheet';
import { useCoverUris, type WithCover } from '@/features/library/useCoverUris';
import { useDailyPages, useLocalNow } from '@/features/library/useReadingStatsData';
import { firstNameOf, useDisplayName } from '@/features/profile/displayName';
import { ProfileAvatar } from '@/features/profile/ProfileAvatar';
import { useFirstRun } from '@/features/sync/useFirstRun';
import { format, t } from '@/i18n';
import { buildGreeting, formatLongDate } from '@/lib/dates';
import { useLibraryStore } from '@/stores/libraryStore';
import { useRecommendationsStore } from '@/stores/recommendationsStore';
import { useSyncStore } from '@/stores/syncStore';
import type { Book } from '@/types/book';

/** Heading (26 lineHeight) still fits the 52 px circle at this scale. */
const MONOGRAM_MAX_SCALE = 1.8;

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
        <ProfileAvatar
          fallback={
            name ? (
              // Decorative monogram in a fixed circle: capped so large text sizes do not clip it
              // (the button already has its own label).
              <AppText variant="heading" maxFontSizeMultiplier={MONOGRAM_MAX_SCALE}>
                {name.charAt(0).toLocaleUpperCase()}
              </AppText>
            ) : (
              <Icon name="user" />
            )
          }
        />
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
  const percent = getProgressPercent(book) ?? 0;
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
  const [pageSheet, setPageSheet] = useState(false);
  const open = () => router.push({ pathname: '/book/[id]', params: { id: book.id } });
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <AppText variant="label">{t.home.readingLabel}</AppText>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={format(t.home.openBookA11y, { title: book.title })}
        style={({ pressed }) => [styles.readingRow, pressed && styles.pressed]}
      >
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
      </Pressable>
      <View style={styles.actions}>
        <View style={styles.flex}>
          <Button label={t.home.continueReading} onPress={open} />
        </View>
        <View style={styles.flex}>
          <Button variant="secondary" label={t.home.myPage} onPress={() => setPageSheet(true)} />
        </View>
      </View>
      {pageSheet ? <UpdatePageSheet book={book} onClose={() => setPageSheet(false)} /> : null}
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
        icon="library"
        label={t.home.noReadingAction}
        onPress={() => router.navigate('/library')}
      />
    </View>
  );
}

/**
 * "Tu librero te espera": the last recommendation (cached, also offline) when its book is still
 * on the shelf, otherwise an invitation. Both go to the Librero.
 */
function LibrarianCard({ books }: { books: readonly Book[] }) {
  const router = useRouter();
  const { colors } = useTheme();
  const current = useRecommendationsStore((state) => state.current);
  const book = current ? books.find((b) => b.id === current.bookId) : undefined;
  return (
    <View
      style={[styles.card, { borderColor: colors.border, borderWidth: sizes.borderWidth }]}
      testID="home-librarian-card"
    >
      <AppText variant="label">{t.home.recommendationLabel}</AppText>
      {current && book ? (
        <>
          <AppText variant="heading">{book.title}</AppText>
          <AppText variant="body" color="textSecondary" numberOfLines={3}>
            {current.rationale}
          </AppText>
        </>
      ) : (
        <>
          <AppText variant="heading">{t.home.noRecommendationTitle}</AppText>
          <AppText variant="body" color="textSecondary">
            {t.home.noRecommendationText}
          </AppText>
        </>
      )}
      <Button
        variant="secondary"
        icon="sparkles"
        label={current && book ? t.home.recommendationAction : t.home.noRecommendationAction}
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

function LoadErrorCard({
  offline,
  onRetry = () => void useLibraryStore.getState().load(),
}: {
  offline: boolean;
  onRetry?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { borderColor: colors.border, borderWidth: sizes.borderWidth }]}>
      <AppText variant="heading">{t.library.errorTitle}</AppText>
      <AppText variant="body" color="textSecondary">
        {offline ? t.library.errorOffline : t.library.errorGeneric}
      </AppText>
      <Button variant="secondary" icon="refresh" label={t.library.retry} onPress={onRetry} />
    </View>
  );
}

const COLLECTION_SIZE = 8;

export default function HomeScreen() {
  const books = useLibraryStore((state) => state.books);
  const status = useLibraryStore((state) => state.status);
  const errorCode = useLibraryStore((state) => state.errorCode);
  // Reading log per day (reloaded on every library change) and a clock that follows midnight.
  const dailyPages = useDailyPages(books);
  const now = useLocalNow();

  useEffect(() => {
    const store = useLibraryStore.getState();
    if (store.status === 'idle') store.load();
    else store.refresh();
  }, []);

  const reading = pickCurrentlyReading(books);
  const collection = recentBooks(books, COLLECTION_SIZE, reading?.id);
  // One batch of signed URLs for every cover on screen.
  const covered = useCoverUris(reading ? [reading, ...collection] : collection);
  const shownReading = reading ? covered[0] : null;
  const shownCollection = reading ? covered.slice(1) : covered;

  const firstRun = useFirstRun(books.length > 0);
  // The first-run states (offline, failed) take precedence over the store's loading state.
  const firstLoad =
    firstRun === 'loading' ||
    (firstRun === null && (status === 'idle' || status === 'loading') && books.length === 0);

  return (
    <Screen scroll contentStyle={styles.content}>
      {firstLoad ? (
        <HomeSkeleton />
      ) : (
        <>
          <Header />
          {firstRun === 'offline' ? (
            <FirstRunOffline />
          ) : firstRun === 'failed' ? (
            <LoadErrorCard offline={false} onRetry={() => void useSyncStore.getState().syncNow()} />
          ) : status === 'error' && books.length === 0 ? (
            <LoadErrorCard offline={errorCode === 'network_error'} />
          ) : books.length === 0 ? (
            <EmptyLibrary />
          ) : (
            <>
              {shownReading ? <ReadingCard book={shownReading} /> : <NoReadingCard />}
              <ReadingStatsCard books={books} dailyPages={dailyPages} now={now} />
              <LibrarianCard books={books} />
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
    overflow: 'hidden',
  },
  card: { borderRadius: radii.surface, padding: spacing.lg + spacing.xs, gap: spacing.lg },
  readingRow: { flexDirection: 'row', gap: spacing.lg },
  readingInfo: { flex: 1, justifyContent: 'space-between' },
  author: { fontSize: 15 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bold: { fontFamily: fonts.sansBold },
  pressed: { opacity: 0.85 },
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
