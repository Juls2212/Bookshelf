import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { useToast } from '@/components/Toast';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { fonts, radii, sizes, spacing } from '@/design/tokens';
import { useMockData } from '@/features/_mock/mockData';
import { authErrorMessage } from '@/features/auth/authErrors';
import { useDisplayName } from '@/features/profile/displayName';
import { EditNameSheet } from '@/features/profile/EditNameSheet';
import { format, t } from '@/i18n';
import { formatMonthYear } from '@/lib/dates';
import { checkSupabaseHealth, type HealthResult } from '@/lib/supabaseHealth';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import type { ThemeMode } from '@/stores/themeStore';

const PADDING = spacing.lg + spacing.xs;
type GenreKey = keyof typeof t.profile.genres;
type PrefKey = keyof typeof t.profile.prefs;
const GENRES = Object.keys(t.profile.genres) as GenreKey[];
const PREFS = Object.keys(t.profile.prefs) as PrefKey[];

const themeOptions = [
  { value: 'light', label: t.theme.light },
  { value: 'dark', label: t.theme.dark },
  { value: 'system', label: t.theme.system },
] as const satisfies readonly { value: ThemeMode; label: string }[];

function ReaderCard() {
  const { colors, scheme } = useTheme();
  const outline = scheme === 'dark' ? colors.track : colors.textPrimary;
  const displayName = useDisplayName();
  const email = useAuthStore((state) => state.user?.email ?? '');
  const userCreatedAt = useAuthStore((state) => state.user?.created_at ?? null);
  const profileCreatedAt = useProfileStore((state) => state.profile?.createdAt ?? null);
  const canEdit = useProfileStore((state) => state.profile !== null);
  const [editing, setEditing] = useState(false);
  const since = profileCreatedAt ?? userCreatedAt;
  const name = displayName ?? t.profile.unnamed;
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surfaceElevated,
          borderColor: outline,
          shadowColor: colors.shadow,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <AppText variant="label" color="textSecondary">
          {t.profile.cardLabel}
        </AppText>
        <View style={styles.holes} accessibilityElementsHidden importantForAccessibility="no">
          <View style={[styles.hole, { borderColor: colors.textPrimary }]} />
          <View style={[styles.hole, { borderColor: colors.textPrimary }]} />
        </View>
      </View>
      <View style={[styles.dashed, { borderColor: colors.accent }]} />
      <View style={styles.cardBody}>
        <View style={[styles.avatar, { backgroundColor: colors.actionPrimary }]}>
          {displayName ? (
            <AppText variant="display" color="actionPrimaryText">
              {displayName.charAt(0).toLocaleUpperCase()}
            </AppText>
          ) : (
            <Icon name="user" size={28} color={colors.actionPrimaryText} />
          )}
        </View>
        <View style={styles.flex}>
          <AppText variant="title" numberOfLines={2}>
            {name}
          </AppText>
          <AppText variant="caption" numberOfLines={1}>
            {email}
          </AppText>
          <View style={styles.sinceRow}>
            <AppText variant="caption" color="accentText" style={[styles.flex, styles.semibold]}>
              {since
                ? format(t.profile.memberSince, { date: formatMonthYear(new Date(since)) })
                : null}
            </AppText>
            <Button
              variant="link"
              label={t.profile.edit}
              accessibilityHint={t.profile.editNameTitle}
              disabled={!canEdit}
              onPress={() => setEditing(true)}
            />
          </View>
        </View>
      </View>
      {editing ? (
        <EditNameSheet initialName={displayName ?? ''} onClose={() => setEditing(false)} />
      ) : null}
    </View>
  );
}

function SignOutButton() {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    const result = await useAuthStore.getState().signOut();
    setBusy(false);
    setConfirming(false);
    // On success the route guard returns to the login screen.
    if (!result.ok) toast.show(authErrorMessage(result.error), 'error');
  };

  return (
    <View style={styles.signOut}>
      <Button
        variant="ghostDanger"
        icon="log-out"
        label={t.profile.signOut}
        loading={busy}
        onPress={() => setConfirming(true)}
      />
      <ConfirmDialog
        visible={confirming}
        destructive
        title={t.profile.signOutTitle}
        message={t.profile.signOutMessage}
        confirmLabel={t.profile.signOut}
        cancelLabel={t.bookDetail.cancel}
        onCancel={() => setConfirming(false)}
        onConfirm={signOut}
      />
    </View>
  );
}

