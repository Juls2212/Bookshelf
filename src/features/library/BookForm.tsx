import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BookCover } from '@/components/BookCover';
import { Button } from '@/components/Button';
import { SegmentedControl } from '@/components/SegmentedControl';
import { StarRating } from '@/components/StarRating';
import { TextField } from '@/components/TextField';
import { useToast } from '@/components/Toast';
import { spacing } from '@/design/tokens';
import { FormError } from '@/features/auth/FormError';
import { format, t } from '@/i18n';
import type { ReadingStatus } from '@/types/book';

import {
  digitsOnly,
  emptyBookForm,
  validateBookForm,
  type BookFormErrors,
  type BookFormValues,
} from './bookFormLogic';
import { bookValidationMessage } from './bookValidation';
import { coverService, type LocalImage } from './coverService';

export type BookFormSubmitResult = { ok: true } | { ok: false; message: string };

/** Cover already saved for the book (edit flow), shown until a new one is picked. */
export type ExistingCover = { uri: string | null; cacheKey?: string | null };

type Props = {
  initialValues?: BookFormValues;
  existingCover?: ExistingCover | null;
  submitLabel?: string;
  /** `cover` is the newly picked image, or null when the cover did not change. */
  onSubmit: (values: BookFormValues, cover: LocalImage | null) => Promise<BookFormSubmitResult>;
  onCancel: () => void;
};

const statusOptions = (['to_read', 'reading', 'finished'] as const).map((value) => ({
  value,
  label: t.readingStatus[value],
}));

function CoverRow({
  title,
  cover,
  existing,
  onChange,
}: {
  title: string;
  cover: LocalImage | null;
  existing: ExistingCover | null;
  onChange: (cover: LocalImage | null) => void;
}) {
  const toast = useToast();
  const pick = async () => {
    const result = await coverService.pickFromGallery();
    if (result.ok) onChange(result.data);
    else if (result.error !== 'cancelled') toast.show(t.bookForm.pickFailed, 'error');
  };
  return (
    <View style={styles.coverRow}>
      <BookCover
        title={title.trim() || t.bookForm.titlePlaceholder}
        coverUri={cover?.uri ?? existing?.uri}
        coverCacheKey={cover ? null : existing?.cacheKey}
        size="md"
      />
      <View style={styles.coverActions}>
        <AppText variant="label">{t.bookForm.coverLabel}</AppText>
        <AppText variant="caption">{t.bookForm.coverHint}</AppText>
        <Button
          variant="secondary"
          icon="image"
          label={cover || existing ? t.bookForm.changeCover : t.bookForm.addCover}
          onPress={pick}
        />
        {cover ? (
          <Button
            variant="ghost"
            icon="x"
            label={t.bookForm.removeCover}
            onPress={() => onChange(null)}
          />
        ) : null}
      </View>
    </View>
  );
}

export function BookForm({
  initialValues = emptyBookForm,
  existingCover = null,
  submitLabel = t.bookForm.save,
  onSubmit,
  onCancel,
}: Props) {
  const [values, setValues] = useState<BookFormValues>(initialValues);
  const [cover, setCover] = useState<LocalImage | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const errors: BookFormErrors = submitted ? validateBookForm(values) : {};
  const message = (field: keyof BookFormErrors) => {
    const code = errors[field];
    return code ? bookValidationMessage(code) : undefined;
  };
  const set = <K extends keyof BookFormValues>(key: K, value: BookFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (Object.keys(validateBookForm(values)).length > 0) {
      setFormError(t.bookForm.fixErrors);
      return;
    }
    setSaving(true);
    const result = await onSubmit(values, cover);
    setSaving(false);
    // On failure everything the user typed stays in place.
    if (!result.ok) setFormError(result.message);
  };

  return (
    <View style={styles.form}>
      <CoverRow title={values.title} cover={cover} existing={existingCover} onChange={setCover} />

      <TextField
        label={t.bookForm.titleLabel}
        placeholder={t.bookForm.titlePlaceholder}
        value={values.title}
        onChangeText={(text) => set('title', text)}
        autoCapitalize="sentences"
        errorText={message('title')}
      />
      <TextField
        label={t.bookForm.authorLabel}
        placeholder={t.bookForm.authorPlaceholder}
        value={values.author}
        onChangeText={(text) => set('author', text)}
        autoCapitalize="words"
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField
            label={t.bookForm.genreLabel}
            placeholder={t.bookForm.genrePlaceholder}
            value={values.genre}
            onChangeText={(text) => set('genre', text)}
            autoCapitalize="sentences"
          />
        </View>
        <View style={styles.flex}>
          <TextField
            label={t.bookForm.pagesLabel}
            placeholder={t.bookForm.pagesPlaceholder}
            value={values.pages}
            onChangeText={(text) => set('pages', digitsOnly(text))}
            keyboardType="number-pad"
            maxLength={5}
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
            maxLength={5}
            helperText={
              values.pages ? format(t.bookForm.ofPages, { pages: values.pages }) : undefined
            }
            errorText={message('currentPage')}
          />
        </View>
      ) : null}

      <View style={styles.group}>
        <AppText variant="label">{t.bookForm.ratingLabel}</AppText>
        <StarRating value={values.rating} onChange={(rating) => set('rating', rating)} />
      </View>

      <TextField
        label={t.bookForm.notesLabel}
        placeholder={t.bookForm.notesPlaceholder}
        value={values.notes}
        onChangeText={(text) => set('notes', text)}
        multiline
      />

      {formError ? <FormError message={formError} /> : null}

      <View style={styles.row}>
        <View style={styles.flex}>
          <Button label={submitLabel} onPress={submit} loading={saving} />
        </View>
        <View style={styles.flex}>
          <Button
            variant="secondary"
            label={t.bookForm.cancel}
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
});
