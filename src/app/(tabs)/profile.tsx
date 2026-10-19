import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { useToast } from '@/components/Toast';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { fonts, radii, sizes, spacing } from '@/design/tokens';
import { authErrorMessage } from '@/features/auth/authErrors';
import { CropEditor } from '@/features/library/CropEditor';
import type { LocalImage } from '@/features/library/coverService';
import { PreferencesSection } from '@/features/preferences/PreferencesSection';
import { AvatarSheet } from '@/features/profile/AvatarSheet';
import { useDisplayName } from '@/features/profile/displayName';
import { EditNameSheet } from '@/features/profile/EditNameSheet';
import { ProfileAvatar } from '@/features/profile/ProfileAvatar';
import { signOutFlow } from '@/features/sync/signOutFlow';
import { SyncBadge } from '@/features/sync/SyncBadge';
import { lastSyncText, syncBadgeFor, syncStatusText } from '@/features/sync/syncPresentation';
import { format, t } from '@/i18n';
import { formatMonthYear } from '@/lib/dates';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useSyncStore } from '@/stores/syncStore';
import type { ThemeMode } from '@/stores/themeStore';

const PADDING = spacing.lg + spacing.xs;
/** Display (44 lineHeight) still fits the 64 px circle at this scale. */
const MONOGRAM_MAX_SCALE = 1.4;

const themeOptions = [
  { value: 'light', label: t.theme.light },
  { value: 'dark', label: t.theme.dark },
  { value: 'system', label: t.theme.system },
] as const satisfies readonly { value: ThemeMode; label: string }[];

/**
 * The avatar button: opens "Foto de perfil"; a taken or chosen image goes through the square
 * crop step (circular guide) and is saved locally and synced by the profile store.
 */
function AvatarButton({ displayName }: { displayName: string | null }) {
  const { colors } = useTheme();
  const toast = useToast();
  const canEdit = useProfileStore((state) => state.profile !== null);
  const hasPhoto = useProfileStore((state) => Boolean(state.profile?.avatarPath));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [picked, setPicked] = useState<LocalImage | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (image: LocalImage) => {
    setPicked(null);
    setSaving(true);
    const ok = await useProfileStore.getState().setAvatar(image);
    setSaving(false);
    toast.show(ok ? t.profile.avatar.saved : t.profile.avatar.failed, ok ? 'success' : 'error');
  };

  const remove = async () => {
    setSaving(true);
    const ok = await useProfileStore.getState().removeAvatar();
    setSaving(false);
    toast.show(
      ok ? t.profile.avatar.removed : t.profile.avatar.removeFailed,
      ok ? 'success' : 'error',
    );
  };

  return (
    <>
      <Pressable
        onPress={() => setSheetOpen(true)}
        disabled={!canEdit || saving}
        accessibilityRole="button"
        accessibilityLabel={hasPhoto ? t.profile.avatar.changeA11y : t.profile.avatar.addA11y}
        accessibilityState={{ disabled: !canEdit || saving, busy: saving }}
        style={[styles.avatar, { backgroundColor: colors.actionPrimary }]}
        testID="profile-avatar-button"
      >
        <ProfileAvatar
          fallback={
            // Monogram capped so large text sizes do not clip it inside the fixed circle.
            displayName ? (
              <AppText
                variant="display"
                color="actionPrimaryText"
                maxFontSizeMultiplier={MONOGRAM_MAX_SCALE}
              >
                {displayName.charAt(0).toLocaleUpperCase()}
              </AppText>
            ) : (
              <Icon name="user" size={28} color={colors.actionPrimaryText} />
            )
          }
        />
        {saving ? (
          <ActivityIndicator
            style={StyleSheet.absoluteFill}
            color={colors.actionPrimaryText}
            accessibilityLabel={t.profile.avatar.saving}
          />
        ) : null}
      </Pressable>
      <AvatarSheet
        visible={sheetOpen}
        hasPhoto={hasPhoto}
        onClose={() => setSheetOpen(false)}
        onPicked={setPicked}
        onRemove={() => void remove()}
      />
      {picked ? (
        <CropEditor
          image={picked}
          initialCrop={null}
          aspect={1}
          circleGuide
          title={t.profile.avatar.cropTitle}
          hint={t.profile.avatar.cropHint}
          onApply={(crop) => void save({ ...picked, crop })}
          onCancel={() => setPicked(null)}
        />
      ) : null}
    </>
  );
}

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
        <AvatarButton displayName={displayName} />
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

