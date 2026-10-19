// "Mis géneros favoritos" and "Cómo te recomienda tu librero": the real reading preferences.
// Every change applies at once and is saved automatically (local first, then synced); a small
// badge tells whether it is already in the account or still waiting to sync.
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Chip } from '@/components/Chip';
import { SyncStatusBadge, type SyncBadgeKind } from '@/components/SyncStatusBadge';
import { useToast } from '@/components/Toast';
import { useTheme } from '@/design/ThemeProvider';
import { fonts, sizes, spacing } from '@/design/tokens';
import { t } from '@/i18n';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useSyncStore } from '@/stores/syncStore';

import { GENRE_KEYS, PREFERENCE_OPTIONS, type PreferenceOption } from './preferencesRules';

type SaveState = Extract<SyncBadgeKind, 'synced' | 'pending' | 'offline'>;

function SaveBadge() {
  const pending = usePreferencesStore((state) => state.pending);
  const offline = useSyncStore((state) => state.status === 'offline');
  const kind: SaveState = !pending ? 'synced' : offline ? 'offline' : 'pending';
  const key = kind === 'synced' ? 'saved' : kind;
  return (
    <SyncStatusBadge
      kind={kind}
      label={t.profile.prefsStatus[key]}
      accessibilityLabel={t.profile.prefsStatusA11y[key]}
    />
  );
}

function OptionRow({ option }: { option: PreferenceOption }) {
  const { colors } = useTheme();
  const toast = useToast();
  const value = usePreferencesStore((state) => state.preferences[option]);
  const copy = t.profile.prefs[option];
  const change = async (next: boolean) => {
    const saved = await usePreferencesStore.getState().setOption(option, next);
    if (!saved) toast.show(t.profile.prefsSaveFailed, 'error');
  };
  return (
    // The whole row toggles (a large touch target); the switch carries the accessible state.
    <Pressable
      onPress={() => void change(!value)}
      accessible={false}
      style={[styles.prefRow, { borderBottomColor: colors.border }]}
    >
      <View style={styles.flex}>
        <AppText variant="body" style={styles.semibold}>
          {copy.title}
        </AppText>
        <AppText variant="caption">{copy.text}</AppText>
      </View>
      <Switch
        value={value}
        onValueChange={(next) => void change(next)}
        accessibilityLabel={copy.title}
        accessibilityHint={copy.text}
        trackColor={{ false: colors.track, true: colors.actionPrimary }}
        thumbColor={colors.switchThumb}
        ios_backgroundColor={colors.track}
        testID={`preference-${option}`}
      />
    </Pressable>
  );
}

export function PreferencesSection() {
  const { colors } = useTheme();
  const toast = useToast();
  const genres = usePreferencesStore((state) => state.preferences.favoriteGenres);
  const toggle = async (genre: (typeof GENRE_KEYS)[number]) => {
    const saved = await usePreferencesStore.getState().toggleGenre(genre);
    if (!saved) toast.show(t.profile.prefsSaveFailed, 'error');
  };

  return (
    <>
      <View style={styles.section}>
        <View style={styles.headerRow}>
          <AppText variant="label" style={styles.flex}>
            {t.profile.genresLabel}
          </AppText>
          <SaveBadge />
        </View>
        <View style={styles.chips}>
          {GENRE_KEYS.map((genre) => (
            <Chip
              key={genre}
              label={t.profile.genres[genre]}
              selected={genres.includes(genre)}
              checkWhenSelected
              onPress={() => void toggle(genre)}
            />
          ))}
        </View>
      </View>

      <View>
        <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
          <AppText variant="label">{t.profile.recommendLabel}</AppText>
        </View>
        {PREFERENCE_OPTIONS.map((option) => (
          <OptionRow key={option} option={option} />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sectionHeader: { borderBottomWidth: sizes.borderWidth, paddingBottom: spacing.md },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    borderBottomWidth: sizes.borderWidth,
    minHeight: sizes.minTouchTarget,
  },
  semibold: { fontFamily: fonts.sansSemiBold },
  flex: { flex: 1 },
});
