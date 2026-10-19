import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BookCover } from '@/components/BookCover';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { KeyboardAwareScrollView } from '@/components/KeyboardAwareScrollView';
import { ProgressBar } from '@/components/ProgressBar';
import { ProgressSlider } from '@/components/ProgressSlider';
import { SegmentedControl } from '@/components/SegmentedControl';
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
  NOTES_MAX_LENGTH,
  validateLentTo,
  validateNotes,
} from '@/features/library/bookValidation';
import { relatedBooks } from '@/features/library/filterBooks';
import { getProgressPercent, toggleRating } from '@/features/library/readingRules';
import { UpdatePageSheet } from '@/features/library/UpdatePageSheet';
import { useSaveCurrentPage } from '@/features/library/useSaveCurrentPage';
import { useCoverUris, type WithCover } from '@/features/library/useCoverUris';
import { format, t } from '@/i18n';
import { isLent } from '@/lib/book';
import { formatDayMonth, formatRelativeDays } from '@/lib/dates';
import { NOTES_COUNTER_FROM } from '@/lib/inputLimits';
import { lineInput, multilineInput } from '@/lib/inputSanitizers';
import { useLibraryStore } from '@/stores/libraryStore';
import type { Book, ReadingStatus } from '@/types/book';

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

const statusOptions = (['to_read', 'reading', 'finished'] as const).map((value) => ({
  value,
  label: t.readingStatus[value],
}));

function StatusCard({
  book,
  onChangeStatus,
}: {
  book: Book;
  onChangeStatus: (status: ReadingStatus) => void;
}) {
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
      <View style={styles.statusSelector}>
        <SegmentedControl<ReadingStatus>
          options={statusOptions}
          value={book.readingStatus}
          onChange={(status) => {
            if (status !== book.readingStatus) onChangeStatus(status);
          }}
          accessibilityLabel={t.reading.statusSelectorLabel}
        />
      </View>
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
      <AppText variant="caption" numberOfLines={3}>
        {format(t.bookDetail.loanTo, { name: book.lentTo ?? '', when })}
      </AppText>
    </View>
  );
}

