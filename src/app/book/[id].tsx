import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BookCover } from '@/components/BookCover';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ProgressBar } from '@/components/ProgressBar';
import { Screen } from '@/components/Screen';
import { ShelfLine } from '@/components/ShelfLine';
import { Skeleton } from '@/components/Skeleton';
import { StarRating } from '@/components/StarRating';
import { TextField } from '@/components/TextField';
import { useToast } from '@/components/Toast';
import { coverHeightFactorFor } from '@/design/coverColor';
import { Icon, type IconName } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { fonts, radii, sizes, spacing } from '@/design/tokens';
import { bookErrorMessage } from '@/features/library/bookRepository';
import {
  bookValidationMessage,
  LENT_TO_MAX_LENGTH,
  validateLentTo,
} from '@/features/library/bookValidation';
import { relatedBooks } from '@/features/library/filterBooks';
import { useCoverUris, type WithCover } from '@/features/library/useCoverUris';
import { format, t } from '@/i18n';
import { computeProgressPercent, isLent } from '@/lib/book';
import { formatDayMonth, formatRelativeDays } from '@/lib/dates';
import { useLibraryStore } from '@/stores/libraryStore';
import type { Book } from '@/types/book';

const PADDING = spacing.lg + spacing.xs;
const RELATED_LIMIT = 6;

function RoundButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.round, { borderColor: colors.border }]}
    >
      <Icon name={icon} size={sizes.iconLg} />
    </Pressable>
  );
}

function Header({ onMore }: { onMore?: () => void }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <RoundButton icon="chevron-left" label={t.common.back} onPress={() => router.back()} />
      <AppText variant="label" color="textSecondary" accessibilityRole="header">
        {t.bookDetail.title}
      </AppText>
      {onMore ? (
        <RoundButton icon="ellipsis" label={t.bookDetail.more} onPress={onMore} />
      ) : (
        <View style={styles.roundSpacer} />
      )}
    </View>
  );
}

function statusDateLine(book: Book): string | null {
  if (book.readingStatus === 'to_read') {
    return format(t.bookDetail.inShelfSince, { date: formatDayMonth(new Date(book.createdAt)) });
  }
  if (!book.statusChangedAt) return null;
  return format(t.bookDetail.statusSince, { date: formatDayMonth(new Date(book.statusChangedAt)) });
}

function StatusCard({ book }: { book: Book }) {
  const { colors } = useTheme();
  const dateLine = statusDateLine(book);
  return (
    <View style={[styles.statusCard, { borderColor: colors.textPrimary }]}>
      <View style={styles.between}>
        <AppText variant="label" color="textSecondary">
          {t.bookDetail.statusLabel}
        </AppText>
        <View style={[styles.dot, { borderColor: colors.textPrimary }]} />
      </View>
      <AppText variant="heading">{t.readingStatus[book.readingStatus]}</AppText>
      {dateLine ? <AppText variant="caption">{dateLine}</AppText> : null}
    </View>
  );
}

function LoanCard({ book }: { book: Book }) {
  const { colors } = useTheme();
  const when = book.lentAt ? formatRelativeDays(new Date(book.lentAt), new Date()) : '';
  return (
    <View style={[styles.statusCard, styles.dashed, { borderColor: colors.danger }]}>
      <View style={styles.between}>
        <AppText variant="label" color="danger">
          {t.bookDetail.loanLabel}
        </AppText>
        <View style={[styles.dot, { borderColor: colors.danger }]} />
      </View>
      <AppText variant="heading" color="danger">
        {t.bookDetail.loanTitle}
      </AppText>
      <AppText variant="caption">
        {format(t.bookDetail.loanTo, { name: book.lentTo ?? '', when })}
      </AppText>
    </View>
  );
}

