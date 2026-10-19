// "Sugerir datos" under the title of the book form, and the proposals it brings back. Every
// proposal is optional: "Usar" fills an empty field (still editable), "Descartar" hides it.
// Nothing animates (reduce motion is respected by design) and nothing relies on color alone.
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { fonts, radii, sizes, spacing } from '@/design/tokens';
import type { BookFormValues } from '@/features/library/bookFormLogic';
import { format, t } from '@/i18n';

import type { SuggestedBook, SuggestErrorCode } from './bookSuggester';
import {
  applySuggestion,
  applySuggestions,
  canAskForSuggestions,
  pendingSuggestions,
  type PendingSuggestion,
} from './suggestionLogic';
import type { BookSuggestions } from './useBookSuggestions';

const s = t.suggestions;

/** Errors worth trying again right away. */
const RETRYABLE: ReadonlySet<SuggestErrorCode> = new Set(['network', 'timeout', 'unknown']);

type Props = {
  suggestions: BookSuggestions;
  values: BookFormValues;
  /** Updates the form from its latest values (never from a stale copy). */
  onApply: (update: (values: BookFormValues) => BookFormValues) => void;
};

function candidateLine(book: SuggestedBook): string {
  return book.author
    ? format(s.candidateWithAuthor, { title: book.title, author: book.author })
    : format(s.candidate, { title: book.title });
}