function ProgressCard({
  book,
  onUpdate,
  ribbonFrom,
}: {
  book: Book;
  onUpdate: () => void;
  /** Where the bookmark starts when the card appears (status just changed to reading). */
  ribbonFrom?: number;
}) {
  const { colors } = useTheme();
  const savePage = useSaveCurrentPage();
  // Live page while the bookmark is being dragged; the labels follow it.
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const current = previewPage ?? book.currentPage ?? 0;
  const total = book.pageCount;
  const percent = getProgressPercent({ currentPage: current, pageCount: total });
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
      {total ? (
        <ProgressSlider
          page={book.currentPage ?? 0}
          pageCount={total}
          onPreview={setPreviewPage}
          onCommit={(page) => savePage(book, page)}
          animateFrom={ribbonFrom}
        />
      ) : percent !== null ? (
        <ProgressBar percent={percent} animated animateFrom={ribbonFrom} />
      ) : null}
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
      <Button icon="pencil" label={t.bookDetail.updatePage} onPress={onUpdate} />
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
      toast.show(format(t.toast.lentTo, { name: name.trim() }), 'success');
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
        onChangeText={(text) => setName(lineInput(text, LENT_TO_MAX_LENGTH))}
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

function NotesBlock({ book }: { book: Book }) {
  const toast = useToast();
  const { colors } = useTheme();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editing = draft !== null;
  const length = draft ? Array.from(draft).length : 0;
  const issue = editing ? validateNotes(draft) : null;

  const save = async () => {
    if (draft === null || issue) return;
    setSaving(true);
    const result = await useLibraryStore.getState().updateNotes(book.id, draft);
    setSaving(false);
    if (!result.ok) {
      // Keep the draft so nothing typed is lost.
      toast.show(bookErrorMessage(result.error), 'error');
      return;
    }
    toast.show(result.data.notes ? t.reading.notesSaved : t.reading.notesCleared, 'success');
    setDraft(null);
  };

  if (editing) {
    return (
      <View style={styles.gapSm}>
        <TextField
          label={t.bookDetail.notesLabel}
          placeholder={t.reading.notesPlaceholder}
          value={draft}
          onChangeText={(text) => setDraft(multilineInput(text, NOTES_MAX_LENGTH))}
          multiline
          autoCapitalize="sentences"
          autoFocus
          maxLength={NOTES_MAX_LENGTH}
          helperText={
            length >= NOTES_COUNTER_FROM
              ? format(t.reading.notesCounter, { count: length, max: NOTES_MAX_LENGTH })
              : undefined
          }
          errorText={issue ? bookValidationMessage(issue) : undefined}
        />
        <View style={styles.notesActions}>
          <View style={styles.flex}>
            <Button label={t.reading.notesSave} onPress={save} loading={saving} />
          </View>
          <View style={styles.flex}>
            <Button
              variant="secondary"
              label={t.reading.cancel}
              onPress={() => setDraft(null)}
              disabled={saving}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.gapSm}>
      <AppText variant="label">{t.bookDetail.notesLabel}</AppText>
      <Pressable
        onPress={() => setDraft(book.notes ?? '')}
        accessibilityRole="button"
        accessibilityLabel={book.notes ? t.reading.notesEdit : t.reading.notesAdd}
        accessibilityHint={book.notes ?? undefined}
        style={styles.notesTap}
      >
        {book.notes ? (
          <AppText
            variant="italicNote"
            color="textPrimary"
            style={[styles.note, { borderBottomColor: colors.border }]}
          >
            {book.notes}
          </AppText>
        ) : (
          <View style={styles.notesEmpty}>
            <Icon name="pencil" size={sizes.iconSm} color={colors.accentText} />
            <AppText variant="caption" color="accentText">
              {t.reading.notesAdd}
            </AppText>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function BookDetail({ book, related }: { book: WithCover<Book>; related: WithCover<Book>[] }) {
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useState<'none' | 'options' | 'loan' | 'page'>('none');
  const [pendingStatus, setPendingStatus] = useState<ReadingStatus | null>(null);
  // Becoming "reading" makes the bookmark slide in from the start of the line.
  const [ribbonFrom, setRibbonFrom] = useState<number | undefined>(undefined);

  const rate = async (tapped: number) => {
    const next = toggleRating(book.rating, tapped);
    const result = await useLibraryStore.getState().updateRating(book.id, next);
    if (result.ok) toast.show(next ? t.reading.ratingSaved : t.reading.ratingCleared, 'success');
    else toast.show(bookErrorMessage(result.error), 'error');
  };

  const changeStatus = async (status: ReadingStatus) => {
    setPendingStatus(null);
    setRibbonFrom(status === 'reading' ? 0 : undefined);
    // Optimistic in the store: the card, progress and shelf update immediately.
    const result = await useLibraryStore.getState().updateReadingStatus(book.id, status);
    if (result.ok) {
      toast.show(format(t.reading.statusChanged, { status: t.readingStatus[status] }), 'success');
    } else {
      toast.show(bookErrorMessage(result.error), 'error');
    }
  };
  // Leaving "finished" asks first (it resets the finished state and may move the page).
  const requestStatus = (status: ReadingStatus) => {
    if (book.readingStatus === 'finished') setPendingStatus(status);
    else changeStatus(status);
  };
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
    if (result.ok) toast.show(t.toast.markedReturned, 'success');
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
    toast.show(t.toast.bookDeleted, 'success');
    router.back();
  };

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']} contentStyle={styles.noPadding}>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
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
            <AppText variant="title" accessibilityRole="header" numberOfLines={6}>
              {book.title}
            </AppText>
            {book.author ? (
              <AppText variant="body" color="textSecondary" numberOfLines={2}>
                {book.author}
              </AppText>
            ) : null}
          </View>
        </View>

        <StatusCard book={book} onChangeStatus={requestStatus} />
        {lent ? <LoanCard book={book} /> : null}
        {book.readingStatus === 'reading' ? (
          <ProgressCard book={book} onUpdate={() => setSheet('page')} ribbonFrom={ribbonFrom} />
        ) : null}

        {/* Rating only exists for finished books. */}
        {book.readingStatus === 'finished' ? (
          <View style={styles.between}>
            <AppText variant="label">{t.bookDetail.ratingLabel}</AppText>
            <StarRating value={book.rating} onChange={rate} clearHint={t.reading.ratingClearHint} />
          </View>
        ) : null}

        <NotesBlock book={book} />

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
              <Button
                variant="ghost"
                icon="sparkles"
                label={t.bookDetail.findSimilar}
                onPress={() => {
                  setSheet('none');
                  router.navigate({
                    pathname: '/librarian',
                    params: { mode: 'discovery', seed: book.id },
                  });
                }}
              />
            </View>
          </BottomSheet>
        ) : null}

        {sheet === 'loan' ? <LoanSheet book={book} onClose={() => setSheet('none')} /> : null}
        {sheet === 'page' ? <UpdatePageSheet book={book} onClose={() => setSheet('none')} /> : null}

        <ConfirmDialog
          visible={pendingStatus !== null}
          title={t.reading.leaveFinishedTitle}
          message={format(
            book.rating ? t.reading.leaveFinishedMessageWithRating : t.reading.leaveFinishedMessage,
            {
              status: pendingStatus ? t.readingStatus[pendingStatus] : '',
            },
          )}
          confirmLabel={t.reading.leaveFinishedConfirm}
          cancelLabel={t.reading.cancel}
          onCancel={() => setPendingStatus(null)}
          onConfirm={() => {
            if (pendingStatus) changeStatus(pendingStatus);
          }}
        />

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
      </KeyboardAwareScrollView>
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
  statusSelector: { marginTop: spacing.sm },
  noPadding: { padding: 0 },
  notesTap: { minHeight: sizes.minTouchTarget, justifyContent: 'center' },
  notesEmpty: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  notesActions: { flexDirection: 'row', gap: spacing.sm },
});