/** Read-only in this phase: page updates arrive with the reading actions (Phase 4). */
function ProgressCard({ book }: { book: Book }) {
  const { colors } = useTheme();
  const current = book.currentPage ?? 0;
  const total = book.pageCount;
  const percent = total ? computeProgressPercent(current, total) : null;
  const left = total ? Math.max(0, total - current) : null;
  return (
    <View style={[styles.progressCard, { backgroundColor: colors.surface }]}>
      <View style={styles.between}>
        <AppText variant="label">{t.bookDetail.progressLabel}</AppText>
        {left !== null ? (
          <AppText variant="caption">
            {left === 1 ? t.bookDetail.pageLeft : format(t.bookDetail.pagesLeft, { count: left })}
          </AppText>
        ) : null}
      </View>
      {percent !== null ? <ProgressBar percent={percent} /> : null}
      <View style={styles.between}>
        <AppText variant="title">
          {format(t.bookDetail.pageNumber, { page: current })}
          {total ? (
            <AppText variant="caption" style={styles.ofPages}>
              {' '}
              {format(t.bookDetail.ofPages, { total })}
            </AppText>
          ) : null}
        </AppText>
        {percent !== null ? (
          <AppText variant="body" style={styles.bold}>
            {format(t.bookDetail.percent, { percent })}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function MoreFromShelf({ book, books }: { book: Book; books: WithCover<Book>[] }) {
  const router = useRouter();
  if (books.length === 0 || !book.genre) return null;
  const genre = book.genre;
  return (
    <View style={styles.gapSm}>
      <View style={styles.between}>
        <AppText variant="label">{t.bookDetail.moreFromShelf}</AppText>
        <Button
          variant="link"
          label={format(t.bookDetail.seeGenre, { genre: genre.toLocaleLowerCase() })}
          onPress={() => router.navigate({ pathname: '/library', params: { genre } })}
        />
      </View>
      <View style={styles.bleed}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.shelfRow}
        >
          {books.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => router.push({ pathname: '/book/[id]', params: { id: b.id } })}
              accessibilityRole="button"
              accessibilityLabel={
                b.author ? format(t.book.tileA11y, { title: b.title, author: b.author }) : b.title
              }
            >
              <BookCover
                title={b.title}
                coverUri={b.coverUri}
                coverCacheKey={b.coverCacheKey}
                size="sm"
                heightFactor={coverHeightFactorFor(b.title)}
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

function LoanSheet({ book, onClose }: { book: Book; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const error = submitted ? validateLentTo(name) : null;

  const save = async () => {
    setSubmitted(true);
    if (validateLentTo(name)) return;
    setSaving(true);
    const result = await useLibraryStore.getState().lend(book.id, name);
    setSaving(false);
    if (result.ok) {
      toast.show(format(t.bookDetail.lentToast, { name: name.trim() }), 'success');
      onClose();
    } else {
      toast.show(bookErrorMessage(result.error), 'error');
    }
  };

  return (
    <BottomSheet visible onClose={onClose} title={t.bookDetail.loanSheetTitle}>
      <TextField
        label={t.bookDetail.loanNameLabel}
        placeholder={t.bookDetail.loanNamePlaceholder}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        maxLength={LENT_TO_MAX_LENGTH}
        returnKeyType="done"
        onSubmitEditing={save}
        errorText={error ? bookValidationMessage(error) : undefined}
      />
      <View style={styles.gapSm}>
        <Button label={t.bookDetail.loanSave} onPress={save} loading={saving} />
        <Button variant="secondary" label={t.bookDetail.cancel} onPress={onClose} />
      </View>
    </BottomSheet>
  );
}

function BookDetail({ book, related }: { book: WithCover<Book>; related: WithCover<Book>[] }) {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const [sheet, setSheet] = useState<'none' | 'options' | 'loan'>('none');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const lent = isLent(book);
  const meta =
    book.genre && book.pageCount
      ? format(t.bookDetail.genrePages, { genre: book.genre, pages: book.pageCount })
      : book.pageCount
        ? format(t.bookDetail.pagesOnly, { pages: book.pageCount })
        : book.genre;
  const openEdit = () => router.push({ pathname: '/book/edit/[id]', params: { id: book.id } });

  const returnBook = async () => {
    setSheet('none');
    const result = await useLibraryStore.getState().returnBook(book.id);
    if (result.ok) toast.show(t.bookDetail.returnedToast, 'success');
    else toast.show(bookErrorMessage(result.error), 'error');
  };

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    const result = await useLibraryStore.getState().remove(book.id);
    setDeleting(false);
    setConfirmDelete(false);
    if (!result.ok) {
      toast.show(bookErrorMessage(result.error), 'error');
      return;
    }
    toast.show(t.bookDetail.deletedToast, 'success');
    router.back();
  };

  return (
    <Screen scroll edges={['top', 'bottom', 'left', 'right']} contentStyle={styles.content}>
      <Header onMore={() => setSheet('options')} />

      <View style={styles.top}>
        <BookCover
          title={book.title}
          author={book.author}
          coverUri={book.coverUri}
          coverCacheKey={book.coverCacheKey}
          size="lg"
          ribbon={book.readingStatus === 'reading'}
        />
        <View style={[styles.flex, styles.gapSm]}>
          {meta ? <AppText variant="label">{meta}</AppText> : null}
          <AppText variant="title" accessibilityRole="header">
            {book.title}
          </AppText>
          {book.author ? (
            <AppText variant="body" color="textSecondary">
              {book.author}
            </AppText>
          ) : null}
        </View>
      </View>

      <StatusCard book={book} />
      {lent ? <LoanCard book={book} /> : null}
      {book.readingStatus === 'reading' ? <ProgressCard book={book} /> : null}

      <View style={styles.between}>
        <AppText variant="label">{t.bookDetail.ratingLabel}</AppText>
        {book.rating ? (
          <StarRating value={book.rating} />
        ) : (
          <AppText variant="caption">{t.bookDetail.noRating}</AppText>
        )}
      </View>

      <View style={styles.gapSm}>
        <AppText variant="label">{t.bookDetail.notesLabel}</AppText>
        {book.notes ? (
          <AppText
            variant="italicNote"
            color="textPrimary"
            style={[styles.note, { borderBottomColor: colors.border }]}
          >
            {book.notes}
          </AppText>
        ) : (
          <AppText variant="caption">{t.bookDetail.noNotes}</AppText>
        )}
      </View>

      <MoreFromShelf book={book} books={related} />

      <View style={styles.footer}>
        <Button variant="ghost" icon="pencil" label={t.bookDetail.edit} onPress={openEdit} />
        <Button
          variant="ghostDanger"
          icon="trash"
          label={t.bookDetail.delete}
          onPress={() => setConfirmDelete(true)}
        />
      </View>

      {sheet === 'options' ? (
        <BottomSheet visible onClose={() => setSheet('none')} title={t.bookDetail.sheetTitle}>
          <View style={styles.sheetItems}>
            <Button
              variant="ghost"
              icon="pencil"
              label={t.bookDetail.edit}
              onPress={() => {
                setSheet('none');
                openEdit();
              }}
            />
            <Button
              variant="ghost"
              icon="book"
              label={lent ? t.bookDetail.markReturned : t.bookDetail.markLent}
              onPress={lent ? returnBook : () => setSheet('loan')}
            />
          </View>
        </BottomSheet>
      ) : null}

      {sheet === 'loan' ? <LoanSheet book={book} onClose={() => setSheet('none')} /> : null}

      <ConfirmDialog
        visible={confirmDelete}
        destructive
        title={t.bookDetail.deleteTitle}
        message={format(t.bookDetail.deleteMessage, { title: book.title })}
        confirmLabel={deleting ? t.common.loading : t.bookDetail.deleteConfirm}
        cancelLabel={t.bookDetail.cancel}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    </Screen>
  );
}

function DetailSkeleton() {
  return (
    <Screen edges={['top', 'bottom', 'left', 'right']} contentStyle={styles.content}>
      <Header />
      <View style={styles.top} accessible accessibilityLabel={t.bookDetail.loading}>
        <Skeleton width={120} height={170} radius={radii.tag} />
        <View style={[styles.flex, styles.gapSm]}>
          <Skeleton width="60%" height={12} />
          <Skeleton height={32} />
          <Skeleton width="70%" height={14} />
        </View>
      </View>
      <Skeleton height={180} radius={radii.surface} />
    </Screen>
  );
}

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const books = useLibraryStore((state) => state.books);
  const status = useLibraryStore((state) => state.status);
  const book = books.find((b) => b.id === id) ?? null;

  // Opened directly (e.g. deep link) before the library was loaded.
  useEffect(() => {
    const store = useLibraryStore.getState();
    if (store.status === 'idle') store.load();
  }, []);

  const related = book ? relatedBooks(book, books, RELATED_LIMIT) : [];
  const covered = useCoverUris(book ? [book, ...related] : []);

  if (!book && (status === 'idle' || status === 'loading')) return <DetailSkeleton />;

  if (!book) {
    return (
      <Screen edges={['top', 'bottom', 'left', 'right']} contentStyle={styles.content}>
        <Header />
        <View style={styles.notFound}>
          <AppText variant="title" accessibilityRole="header">
            {t.bookDetail.notFoundTitle}
          </AppText>
          <AppText variant="body" color="textSecondary">
            {t.bookDetail.notFoundText}
          </AppText>
        </View>
      </Screen>
    );
  }

  return <BookDetail key={book.id} book={covered[0] ?? book} related={covered.slice(1)} />;
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingHorizontal: PADDING, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  round: {
    width: sizes.minTouchTarget + 4,
    height: sizes.minTouchTarget + 4,
    borderRadius: (sizes.minTouchTarget + 4) / 2,
    borderWidth: sizes.borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundSpacer: { width: sizes.minTouchTarget + 4 },
  top: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  flex: { flex: 1 },
  gapSm: { gap: spacing.sm },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusCard: {
    borderWidth: sizes.borderWidth,
    borderRadius: radii.tag * 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xxs,
  },
  dashed: { borderStyle: 'dashed' },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: sizes.borderWidth },
  progressCard: { borderRadius: radii.surface, padding: spacing.lg + spacing.xs, gap: spacing.md },
  ofPages: { fontSize: 16 },
  bold: { fontFamily: fonts.sansBold },
  note: { borderBottomWidth: sizes.borderWidth, paddingBottom: spacing.sm },
  bleed: { marginHorizontal: -PADDING },
  shelfRow: {
    gap: spacing.md,
    paddingHorizontal: PADDING,
    paddingTop: spacing.md,
    alignItems: 'flex-end',
  },
  footer: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl, flexWrap: 'wrap' },
  sheetItems: { alignItems: 'flex-start' },
  notFound: { gap: spacing.sm, paddingTop: spacing.xxl },
});