function SuggestionRow({
  suggestion,
  onUse,
  onDismiss,
}: {
  suggestion: PendingSuggestion;
  onUse: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const field = s.fields[suggestion.field];
  const shown =
    suggestion.field === 'pages'
      ? format(s.pagesValue, { pages: suggestion.value })
      : suggestion.value;
  return (
    <View
      style={[styles.row, { borderColor: colors.border }]}
      testID={`suggestion-${suggestion.field}`}
    >
      <View style={styles.rowText}>
        <AppText variant="label">{field}</AppText>
        <AppText variant="body" color="textPrimary" style={styles.value}>
          {shown}
        </AppText>
        {suggestion.field === 'pages' ? <AppText variant="caption">{s.pagesHint}</AppText> : null}
      </View>
      <View style={styles.rowActions}>
        <Button
          variant="secondary"
          icon="check"
          label={s.use}
          accessibilityLabel={format(s.useA11y, { field, value: shown })}
          onPress={onUse}
        />
        <Button
          variant="ghost"
          icon="x"
          label={s.dismiss}
          accessibilityLabel={format(s.dismissA11y, { field })}
          onPress={onDismiss}
        />
      </View>
    </View>
  );
}

function CandidateSheet({
  visible,
  candidates,
  selected,
  onChoose,
  onClose,
}: {
  visible: boolean;
  candidates: SuggestedBook[];
  selected: number;
  onChoose: (index: number) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={s.otherOptionsTitle}>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {candidates.map((book, index) => {
          const checked = index === selected;
          const details = [
            book.genre,
            book.pageCount ? format(s.pagesValue, { pages: book.pageCount }) : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <Pressable
              key={`${book.title}-${index}`}
              onPress={() => onChoose(index)}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              accessibilityLabel={format(s.optionA11y, {
                title: book.title,
                author: book.author ?? s.unknownAuthor,
              })}
              accessibilityHint={details || undefined}
              style={({ pressed }) => [
                styles.option,
                {
                  borderColor: checked ? colors.textPrimary : colors.border,
                  backgroundColor: colors.surface,
                },
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.rowText}>
                <AppText variant="body" color="textPrimary" style={styles.value}>
                  {book.title}
                </AppText>
                <AppText variant="caption">{book.author ?? s.unknownAuthor}</AppText>
                {details ? <AppText variant="caption">{details}</AppText> : null}
              </View>
              {/* The check mark (not only the border) tells which one is selected. */}
              {checked ? <Icon name="check" size={sizes.iconMd} /> : null}
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

export function SuggestionPanel({ suggestions, values, onApply }: Props) {
  const { colors } = useTheme();
  const [choosing, setChoosing] = useState(false);
  const { state, online } = suggestions;
  const loading = state.name === 'loading';

  if (!canAskForSuggestions(values.title) && state.name === 'idle') return null;

  const candidate = state.name === 'ready' ? state.candidates[state.index] : null;
  const pending = pendingSuggestions(candidate, values, suggestions.hidden);

  return (
    <View style={styles.container}>
      {canAskForSuggestions(values.title) ? (
        <View style={styles.ask}>
          <Button
            variant="ghost"
            icon="sparkles"
            label={s.ask}
            accessibilityHint={online ? s.askHint : s.offline}
            disabled={loading || !online}
            onPress={() => suggestions.ask(values.title, values.author)}
            testID="suggest-button"
          />
          {!online ? (
            <View style={styles.inline}>
              <Icon name="cloud-off" size={sizes.iconSm} color={colors.textSecondary} />
              <AppText variant="caption" style={styles.flex}>
                {s.offline}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.inline} accessibilityLiveRegion="polite" testID="suggest-loading">
          <ActivityIndicator color={colors.textSecondary} />
          <AppText variant="caption">{s.loading}</AppText>
        </View>
      ) : null}

      {state.name === 'failed' ? (
        <View
          style={[styles.card, { backgroundColor: colors.surface }]}
          accessibilityLiveRegion="polite"
        >
          <View style={styles.inline}>
            <Icon name="alert-circle" size={sizes.iconMd} color={colors.textSecondary} />
            <AppText variant="body" style={styles.flex}>
              {s.errors[state.error]}
            </AppText>
          </View>
          <View style={styles.footer}>
            {RETRYABLE.has(state.error) ? (
              <Button
                variant="secondary"
                icon="refresh"
                label={s.retry}
                onPress={suggestions.retry}
                disabled={!online}
              />
            ) : null}
            <Button variant="ghost" icon="x" label={s.dismissAll} onPress={suggestions.close} />
          </View>
        </View>
      ) : null}

      {state.name === 'ready' && candidate ? (
        <View
          style={[styles.card, { backgroundColor: colors.surface }]}
          testID="suggestion-panel"
          accessibilityLiveRegion="polite"
        >
          <View style={styles.inline}>
            <Icon name="sparkles" size={sizes.iconMd} color={colors.accentText} />
            <AppText variant="heading" accessibilityRole="header" style={styles.flex}>
              {s.heading}
            </AppText>
          </View>
          <AppText variant="body">{candidateLine(candidate)}</AppText>
          <AppText variant="caption">{s.intro}</AppText>

          {pending.length > 0 ? (
            pending.map((suggestion) => (
              <SuggestionRow
                key={suggestion.field}
                suggestion={suggestion}
                onUse={() => onApply((current) => applySuggestion(current, suggestion))}
                onDismiss={() => suggestions.dismiss([suggestion.field])}
              />
            ))
          ) : (
            <AppText variant="caption">{s.nothingLeft}</AppText>
          )}

          <View style={styles.footer}>
            {pending.length > 0 ? (
              <Button
                variant="secondary"
                label={s.useAll}
                onPress={() => onApply((current) => applySuggestions(current, pending))}
              />
            ) : null}
            <Button variant="ghost" label={s.dismissAll} onPress={suggestions.close} />
            {state.candidates.length > 1 ? (
              <Button
                variant="ghost"
                icon="ellipsis"
                label={s.otherOptions}
                onPress={() => setChoosing(true)}
              />
            ) : null}
          </View>

          <CandidateSheet
            visible={choosing}
            candidates={state.candidates}
            selected={state.index}
            onChoose={(index) => {
              setChoosing(false);
              suggestions.choose(index);
            }}
            onClose={() => setChoosing(false)}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  ask: { gap: spacing.xs, alignItems: 'flex-start' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  card: { borderRadius: radii.surface, padding: spacing.lg, gap: spacing.md },
  row: {
    borderTopWidth: sizes.borderWidth,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  rowText: { flex: 1, gap: spacing.xxs },
  value: { fontFamily: fonts.sansSemiBold },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  options: { gap: spacing.sm },
  option: {
    minHeight: sizes.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.field,
    borderWidth: sizes.borderWidth,
  },
  pressed: { opacity: 0.85 },
});
