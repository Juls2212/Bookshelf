// The Librero: what it takes into account (preferences, optional mood), "Recomiéndame algo",
// and the dark panel with the result or the state (loading, errors, empty, offline), plus the
// history. Every action goes through the stores; nothing here talks to Supabase or SQLite.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/TextField';
import { useToast } from '@/components/Toast';
import { Icon } from '@/design/icons';
import { SchemeOverride, useTheme } from '@/design/ThemeProvider';
import { fonts, radii, sizes, spacing } from '@/design/tokens';
import { useCoverUris } from '@/features/library/useCoverUris';
import {
  AVAILABLE_TIMES,
  MOODS,
  toggleChoice,
  type AvailableTime,
  type Mood,
  type RecommendChoices,
} from '@/features/recommendations/recommendationRules';
import { format, t } from '@/i18n';
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { lineInput } from '@/lib/inputSanitizers';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useRecommendationsStore, type DiscoverInput } from '@/stores/recommendationsStore';
import { useSyncStore } from '@/stores/syncStore';
import type { Book } from '@/types/book';

import { DiscoveryPanel } from './DiscoveryPanel';
import { LoadingPanel, MessagePanel, PADDING } from './LibrarianPanels';
import {
  discoveryView,
  librarianView,
  preferencesSummary,
  type LibrarianView,
} from './librarianView';
import { RecommendationCard } from './RecommendationCard';
import { RecommendationHistorySheet } from './RecommendationHistorySheet';
import { SeedPickerSheet } from './SeedPickerSheet';

const CONTEXT_MAX_LENGTH = INPUT_LIMITS.aiContext;

/** One optional choice: tapping the selected chip clears it. */
function ChoiceChips<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <View style={styles.group}>
      <AppText variant="label" color="textSecondary">
        {label}
      </AppText>
      <View style={styles.chips} accessibilityLabel={label}>
        {options.map((option) => (
          <Chip
            key={option}
            label={labels[option]}
            selected={value === option}
            accessibilityHint={value === option ? t.librarian.chipClearHint : undefined}
            onPress={() => onChange(toggleChoice(value, option))}
          />
        ))}
      </View>
    </View>
  );
}

function PreferencesSummary() {
  const router = useRouter();
  const { colors } = useTheme();
  const preferences = usePreferencesStore((state) => state.preferences);
  const summary = preferencesSummary(preferences);
  return (
    <View
      style={[styles.summary, { backgroundColor: colors.surface }]}
      accessible={false}
      testID="librarian-preferences"
    >
      <AppText variant="label">{t.librarian.prefsLabel}</AppText>
      <AppText variant="body">{summary.genres}</AppText>
      <AppText variant="caption">{summary.options}</AppText>
      <Button
        variant="link"
        label={t.librarian.changePrefs}
        onPress={() => router.navigate('/profile')}
      />
    </View>
  );
}

function Panel({
  view,
  book,
  libraryReady,
  context,
  choices,
}: {
  view: LibrarianView;
  book: Book | null;
  libraryReady: boolean;
  context: string;
  choices: RecommendChoices;
}) {
  const router = useRouter();
  const toast = useToast();
  const store = useRecommendationsStore;
  const [shown] = useCoverUris(book ? [book] : []);
  const request = () => void store.getState().requestRecommendation(context, choices);
  const openBook = (id: string) => router.push({ pathname: '/book/[id]', params: { id } });

  switch (view.kind) {
    case 'loading':
      return <LoadingPanel onCancel={() => store.getState().cancel()} />;
    case 'error':
      return (
        <MessagePanel
          icon="alert-circle"
          title={t.librarian.errorTitle}
          text={t.recommendations.errors[view.error]}
          action={{ label: t.librarian.retry, icon: 'refresh', onPress: request }}
          testID={`librarian-error-${view.error}`}
        />
      );
    case 'no_candidates':
      return (
        <MessagePanel
          icon="book"
          title={t.librarian.noCandidatesTitle}
          text={t.recommendations.errors.no_candidates}
          action={{
            label: t.librarian.addBook,
            icon: 'plus',
            onPress: () => router.push('/book/new'),
          }}
          testID="librarian-no-candidates"
        />
      );
    case 'exhausted':
      return (
        <MessagePanel
          icon="check"
          title={t.librarian.exhaustedTitle}
          text={t.recommendations.errors.exhausted}
          action={{
            label: t.librarian.startOver,
            icon: 'refresh',
            onPress: () => void store.getState().startOver(context, choices),
          }}
          testID="librarian-exhausted"
        />
      );
    case 'invite':
      return (
        <MessagePanel
          icon="sparkles"
          title={t.librarian.inviteTitle}
          text={view.offline ? t.librarian.requestOfflineHint : t.librarian.inviteText}
          testID="librarian-invite"
        />
      );
    case 'result': {
      const { recommendation } = view;
      if (!book || !shown) {
        // While the library loads, the panel waits; a deleted book is unavailable.
        if (!libraryReady) return <LoadingPanel />;
        return (
          <MessagePanel
            icon="alert-circle"
            title={t.librarian.unavailableTitle}
            text={t.librarian.unavailableText}
            action={
              view.offline
                ? undefined
                : {
                    label: t.librarian.another,
                    icon: 'refresh',
                    onPress: () => void store.getState().requestAnother(context, choices),
                  }
            }
            testID="librarian-unavailable"
          />
        );
      }
      return (
        <RecommendationCard
          recommendation={recommendation}
          book={shown}
          offline={view.offline}
          onStartReading={async () => {
            const result = await useLibraryStore.getState().updateReadingStatus(book.id, 'reading');
            if (!result.ok) {
              toast.show(t.librarian.startReadingFailed, 'error');
              return;
            }
            void store.getState().markViewed(recommendation.id);
            openBook(book.id);
          }}
          onReadLater={async () => {
            if (await store.getState().saveForLater(recommendation.id)) {
              toast.show(t.toast.savedForLater, 'success');
            }
          }}
          onViewBook={() => {
            void store.getState().markViewed(recommendation.id);
            openBook(book.id);
          }}
          // The current one is marked skipped only once the next one arrived.
          onAnother={() => void store.getState().requestAnother(context, choices)}
        />
      );
    }
  }
}

