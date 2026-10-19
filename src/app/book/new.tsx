import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { KeyboardAwareScrollView } from '@/components/KeyboardAwareScrollView';
import { Screen } from '@/components/Screen';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { sizes, spacing } from '@/design/tokens';
import { BookForm } from '@/features/library/BookForm';
import { useCreateBook } from '@/features/library/useCreateBook';
import {
  formValuesFromParams,
  type SuggestionParams,
} from '@/features/recommendations/addFromSuggestion';
import { t } from '@/i18n';
import { useRecommendationsStore } from '@/stores/recommendationsStore';

const PADDING = spacing.lg + spacing.xs;

export default function NewBookScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  // A "Nuevas aventuras" suggestion opens the form prefilled; everything stays editable.
  const prefill = formValuesFromParams(useLocalSearchParams<SuggestionParams>());
  const submit = useCreateBook({
    onSaved: () => {
      if (prefill) void useRecommendationsStore.getState().markAdded(prefill.suggestionId);
    },
  });

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
            {prefill ? t.bookForm.fromSuggestion : t.bookForm.subtitle}
          </AppText>
        </View>
        <BookForm
          allowSuggestions
          initialValues={prefill?.values}
          onSubmit={submit}
          onCancel={() => router.back()}
        />
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
