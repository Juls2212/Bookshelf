// "Portada sugerida": one candidate image with where it was found, "Usar esta portada",
// "No, gracias" and, with several candidates, a strip of thumbnails. Optional; it never blocks the form.
import { Image } from 'expo-image';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing } from '@/design/tokens';
import { format, t } from '@/i18n';

import type { CoverSuggestion } from './useCoverSuggestion';

const c = t.bookForm.coverSuggestion;

/**
 * Under the title: a subtle "Buscando portada…" while searching and "No encontramos…" when the
 * catalogs found nothing. Offline only for an explicit "Sugerir portada"; nothing on errors.
 */
export function CoverSuggestionStatus({ suggestion }: { suggestion: CoverSuggestion }) {
  if (!suggestion.status) return null;
  return (
    <AppText
      variant="caption"
      color="textSecondary"
      accessibilityLiveRegion="polite"
      testID={`cover-suggestion-${suggestion.status}`}
    >
      {suggestion.status === 'searching'
        ? c.searching
        : suggestion.status === 'offline'
          ? c.offline
          : c.notFound}
    </AppText>
  );
}

const IMAGE_WIDTH = 72;
const IMAGE_HEIGHT = 108;
const THUMB_WIDTH = 48;
const THUMB_HEIGHT = 72;

/**
 * Horizontal strip with every candidate; tapping one selects it as the current candidate.
 * Thumbnails load lazily and one that fails to load disappears from the strip.
 */
function CandidateStrip({ suggestion }: { suggestion: CoverSuggestion }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const visible = suggestion.candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => !failed.has(candidate.imageUrl));
  if (visible.length < 2) return null;
  return (
    <FlatList
      horizontal
      data={visible}
      keyExtractor={({ candidate }) => candidate.imageUrl}
      showsHorizontalScrollIndicator={false}
      initialNumToRender={5}
      windowSize={3}
      accessibilityLabel={c.stripLabel}
      contentContainerStyle={styles.strip}
      testID="cover-suggestion-strip"
      renderItem={({ item, index: position }) => {
        const selected = item.index === suggestion.index;
        return (
          <Pressable
            onPress={() => suggestion.select(item.index)}
            disabled={suggestion.accepting}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={format(c.thumbnailA11y, {
              position: position + 1,
              total: visible.length,
            })}
            style={[
              styles.thumbTouch,
              {
                borderColor: selected ? colors.textPrimary : colors.border,
                borderWidth: selected ? 2 : sizes.borderWidth,
              },
            ]}
            testID={`cover-suggestion-thumb-${item.index}`}
          >
            <Image
              source={{ uri: item.candidate.imageUrl }}
              style={[styles.thumb, { backgroundColor: colors.field }]}
              contentFit="cover"
              transition={0}
              priority="low"
              recyclingKey={item.candidate.imageUrl}
              accessible={false}
              accessibilityIgnoresInvertColors
              onError={() => setFailed((current) => new Set([...current, item.candidate.imageUrl]))}
              testID={`cover-suggestion-thumb-image-${item.index}`}
            />
          </Pressable>
        );
      }}
    />
  );
}

export function CoverSuggestionCard({
  suggestion,
  title,
}: {
  suggestion: CoverSuggestion;
  /** The typed title (the image's accessible label). */
  title: string;
}) {
  const { colors } = useTheme();
  const { candidate } = suggestion;
  if (!candidate) return null;
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID="cover-suggestion"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        <Image
          source={{ uri: candidate.imageUrl }}
          style={[styles.image, { backgroundColor: colors.field }]}
          contentFit="cover"
          transition={0}
          accessible
          accessibilityLabel={format(c.imageA11y, { title: candidate.title ?? title.trim() })}
          accessibilityIgnoresInvertColors
          testID="cover-suggestion-image"
        />
        <View style={styles.text}>
          <AppText variant="label" accessibilityRole="header">
            {c.title}
          </AppText>
          <AppText variant="caption">
            {format(c.source, { source: c.sources[candidate.source] })}
          </AppText>
          <AppText variant="caption" color="textSecondary">
            {c.hint}
          </AppText>
        </View>
      </View>
      {suggestion.acceptFailed ? (
        <View style={styles.error} accessibilityRole="alert" testID="cover-suggestion-error">
          <Icon name="alert-circle" size={sizes.iconSm} color={colors.danger} />
          <AppText variant="caption" color="danger" style={styles.errorText}>
            {c.downloadFailed}
          </AppText>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={suggestion.acceptFailed ? c.retry : c.accept}
          icon={suggestion.acceptFailed ? 'refresh' : undefined}
          onPress={() => void suggestion.accept()}
          loading={suggestion.accepting}
        />
        <Button
          variant="secondary"
          label={c.decline}
          onPress={suggestion.decline}
          disabled={suggestion.accepting}
        />
      </View>
      <CandidateStrip suggestion={suggestion} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: sizes.borderWidth,
    borderRadius: radii.field,
    padding: spacing.md,
    gap: spacing.md,
  },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  image: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, borderRadius: 4 },
  text: { flex: 1, gap: spacing.xxs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  strip: { gap: spacing.sm, paddingVertical: spacing.xxs },
  thumbTouch: {
    minWidth: sizes.minTouchTarget,
    minHeight: sizes.minTouchTarget,
    borderRadius: 4,
    overflow: 'hidden',
  },
  thumb: { width: THUMB_WIDTH, height: THUMB_HEIGHT },
  error: { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start' },
  errorText: { flex: 1 },
});
