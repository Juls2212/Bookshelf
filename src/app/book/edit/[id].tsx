import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { KeyboardAwareScrollView } from '@/components/KeyboardAwareScrollView';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { sizes, spacing } from '@/design/tokens';
import { BookForm, type BookFormSubmitResult } from '@/features/library/BookForm';
import { bookToFormValues, toNewBook, type BookFormValues } from '@/features/library/bookFormLogic';
import { bookErrorMessage } from '@/features/library/bookRepository';
import type { LocalImage } from '@/features/library/coverService';
import { editBook } from '@/features/library/editBook';
import { useCoverUris } from '@/features/library/useCoverUris';
import { t } from '@/i18n';
import { useAuthStore } from '@/stores/authStore';
import { useLibraryStore } from '@/stores/libraryStore';

const PADDING = spacing.lg + spacing.xs;

export default function EditBookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const book = useLibraryStore((state) => state.books.find((b) => b.id === id) ?? null);
  const [covered] = useCoverUris(book ? [book] : []);

  const submit = async (
    values: BookFormValues,
    cover: LocalImage | null,
    options?: { removeCover: true },
  ): Promise<BookFormSubmitResult> => {
    if (!book) return { ok: false, message: bookErrorMessage('not_found') };
    if (!userId) return { ok: false, message: bookErrorMessage('unauthorized') };
    const result = await editBook(
      { userId, book, patch: toNewBook(values), cover, removeCover: options?.removeCover ?? false },
      { update: useLibraryStore.getState().update },
    );
    if (!result.ok) {
      return {
        ok: false,
        message:
          result.error === 'cover_failed' ? t.bookForm.coverFailed : bookErrorMessage(result.error),
      };
    }
    toast.show(t.bookForm.updated, 'success');
    router.back();
    return { ok: true };
  };

  return (
    <Screen edges={['top', 'left', 'right']} contentStyle={styles.screen}>
      <View style={[styles.header, { paddingHorizontal: PADDING }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
          style={[styles.round, { borderColor: colors.border }]}
        >
          <Icon name="chevron-left" size={sizes.iconLg} />
        </Pressable>
        <AppText variant="label" color="textSecondary">
          {t.bookForm.editScreenTitle}
        </AppText>
        <View style={styles.spacer} />
      </View>
      {book ? (
        <KeyboardAwareScrollView contentContainerStyle={styles.content}>
          <AppText variant="display" accessibilityRole="header">
            {t.bookForm.editHeading}
          </AppText>
          <BookForm
            initialValues={bookToFormValues(book)}
            existingCover={
              book.coverPath
                ? { uri: covered?.coverUri ?? null, cacheKey: covered?.coverCacheKey }
                : null
            }
            editing
            submitLabel={t.bookForm.editSave}
            onSubmit={submit}
            onCancel={() => router.back()}
          />
        </KeyboardAwareScrollView>
      ) : (
        <View style={[styles.content, styles.notFound]}>
          <AppText variant="title" accessibilityRole="header">
            {t.bookDetail.notFoundTitle}
          </AppText>
          <AppText variant="body" color="textSecondary">
            {t.bookDetail.notFoundText}
          </AppText>
        </View>
      )}
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: { width: sizes.minTouchTarget + 4 },
  content: { paddingHorizontal: PADDING, paddingTop: spacing.md, gap: spacing.xl },
  notFound: { gap: spacing.sm },
});