type LibrarianMode = 'shelf' | 'discovery';

const modeOptions = [
  { value: 'shelf', label: t.librarian.modes.shelf },
  { value: 'discovery', label: t.librarian.modes.discovery },
] as const satisfies readonly { value: LibrarianMode; label: string }[];

/** "Parecido a…": the chosen reference book, or "Basado en mis favoritos". */
function SeedButton({ seed, onPress }: { seed: Book | null; onPress: () => void }) {
  const { colors } = useTheme();
  const value = seed?.title ?? t.librarian.discovery.seedFavorites;
  return (
    <View style={styles.group}>
      <AppText variant="label" color="textSecondary">
        {t.librarian.discovery.seedLabel}
      </AppText>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={format(t.librarian.discovery.seedA11y, { seed: value })}
        style={({ pressed }) => [
          styles.seed,
          { backgroundColor: colors.field, borderColor: colors.border },
          pressed && styles.pressed,
        ]}
        testID="seed-button"
      >
        <Icon name="book" size={sizes.iconMd} color={colors.textSecondary} />
        <AppText variant="body" color="textPrimary" numberOfLines={1} style={styles.flex}>
          {value}
        </AppText>
        <Icon name="chevron-down" size={sizes.iconMd} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

export function LibrarianScreen() {
  const params = useLocalSearchParams<{ mode?: string; seed?: string }>();
  const books = useLibraryStore((state) => state.books);
  const libraryStatus = useLibraryStore((state) => state.status);
  const considerMood = usePreferencesStore((state) => state.preferences.considerMood);
  const status = useRecommendationsStore((state) => state.status);
  const error = useRecommendationsStore((state) => state.error);
  const current = useRecommendationsStore((state) => state.current);
  const discoveryStatus = useRecommendationsStore((state) => state.discoveryStatus);
  const discoveryError = useRecommendationsStore((state) => state.discoveryError);
  const currentDiscovery = useRecommendationsStore((state) => state.currentDiscovery);
  const history = useRecommendationsStore((state) => state.history);
  const offline = useSyncStore((state) => state.status === 'offline');
  const [context, setContext] = useState('');
  // Kept while the screen is open; all are optional.
  const [availableTime, setAvailableTime] = useState<AvailableTime | null>(null);
  const [mood, setMood] = useState<Mood | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [seedPickerOpen, setSeedPickerOpen] = useState(false);
  const [mode, setMode] = useState<LibrarianMode>(
    params.mode === 'discovery' ? 'discovery' : 'shelf',
  );
  const [seedId, setSeedId] = useState<string | null>(params.seed ?? null);
  // "Buscar parecidos" from a ficha while the tab is already open: switch to that book.
  const routeKey = `${params.mode ?? ''}|${params.seed ?? ''}`;
  const [seenRouteKey, setSeenRouteKey] = useState(routeKey);
  if (routeKey !== seenRouteKey) {
    setSeenRouteKey(routeKey);
    if (params.mode === 'discovery') {
      setMode('discovery');
      setSeedId(params.seed ?? null);
    }
  }

  useEffect(() => {
    const library = useLibraryStore.getState();
    if (library.status === 'idle') void library.load();
    void useRecommendationsStore.getState().loadHistory();
  }, []);

  const view = librarianView({ status, error, current, offline });
  const book =
    view.kind === 'result'
      ? (books.find((b) => b.id === view.recommendation.bookId) ?? null)
      : null;
  // Mood off: the context and the mood are ignored by the Librero, so they are not asked for.
  const sentContext = considerMood ? context : '';
  const sentMood = considerMood ? mood : null;
  const choices: RecommendChoices = { availableTime, mood: sentMood };
  // A deleted reference book falls back to "Basado en mis favoritos".
  const seed = seedId ? (books.find((b) => b.id === seedId) ?? null) : null;
  const discoverInput: DiscoverInput = {
    seedBookId: seed?.id ?? null,
    mood: sentMood,
    context: sentContext,
  };
  const discovery = discoveryView({
    status: discoveryStatus,
    error: discoveryError,
    current: currentDiscovery,
    offline,
  });

  const moodFields = considerMood ? (
    <>
      <ChoiceChips
        label={t.librarian.moodLabel}
        options={MOODS}
        labels={t.librarian.mood}
        value={mood}
        onChange={setMood}
      />
      <TextField
        label={t.librarian.contextLabel}
        placeholder={t.librarian.contextPlaceholder}
        helperText={t.librarian.contextHint}
        value={context}
        onChangeText={(text) => setContext(lineInput(text, CONTEXT_MAX_LENGTH))}
        maxLength={CONTEXT_MAX_LENGTH}
        autoCapitalize="sentences"
        returnKeyType="done"
      />
    </>
  ) : null;

  const offlineHint = (text: string) =>
    offline ? (
      <View style={styles.offline}>
        <Icon name="cloud-off" size={16} />
        <AppText variant="caption" style={styles.flex}>
          {text}
        </AppText>
      </View>
    ) : null;

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={[styles.intro, { paddingHorizontal: PADDING }]}>
        <View style={styles.headerRow}>
          <AppText variant="label" style={styles.flex}>
            {t.librarian.eyebrow}
          </AppText>
          <Button
            variant="link"
            icon="clock"
            label={t.librarian.history}
            onPress={() => setHistoryOpen(true)}
          />
        </View>
        <SegmentedControl<LibrarianMode>
          options={modeOptions}
          value={mode}
          onChange={setMode}
          accessibilityLabel={t.librarian.modeLabel}
        />
        {mode === 'shelf' ? (
          <>
            <AppText variant="display" accessibilityRole="header">
              {considerMood ? (
                <>
                  {t.librarian.titleStart}
                  <AppText variant="display" style={{ fontFamily: fonts.serifItalic }}>
                    {t.librarian.titleEmphasis}
                  </AppText>
                  {t.librarian.titleEnd}
                </>
              ) : (
                t.librarian.titleNoMood
              )}
            </AppText>
            <AppText variant="body" color="textSecondary">
              {t.librarian.intro}
            </AppText>
            <PreferencesSummary />
            <ChoiceChips
              label={t.librarian.timeLabel}
              options={AVAILABLE_TIMES}
              labels={t.librarian.time}
              value={availableTime}
              onChange={setAvailableTime}
            />
            {moodFields}
            <Button
              label={t.librarian.request}
              icon="sparkles"
              loading={status === 'loading'}
              disabled={offline}
              accessibilityHint={offline ? t.librarian.requestOfflineHint : undefined}
              onPress={() =>
                void useRecommendationsStore.getState().requestRecommendation(sentContext, choices)
              }
            />
            {offlineHint(t.librarian.requestOfflineHint)}
          </>
        ) : (
          <>
            <AppText variant="display" accessibilityRole="header">
              {t.librarian.discovery.title}
            </AppText>
            <AppText variant="body" color="textSecondary">
              {t.librarian.discovery.intro}
            </AppText>
            <SeedButton seed={seed} onPress={() => setSeedPickerOpen(true)} />
            {moodFields}
            <Button
              label={t.librarian.discovery.request}
              icon="sparkles"
              loading={discoveryStatus === 'loading'}
              disabled={offline}
              accessibilityHint={offline ? t.librarian.discovery.offlineHint : undefined}
              onPress={() =>
                void useRecommendationsStore.getState().requestDiscovery(discoverInput)
              }
            />
            {offlineHint(t.librarian.discovery.offlineHint)}
          </>
        )}
      </View>
      {/* The recommendation scene is always dark, as in both mockup themes. */}
      <SchemeOverride scheme="dark">
        {mode === 'shelf' ? (
          <Panel
            view={view}
            book={book}
            libraryReady={libraryStatus === 'ready'}
            context={sentContext}
            choices={choices}
          />
        ) : (
          <DiscoveryPanel view={discovery} input={discoverInput} />
        )}
      </SchemeOverride>
      <RecommendationHistorySheet
        visible={historyOpen}
        onClose={() => setHistoryOpen(false)}
        history={history}
        books={books}
      />
      <SeedPickerSheet
        visible={seedPickerOpen}
        books={books}
        selectedId={seed?.id ?? null}
        onSelect={setSeedId}
        onClose={() => setSeedPickerOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 0, gap: spacing.xl, paddingTop: spacing.lg, flexGrow: 1 },
  intro: { gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1 },
  summary: { borderRadius: radii.field, padding: spacing.md, gap: spacing.xs },
  offline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  group: { gap: spacing.sm },
  seed: {
    minHeight: sizes.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.field,
    borderWidth: sizes.borderWidth,
  },
  pressed: { opacity: 0.85 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
