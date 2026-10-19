import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { ProgressBar } from '@/components/ProgressBar';
import { TextField } from '@/components/TextField';
import { spacing } from '@/design/tokens';
import { format, t } from '@/i18n';
import { INPUT_LIMITS } from '@/lib/inputLimits';
import type { Book } from '@/types/book';

import { digitsOnly } from './bookFormLogic';
import { bookValidationMessage } from './bookValidation';
import { applyPageUpdate, getProgressPercent, validateCurrentPage } from './readingRules';
import { useSaveCurrentPage } from './useSaveCurrentPage';

type Props = {
  book: Book;
  onClose: () => void;
};

/**
 * Update-current-page sheet: numeric field with live percentage and validation from the
 * reading rules. Shared by the book detail and Inicio (the "my page" button). Mount it only
 * while open.
 */
export function UpdatePageSheet({ book, onClose }: Props) {
  const savePage = useSaveCurrentPage();
  const [value, setValue] = useState(book.currentPage ? String(book.currentPage) : '');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const page = value === '' ? null : Number.parseInt(value, 10);
  const issue = validateCurrentPage(page, book.pageCount, { required: true });
  // "Required" only shows after saving; range errors show while typing.
  const shownIssue = submitted || (issue && issue !== 'current_page_required') ? issue : null;
  const preview = page !== null && !issue ? getProgressPercent(applyPageUpdate(book, page)) : null;

  const save = async () => {
    setSubmitted(true);
    if (issue || page === null) return;
    setSaving(true);
    const result = await savePage(book, page);
    setSaving(false);
    if (result.ok) onClose();
  };

  return (
    <BottomSheet visible onClose={onClose} title={t.reading.pageSheetTitle}>
      <TextField
        label={t.reading.pageLabel}
        placeholder="0"
        value={value}
        onChangeText={(text) => setValue(digitsOnly(text))}
        keyboardType="number-pad"
        inputMode="numeric"
        autoCorrect={false}
        maxLength={INPUT_LIMITS.pageDigits}
        returnKeyType="done"
        onSubmitEditing={save}
        helperText={
          book.pageCount ? format(t.reading.pageOfTotal, { total: book.pageCount }) : undefined
        }
        errorText={shownIssue ? bookValidationMessage(shownIssue) : undefined}
      />
      {preview !== null ? (
        <View style={styles.group} accessibilityLiveRegion="polite">
          <ProgressBar percent={preview} />
          <AppText variant="caption">{format(t.reading.pagePreview, { percent: preview })}</AppText>
        </View>
      ) : null}
      <View style={styles.group}>
        <Button label={t.reading.pageSave} onPress={save} loading={saving} />
        <Button variant="secondary" label={t.reading.cancel} onPress={onClose} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
});
