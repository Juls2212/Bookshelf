// The profile photo inside an avatar circle (Perfil card, Inicio header): the local file first,
// then a signed URL while this device has not downloaded it yet, and the fallback (initials or
// icon) when there is no photo or it fails to load. The parent draws the circle and clips it.
import { Image } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { t } from '@/i18n';
import { useProfileStore } from '@/stores/profileStore';

import { avatarService, type AvatarService } from './avatarService';
import type { Profile } from './profileRepository';

type AvatarSource = { uri: string; cacheKey: string };

/**
 * What to load for the photo, or null for the fallback. The cache key changes only when the
 * photo changes (avatar_updated_at), so a refreshed signed URL does not reload the image.
 */
export function avatarImageSource(
  profile: Pick<Profile, 'id' | 'avatarPath' | 'avatarLocalUri' | 'avatarUpdatedAt'> | null,
  signedUrl: string | null,
): AvatarSource | null {
  if (!profile?.avatarPath) return null;
  const uri = profile.avatarLocalUri ?? signedUrl;
  if (!uri) return null;
  return { uri, cacheKey: `avatar:${profile.id}:${profile.avatarUpdatedAt ?? ''}` };
}

/** Signed URL of the remote photo, only while there is no local file. */
function useSignedAvatarUrl(
  path: string | null,
  hasLocalFile: boolean,
  avatars: Pick<AvatarService, 'getSignedUrl'>,
): string | null {
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    if (!path || hasLocalFile) return;
    let active = true;
    void avatars.getSignedUrl(path).then((result) => {
      if (active && result.ok) setSigned({ path, url: result.data });
    });
    return () => {
      active = false;
    };
  }, [path, hasLocalFile, avatars]);
  return signed && signed.path === path ? signed.url : null;
}

type Props = {
  /** Shown without a photo, or when it fails to load. */
  fallback: ReactNode;
  avatars?: Pick<AvatarService, 'getSignedUrl'>;
};

export function ProfileAvatar({ fallback, avatars = avatarService }: Props) {
  const profile = useProfileStore((state) => state.profile);
  const signedUrl = useSignedAvatarUrl(
    profile?.avatarPath ?? null,
    Boolean(profile?.avatarLocalUri),
    avatars,
  );
  // Remembers which URI failed, so a new photo (or a fresh signed URL) is tried again.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const source = avatarImageSource(profile, signedUrl);
  if (!source || source.uri === failedUri) return <>{fallback}</>;
  return (
    <Image
      source={source}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={0}
      accessible
      accessibilityLabel={t.profile.avatar.a11y}
      accessibilityIgnoresInvertColors
      onError={() => setFailedUri(source.uri)}
      testID="profile-avatar-image"
    />
  );
}
