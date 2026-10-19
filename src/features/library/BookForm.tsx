import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BookCover } from '@/components/BookCover';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { SegmentedControl } from '@/components/SegmentedControl';
import { StarRating } from '@/components/StarRating';
import { TextField } from '@/components/TextField';
import { useToast } from '@/components/Toast';
import { useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';
import { CornerEditor } from '@/features/scan/CornerEditor';
import { coverToSave, type CoverVersion } from '@/features/scan/coverEnhancement';
import { insetCorners, type Quad } from '@/features/scan/coverGeometry';
import { useCoverEnhancement, type CoverEnhancement } from '@/features/scan/useCoverEnhancement';
import { FormError } from '@/features/auth/FormError';
import { SuggestionPanel } from '@/features/suggestions/SuggestionPanel';
import type { SuggestField } from '@/features/suggestions/suggestionLogic';
import { useBookSuggestions } from '@/features/suggestions/useBookSuggestions';
import { format, t } from '@/i18n';
import { INPUT_LIMITS, NOTES_COUNTER_FROM } from '@/lib/inputLimits';
import { charCount, lineInput, multilineInput } from '@/lib/inputSanitizers';
import type { ReadingStatus } from '@/types/book';

import {
  digitsOnly,
  emptyBookForm,
  saveBlocker,
  validateBookForm,
  type BookFormErrors,
  type BookFormValues,
} from './bookFormLogic';
import { bookValidationMessage } from './bookValidation';
import { CropEditor } from './CropEditor';
import type { CoverFinder } from './coverFinder';
import { coverService, type LocalImage } from './coverService';
import { CoverSuggestionCard, CoverSuggestionStatus } from './CoverSuggestionCard';
import { useCoverSuggestion } from './useCoverSuggestion';
import { useCoverPreview } from './useCoverPreview';

export type BookFormSubmitResult = { ok: true } | { ok: false; message: string };

/** Cover already saved for the book (edit flow), shown until a new one is picked. */
type ExistingCover = { uri: string | null; cacheKey?: string | null };

/**
 * `review`: the scan flow. The form starts from identified data with the photo as the proposed
 * cover, and the secondary action goes back to the camera instead of cancelling.
 */
type BookFormMode = 'default' | 'review';

type Props = {
  mode?: BookFormMode;
  initialValues?: BookFormValues;
  /** Image proposed as the cover before the user picks one (review mode), maybe with a crop. */
  initialCover?: LocalImage | null;
  existingCover?: ExistingCover | null;
  /**
   * Review mode: the cover's corners proposed for the scanned photo; the improvement
   * ("Mejorada") runs right away. Elsewhere it runs only from "Mejorar portada".
   */
  initialCorners?: Quad | null;
  /** Shows "Sugerir datos" under the title (add and review flows; never when editing). */
  allowSuggestions?: boolean;
  /** Editing a saved book: "Sugerir portada" is always offered. */
  editing?: boolean;
  submitLabel?: string;
  /** Cover suggestions source (tests); the default asks the find-cover function. */
  coverFinder?: CoverFinder;
  /**
   * `cover` is the newly picked image (with the crop to apply, if any), or null when the cover
   * did not change. `removeCover`: the saved cover was removed ("Quitar portada").
   */
  onSubmit: (
    values: BookFormValues,
    cover: LocalImage | null,
    options?: { removeCover: true },
  ) => Promise<BookFormSubmitResult>;
  onCancel: () => void;
};

const SUGGEST_FIELDS: ReadonlySet<keyof BookFormValues> = new Set([
  'title',
  'author',
  'genre',
  'pages',
]);

const statusOptions = (['to_read', 'reading', 'finished'] as const).map((value) => ({
  value,
  label: t.readingStatus[value],
}));

type CoverCopy = {
  label: string;
  hint: string;
  add: string;
  change: string;
  remove: string;
  adjust: string;
};

const coverCopy: Record<BookFormMode, CoverCopy> = {
  default: {
    label: t.bookForm.coverLabel,
    hint: t.bookForm.coverHint,
    add: t.bookForm.addCover,
    change: t.bookForm.changeCover,
    remove: t.bookForm.removeCover,
    adjust: t.bookForm.adjustCrop,
  },
  review: {
    label: t.scan.review.coverLabel,
    hint: t.scan.review.coverHint,
    add: t.bookForm.addCover,
    change: t.scan.review.changePhoto,
    remove: t.scan.review.removePhoto,
    adjust: t.bookForm.adjustCrop,
  },
};

const versionOptions = [
  { value: 'original', label: t.bookForm.enhance.original },
  { value: 'enhanced', label: t.bookForm.enhance.enhanced },
] as const satisfies readonly { value: CoverVersion; label: string }[];

function CoverRow({
  copy,
  title,
  cover,
  existing,
  enhancement,
  defaultCorners,
  manageCover,
  onSuggest,
  onChange,
  onRemove,
}: {
  copy: CoverCopy;
  title: string;
  cover: LocalImage | null;
  existing: ExistingCover | null;
  enhancement: CoverEnhancement;
  /** Where the corner editor starts the first time. */
  defaultCorners: Quad;
  /** Add and edit forms: choose gallery or camera, and confirm before removing. */
  manageCover: boolean;
  /** "Sugerir portada" (when offered). */
  onSuggest?: { onPress: () => void; disabled: boolean };
  onChange: (cover: LocalImage | null) => void;
  /** Removes the new image and the saved cover (after the confirmation, when asked). */
  onRemove: () => void;
}) {
  const toast = useToast();
  const { colors } = useTheme();
  const [cropping, setCropping] = useState(false);
  const [cornering, setCornering] = useState(false);
  const [choosingSource, setChoosingSource] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  // A new image shows its crop; a saved cover is shown as it is (never re-cropped).
  const preview = useCoverPreview(cover);
  const { state } = enhancement;
  const showEnhanced = state.selected === 'enhanced' && state.enhanced !== null;
  const pick = async (from: 'gallery' | 'camera') => {
    setChoosingSource(false);
    const result =
      from === 'camera' ? await coverService.takePhoto() : await coverService.pickFromGallery();
    // A newly picked image starts uncropped (the whole image).
    if (result.ok) onChange(result.data);
    else if (result.error === 'camera_denied') toast.show(t.bookForm.coverCameraDenied, 'error');
    else if (result.error !== 'cancelled') toast.show(t.bookForm.pickFailed, 'error');
  };
  const hasAnyCover = cover !== null || existing !== null;
  return (
    <View style={styles.coverRow}>
      <BookCover
        title={title.trim() || t.bookForm.titlePlaceholder}
        coverUri={cover ? (showEnhanced ? state.enhanced?.uri : preview) : existing?.uri}
        coverCacheKey={cover ? null : existing?.cacheKey}
        size="md"
      />
      <View style={styles.coverActions}>
        <AppText variant="label">{copy.label}</AppText>
        <AppText variant="caption">{copy.hint}</AppText>
        {cover && state.status === 'processing' ? (
          <View style={styles.inline} accessibilityLiveRegion="polite" testID="cover-processing">
            <ActivityIndicator color={colors.textSecondary} />
            <AppText variant="caption">{t.bookForm.enhance.processing}</AppText>
          </View>
        ) : null}
        {cover && state.enhanced ? (
          <SegmentedControl<CoverVersion>
            options={versionOptions}
            value={state.selected}
            onChange={enhancement.select}
            accessibilityLabel={t.bookForm.enhance.versionLabel}
          />
        ) : null}
        <Button
          variant="secondary"
          icon="image"
          label={hasAnyCover ? copy.change : copy.add}
          onPress={() => (manageCover ? setChoosingSource(true) : void pick('gallery'))}
        />
        {onSuggest ? (
          <Button
            variant="ghost"
            icon="sparkles"
            label={t.bookForm.suggestCover}
            onPress={onSuggest.onPress}
            disabled={onSuggest.disabled}
          />
        ) : null}
        {cover ? (
          <Button
            variant="ghost"
            icon="sparkles"
            label={
              state.status === 'idle' || state.status === 'failed'
                ? t.bookForm.enhance.improve
                : t.bookForm.enhance.adjustCorners
            }
            onPress={() => setCornering(true)}
          />
        ) : null}
        {cover && !showEnhanced ? (
          <Button
            variant="ghost"
            icon="crop"
            label={copy.adjust}
            onPress={() => setCropping(true)}
          />
        ) : null}
        {hasAnyCover ? (
          <Button
            variant="ghost"
            icon="x"
            label={copy.remove}
            onPress={() => (manageCover ? setConfirmingRemoval(true) : onRemove())}
          />
        ) : null}
      </View>
      {manageCover ? (
        <BottomSheet
          visible={choosingSource}
          onClose={() => setChoosingSource(false)}
          title={t.bookForm.coverSourceTitle}
        >
          <View style={styles.sheetActions}>
            <Button
              variant="secondary"
              icon="image"
              label={t.bookForm.coverFromGallery}
              onPress={() => void pick('gallery')}
            />
            <Button
              variant="secondary"
              icon="scan"
              label={t.bookForm.coverFromCamera}
              onPress={() => void pick('camera')}
            />
          </View>
        </BottomSheet>
      ) : null}
      {manageCover ? (
        <BottomSheet
          visible={confirmingRemoval}
          onClose={() => setConfirmingRemoval(false)}
          title={t.bookForm.removeCoverTitle}
        >
          <View style={styles.sheetActions}>
            <AppText variant="body" color="textSecondary">
              {t.bookForm.removeCoverMessage}
            </AppText>
            <Button
              variant="destructive"
              icon="trash"
              label={t.bookForm.removeCover}
              onPress={() => {
                setConfirmingRemoval(false);
                onRemove();
              }}
              testID="remove-cover-confirm"
            />
            <Button
              variant="secondary"
              label={t.bookForm.cancel}
              onPress={() => setConfirmingRemoval(false)}
              testID="remove-cover-cancel"
            />
          </View>
        </BottomSheet>
      ) : null}
      {cover && cropping ? (
        <CropEditor
          image={cover}
          initialCrop={cover.crop ?? null}
          onApply={(crop) => {
            setCropping(false);
            onChange({ ...cover, crop });
          }}
          onCancel={() => setCropping(false)}
        />
      ) : null}
      {cover && cornering ? (
        <CornerEditor
          image={cover}
          initialCorners={state.corners ?? defaultCorners}
          onApply={(corners) => {
            setCornering(false);
            enhancement.start(cover, corners);
          }}
          onCancel={() => setCornering(false)}
        />
      ) : null}
    </View>
  );
}

export function BookForm({
  mode = 'default',
  initialValues = emptyBookForm,
  initialCover = null,
  existingCover = null,
  initialCorners = null,
  allowSuggestions = false,
  editing = false,
  submitLabel = t.bookForm.save,
  coverFinder,
  onSubmit,
  onCancel,
}: Props) {
  const [values, setValues] = useState<BookFormValues>(initialValues);
  const [cover, setCover] = useState<LocalImage | null>(initialCover);
  // "Quitar portada" on a saved cover: it is shown as gone and removed when saving.
  const [removedExisting, setRemovedExisting] = useState(false);
  const shownExisting = removedExisting ? null : existingCover;
  const enhancement = useCoverEnhancement();
  // Review mode: improve the scanned photo right away (the plain crop stays available).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !initialCover || !initialCorners) return;
    autoStarted.current = true;
    enhancement.start(initialCover, initialCorners);
  }, [enhancement, initialCover, initialCorners]);
  const changeCover = (next: LocalImage | null) => {
    // A different photo (or none) forgets the improvement; a new crop of the same one keeps it.
    if (next?.uri !== cover?.uri) enhancement.reset();
    setCover(next);
  };
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const errors: BookFormErrors = submitted ? validateBookForm(values) : {};
  const message = (field: keyof BookFormErrors) => {
    const code = errors[field];
    return code ? bookValidationMessage(code) : undefined;
  };
  const suggestions = useBookSuggestions({ enabled: allowSuggestions });
  // "Portada sugerida" (add and edit forms): only while the book has no cover at all.
  const coverSuggestion = useCoverSuggestion({
    enabled: mode === 'default',
    title: values.title,
    author: values.author,
    hasCover: cover !== null || shownExisting !== null,
    onAccept: changeCover,
    ...(coverFinder ? { finder: coverFinder } : {}),
  });
  // A cover still being downloaded or processed blocks saving, like an invalid field.
  const coverPending =
    coverSuggestion.accepting || (cover !== null && enhancement.state.status === 'processing');
  const blocker = saveBlocker(values, { coverPending });
  const set = <K extends keyof BookFormValues>(key: K, value: BookFormValues[K]) => {
    // Typing in a field drops its pending suggestion.
    if (SUGGEST_FIELDS.has(key)) suggestions.markEdited(key as SuggestField);
    setValues((current) => ({ ...current, [key]: value }));
  };

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    // Re-checked here: the disabled button alone is never the only guard.
    if (saving || saveBlocker(values, { coverPending }) !== null) {
      if (Object.keys(validateBookForm(values)).length > 0) setFormError(t.bookForm.fixErrors);
      return;
    }
    setSaving(true);
    // The chosen version (plain crop or improved) goes through the unchanged save pipeline.
    const chosen = cover ? coverToSave(enhancement.state, cover) : null;
    // The third argument only when the saved cover was removed (and nothing replaced it).
    const result =
      removedExisting && cover === null
        ? await onSubmit(values, chosen, { removeCover: true })
        : await onSubmit(values, chosen);
    setSaving(false);
    // On failure everything the user typed stays in place.
    if (!result.ok) setFormError(result.message);
  };

  return (
    <View style={styles.form}>
      <CoverRow
        copy={coverCopy[mode]}
        title={values.title}
        cover={cover}
        existing={shownExisting}
        enhancement={enhancement}
        defaultCorners={initialCorners ?? insetCorners()}
        manageCover={mode === 'default'}
        onSuggest={
          // Editing: always; adding: once the automatic suggestion was declined or found nothing.
          mode === 'default' && (editing || coverSuggestion.autoExhausted)
            ? { onPress: coverSuggestion.request, disabled: !coverSuggestion.canRequest }
            : undefined
        }
        onChange={changeCover}
        onRemove={() => {
          changeCover(null);
          if (existingCover) setRemovedExisting(true);
        }}
      />

      <TextField
        label={t.bookForm.titleLabel}
        placeholder={t.bookForm.titlePlaceholder}
        value={values.title}
        onChangeText={(text) => set('title', lineInput(text, INPUT_LIMITS.title))}
        autoCapitalize="sentences"
        maxLength={INPUT_LIMITS.title}
        required
        errorText={message('title')}
      />
      <CoverSuggestionStatus suggestion={coverSuggestion} />
      {allowSuggestions ? (
        <SuggestionPanel suggestions={suggestions} values={values} onApply={setValues} />
      ) : null}
      <TextField
        label={t.bookForm.authorLabel}
        placeholder={t.bookForm.authorPlaceholder}
        value={values.author}
        onChangeText={(text) => set('author', lineInput(text, INPUT_LIMITS.author))}
        autoCapitalize="words"
        autoComplete="off"
        maxLength={INPUT_LIMITS.author}
        errorText={message('author')}
      />
      <CoverSuggestionCard suggestion={coverSuggestion} title={values.title} />
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField
            label={t.bookForm.genreLabel}
            placeholder={t.bookForm.genrePlaceholder}
            value={values.genre}
            onChangeText={(text) => set('genre', lineInput(text, INPUT_LIMITS.genre))}
            autoCapitalize="sentences"
            maxLength={INPUT_LIMITS.genre}
            errorText={message('genre')}
          />
        </View>
        <View style={styles.flex}>
          <TextField
            label={t.bookForm.pagesLabel}
            placeholder={t.bookForm.pagesPlaceholder}
            value={values.pages}
            onChangeText={(text) => set('pages', digitsOnly(text))}
            keyboardType="number-pad"
            inputMode="numeric"
            autoCorrect={false}
            maxLength={INPUT_LIMITS.pageDigits}
            required
            errorText={message('pages')}
          />
        </View>
      </View>

      <View style={styles.group}>
        <AppText variant="label">{t.bookForm.statusLabel}</AppText>
        <SegmentedControl<ReadingStatus>
          options={statusOptions}
          value={values.readingStatus}
          onChange={(status) => set('readingStatus', status)}
          accessibilityLabel={t.bookForm.statusLabel}
        />
      </View>

      {values.readingStatus === 'reading' ? (
        <View style={styles.group}>
          <TextField
            label={t.bookForm.currentPageLabel}
            placeholder="0"
            value={values.currentPage}
            onChangeText={(text) => set('currentPage', digitsOnly(text))}
            keyboardType="number-pad"
            inputMode="numeric"
            autoCorrect={false}
            maxLength={INPUT_LIMITS.pageDigits}
            helperText={
              values.pages ? format(t.bookForm.ofPages, { pages: values.pages }) : undefined
            }
            errorText={message('currentPage')}
          />
        </View>
      ) : null}

      {/* Rating is only asked for finished books; other statuses save it as null. */}
      {values.readingStatus === 'finished' ? (
        <View style={styles.group}>
          <AppText variant="label">{t.bookForm.ratingLabel}</AppText>
          <StarRating value={values.rating} onChange={(rating) => set('rating', rating)} />
        </View>
      ) : null}

      <TextField
        label={t.bookForm.notesLabel}
        placeholder={t.bookForm.notesPlaceholder}
        value={values.notes}
        onChangeText={(text) => set('notes', multilineInput(text, INPUT_LIMITS.notes))}
        multiline
        autoCapitalize="sentences"
        maxLength={INPUT_LIMITS.notes}
        helperText={
          charCount(values.notes) >= NOTES_COUNTER_FROM
            ? format(t.reading.notesCounter, {
                count: charCount(values.notes),
                max: INPUT_LIMITS.notes,
              })
            : undefined
        }
        errorText={message('notes')}
      />

      {formError ? <FormError message={formError} /> : null}

      {blocker ? (
        <AppText
          variant="caption"
          color="textSecondary"
          accessibilityLiveRegion="polite"
          testID="save-blocker"
        >
          {blocker === 'cover_pending' ? t.bookForm.coverPending : bookValidationMessage(blocker)}
        </AppText>
      ) : null}

      <View style={styles.row}>
        <View style={styles.flex}>
          <Button
            label={submitLabel}
            onPress={submit}
            loading={saving}
            disabled={blocker !== null}
            testID="save-button"
          />
        </View>
        <View style={styles.flex}>
          <Button
            variant="secondary"
            label={mode === 'review' ? t.scan.review.retake : t.bookForm.cancel}
            onPress={onCancel}
            disabled={saving}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
  group: { gap: spacing.sm },
  coverRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  coverActions: { flex: 1, gap: spacing.xs, alignItems: 'flex-start' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sheetActions: { gap: spacing.sm },
});
