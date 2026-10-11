import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { KeyboardAwareScrollView } from '@/components/KeyboardAwareScrollView';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { sizes, spacing } from '@/design/tokens';
import { addBook } from '@/features/library/addBook';
import { BookForm, type BookFormSubmitResult } from '@/features/library/BookForm';
import { toNewBook, type BookFormValues } from '@/features/library/bookFormLogic';
import { bookErrorMessage } from '@/features/library/bookRepository';
import type { LocalImage } from '@/features/library/coverService';
import { t } from '@/i18n';
import { useAuthStore } from '@/stores/authStore';
import { useLibraryStore } from '@/stores/libraryStore';

const PADDING = spacing.lg + spacing.xs;

export default function NewBookScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const userId = useAuthStore((state) => state.user?.id ?? null);

  const submit = async (
    values: BookFormValues,
    cover: LocalImage | null,
  ): Promise<BookFormSubmitResult> => {
    if (!userId) return { ok: false, message: bookErrorMessage('unauthorized') };
    const result = await addBook(
      { userId, input: toNewBook(values), cover },
      { create: useLibraryStore.getState().create },
    );
    if (!result.ok) {
      return {
        ok: false,
        message:
          result.error === 'cover_failed' ? t.bookForm.coverFailed : bookErrorMessage(result.error),
      };
    }
    toast.show(t.bookForm.saved, 'success');
    router.navigate({ pathname: '/library', params: { added: result.data.id } });
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
          {t.bookForm.screenTitle}
        </AppText>
        <View style={styles.round} />
      </View>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <AppText variant="display" accessibilityRole="header">
            {t.bookForm.heading}
          </AppText>
          <AppText variant="body" color="textSecondary">
            {t.bookForm.subtitle}
          </AppText>
        </View>
        <BookForm onSubmit={submit} onCancel={() => router.back()} />
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
  content: { paddingHorizontal: PADDING, paddingTop: spacing.md, gap: spacing.xl },
  intro: { gap: spacing.xs },
});