function PreferenceRow({ prefKey, initial }: { prefKey: PrefKey; initial: boolean }) {
  const { colors } = useTheme();
  const [value, setValue] = useState(initial);
  const copy = t.profile.prefs[prefKey];
  return (
    <View style={[styles.prefRow, { borderBottomColor: colors.border }]}>
      <View style={styles.flex}>
        <AppText variant="body" style={styles.semibold}>
          {copy.title}
        </AppText>
        <AppText variant="caption">{copy.text}</AppText>
      </View>
      <Switch
        value={value}
        onValueChange={setValue}
        accessibilityLabel={copy.title}
        accessibilityHint={copy.text}
        trackColor={{ false: colors.track, true: colors.actionPrimary }}
        thumbColor={colors.switchThumb}
        ios_backgroundColor={colors.track}
      />
    </View>
  );
}

function DevTools() {
  const router = useRouter();
  const [health, setHealth] = useState<HealthResult | null>(null);

  useEffect(() => {
    let active = true;
    checkSupabaseHealth().then((value) => {
      if (active) setHealth(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const message =
    health === null
      ? t.health.checking
      : health.status === 'ok'
        ? t.health.ok
        : t.health.errors[health.code];

  return (
    <View style={styles.section}>
      <AppText variant="label">{t.health.title}</AppText>
      <AppText variant="caption">{message}</AppText>
      <Button
        variant="link"
        label={t.profile.devGallery}
        onPress={() => router.push('/dev-gallery')}
      />
    </View>
  );
}

export default function ProfileScreen() {
  const data = useMockData();
  const { colors, mode, setMode } = useTheme();
  // Local theme changes immediately; the profile copy is saved best-effort (silent on failure).
  const changeTheme = (next: ThemeMode) => {
    setMode(next);
    void useProfileStore.getState().saveTheme(next);
  };
  const [genres, setGenres] = useState<GenreKey[]>([...data.profile.favoriteGenres]);
  const toggleGenre = (genre: GenreKey) =>
    setGenres((current) =>
      current.includes(genre) ? current.filter((g) => g !== genre) : [...current, genre],
    );

  return (
    <Screen scroll contentStyle={styles.content}>
      <AppText variant="display" accessibilityRole="header" style={styles.title}>
        {t.profile.title}
      </AppText>
      <ReaderCard />

      <View style={styles.section}>
        <AppText variant="label">{t.profile.genresLabel}</AppText>
        <View style={styles.chips}>
          {GENRES.map((genre) => (
            <Chip
              key={genre}
              label={t.profile.genres[genre]}
              selected={genres.includes(genre)}
              onPress={() => toggleGenre(genre)}
            />
          ))}
        </View>
      </View>

      <View>
        <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
          <AppText variant="label">{t.profile.recommendLabel}</AppText>
        </View>
        {PREFS.map((key) => (
          <PreferenceRow key={key} prefKey={key} initial={data.profile.preferences[key]} />
        ))}
      </View>

      <View style={styles.section}>
        <AppText variant="label">{t.profile.appearanceLabel}</AppText>
        <SegmentedControl
          options={themeOptions}
          value={mode}
          onChange={changeTheme}
          accessibilityLabel={t.profile.appearanceLabel}
        />
      </View>

      <View style={[styles.syncRow, { borderBottomColor: colors.border }]}>
        <View style={[styles.flex, styles.gapXs]}>
          <AppText variant="label">{t.profile.syncLabel}</AppText>
          <AppText variant="caption">{t.profile.syncText}</AppText>
        </View>
        <SyncStatusBadge status={data.syncStatus} />
      </View>

      <SignOutButton />

      {__DEV__ ? <DevTools /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingHorizontal: PADDING, paddingBottom: spacing.xxl },
  title: { paddingTop: spacing.lg },
  card: {
    borderWidth: sizes.borderWidth,
    borderRadius: radii.field,
    padding: spacing.lg + spacing.xs,
    gap: spacing.md,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  holes: { flexDirection: 'row', gap: spacing.xs },
  hole: { width: 12, height: 12, borderRadius: 6, borderWidth: sizes.borderWidth },
  dashed: { borderBottomWidth: sizes.borderWidth, borderStyle: 'dashed' },
  cardBody: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sinceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  semibold: { fontFamily: fonts.sansSemiBold },
  flex: { flex: 1 },
  gapXs: { gap: spacing.xs },
  section: { gap: spacing.md },
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
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: sizes.borderWidth,
  },
  signOut: { alignItems: 'flex-start' },
});
