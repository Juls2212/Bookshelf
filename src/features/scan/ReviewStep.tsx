// "Revisa tu libro": the identified data in the normal book form (review mode), with the photo
// cropped to the book as the proposed cover. "Guardar libro" is the only way anything gets saved.
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { KeyboardAwareScrollView } from '@/components/KeyboardAwareScrollView';
import { Screen } from '@/components/Screen';
import { Icon, type IconName } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { fonts, radii, sizes, spacing, type ColorToken } from '@/design/tokens';
import { BookForm } from '@/features/library/BookForm';
import { defaultCoverCrop } from '@/features/library/coverCrop';
import type { LocalImage } from '@/features/library/coverService';
import { useCreateBook } from '@/features/library/useCreateBook';
import { t } from '@/i18n';

import type { IdentifiedBook, IdentifyConfidence } from './bookIdentifier';
import { defaultCorners } from './coverGeometry';
import { identifiedToFormValues } from './scanReview';

const r = t.scan.review;
const PADDING = spacing.lg + spacing.xs;

const confidenceLook: Record<IdentifyConfidence, { icon: IconName; color: ColorToken }> = {
  high: { icon: 'check', color: 'success' },
  medium: { icon: 'eye', color: 'accentText' },
  low: { icon: 'alert-circle', color: 'warning' },
};

/** Confidence as icon + words (never color alone). */
function ConfidenceRow({ confidence }: { confidence: IdentifyConfidence }) {
  const { colors } = useTheme();
  const look = confidenceLook[confidence];
  return (
    <View
      accessible
      accessibilityLabel={`${r.confidence[confidence]}. ${r.confidenceHint[confidence]}`}
      style={styles.confidence}
      testID={`scan-confidence-${confidence}`}
    >
      <Icon name={look.icon} size={sizes.iconMd} color={colors[look.color]} />
      <View style={styles.flex}>
        <AppText variant="body" color="textPrimary" style={styles.strong}>
          {r.confidence[confidence]}
        </AppText>
        <AppText variant="caption">{r.confidenceHint[confidence]}</AppText>
      </View>
    </View>
  );
}

type Props = { photo: LocalImage; book: IdentifiedBook; onRetake: () => void };

export function ReviewStep({ photo, book, onRetake }: Props) {
  const { colors, scheme } = useTheme();
  const submit = useCreateBook();
  // The full-resolution photo plus the crop around the book (adjustable in the form); the crop is
  // applied to the original when the book is saved.
  const [cover] = useState(() => ({ ...photo, crop: defaultCoverCrop(book.coverBox) }));
  // "Mejorada": the cover straightened from its corners (AI corners, else its box, else an inset).
  const [corners] = useState(() =>
    defaultCorners({ coverCorners: book.coverCorners, coverBox: book.coverBox }),
  );

  return (
    <Screen edges={['top', 'left', 'right']} contentStyle={styles.screen}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View style={[styles.header, { paddingHorizontal: PADDING }]}>
        <Pressable
          onPress={onRetake}
          accessibilityRole="button"
          accessibilityLabel={r.retake}
          style={[styles.round, { borderColor: colors.border }]}
        >
          <Icon name="chevron-left" size={sizes.iconLg} />
        </Pressable>
        <AppText variant="label" color="textSecondary">
          {r.screenTitle}
        </AppText>
        <View style={styles.round} />
      </View>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <AppText variant="display" accessibilityRole="header">
          {r.heading}
        </AppText>
        <View style={[styles.note, { backgroundColor: colors.surface }]}>
          <View style={styles.noteRow}>
            <Icon name="sparkles" size={sizes.iconMd} color={colors.accentText} />
            <AppText variant="body" style={styles.flex}>
              {r.note}
            </AppText>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <ConfidenceRow confidence={book.confidence} />
        </View>
        <BookForm
          mode="review"
          allowSuggestions
          initialValues={identifiedToFormValues(book)}
          initialCover={cover}
          initialCorners={corners}
          onSubmit={submit}
          onCancel={onRetake}
        />
        <AppText variant="caption" style={styles.footer}>
          {r.nothingSaved}
        </AppText>
      </KeyboardAwareScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  round: {
    width: sizes.minTouchTarget + 4,
    height: sizes.minTouchTarget + 4,
    borderRadius: (sizes.minTouchTarget + 4) / 2,
    borderWidth: sizes.borderWidth,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: PADDING,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  note: { borderRadius: radii.surface, padding: spacing.lg, gap: spacing.md },
  noteRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  divider: { height: sizes.borderWidth },
  confidence: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  flex: { flex: 1 },
  strong: { fontFamily: fonts.sansSemiBold },
  footer: { textAlign: 'center' },
});