function SyncSection() {
  const { colors } = useTheme();
  const status = useSyncStore((state) => state.status);
  const pendingCount = useSyncStore((state) => state.pendingCount);
  const failedCount = useSyncStore((state) => state.failedCount);
  const lastSyncAt = useSyncStore((state) => state.lastSyncAt);
  const badge = syncBadgeFor({ status, pendingCount, failedCount });
  return (
    <View style={[styles.syncSection, { borderBottomColor: colors.border }]}>
      <View style={styles.syncRow}>
        <AppText variant="label" style={styles.flex}>
          {t.profile.syncLabel}
        </AppText>
        <SyncBadge />
      </View>
      <View style={styles.gapXs} accessibilityLiveRegion="polite">
        <AppText variant="body" color={badge.kind === 'error' ? 'danger' : 'textPrimary'}>
          {syncStatusText(badge)}
        </AppText>
        <AppText variant="caption">{lastSyncText(lastSyncAt, new Date())}</AppText>
      </View>
      <View style={styles.syncActions}>
        {failedCount > 0 ? (
          <Button
            icon="refresh"
            label={t.sync.retry}
            onPress={() => void useSyncStore.getState().retryFailed()}
          />
        ) : null}
        <Button
          variant="secondary"
          icon="refresh"
          label={t.sync.syncNow}
          loading={status === 'syncing'}
          onPress={() => void useSyncStore.getState().syncNow()}
        />
      </View>
    </View>
  );
}

type SignOutStep = 'idle' | 'confirm' | 'confirmUnsynced';

function SignOutButton() {
  const toast = useToast();
  const [step, setStep] = useState<SignOutStep>('idle');
  const [busy, setBusy] = useState(false);

  // Unsynced changes get a final sync first; if some remain, the user must confirm.
  const start = async () => {
    setBusy(true);
    const check = await signOutFlow.prepare();
    setBusy(false);
    setStep(check === 'clean' ? 'confirm' : 'confirmUnsynced');
  };

  const signOut = async () => {
    setStep('idle');
    setBusy(true);
    const result = await signOutFlow.signOut();
    setBusy(false);
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
        onPress={start}
      />
      <ConfirmDialog
        visible={step === 'confirm'}
        destructive
        title={t.profile.signOutTitle}
        message={t.profile.signOutMessage}
        confirmLabel={t.profile.signOut}
        cancelLabel={t.bookDetail.cancel}
        onCancel={() => setStep('idle')}
        onConfirm={signOut}
      />
      <ConfirmDialog
        visible={step === 'confirmUnsynced'}
        destructive
        title={t.profile.signOutUnsyncedTitle}
        message={t.profile.signOutUnsyncedMessage}
        confirmLabel={t.profile.signOutAnyway}
        cancelLabel={t.bookDetail.cancel}
        onCancel={() => setStep('idle')}
        onConfirm={signOut}
      />
    </View>
  );
}

/** Development builds only: the way into the component gallery and its dev switches. */
function DevGalleryLink() {
  const router = useRouter();
  return (
    <View style={styles.section}>
      <Button
        variant="link"
        label={t.profile.devGallery}
        onPress={() => router.push('/dev-gallery')}
      />
    </View>
  );
}

export default function ProfileScreen() {
  const { mode, setMode } = useTheme();
  // Local theme changes immediately; the profile copy is saved best-effort (silent on failure).
  const changeTheme = (next: ThemeMode) => {
    setMode(next);
    void useProfileStore.getState().saveTheme(next);
  };
  return (
    <Screen scroll contentStyle={styles.content}>
      <AppText variant="display" accessibilityRole="header" style={styles.title}>
        {t.profile.title}
      </AppText>
      <ReaderCard />

      <PreferencesSection />

      <View style={styles.section}>
        <AppText variant="label">{t.profile.appearanceLabel}</AppText>
        <SegmentedControl
          options={themeOptions}
          value={mode}
          onChange={changeTheme}
          accessibilityLabel={t.profile.appearanceLabel}
        />
      </View>

      <SyncSection />

      <SignOutButton />

      {__DEV__ ? <DevGalleryLink /> : null}
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
    overflow: 'hidden',
  },
  sinceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  semibold: { fontFamily: fonts.sansSemiBold },
  flex: { flex: 1 },
  gapXs: { gap: spacing.xs },
  section: { gap: spacing.md },
  syncSection: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: sizes.borderWidth,
  },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  syncActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  signOut: { alignItems: 'flex-start' },
});
