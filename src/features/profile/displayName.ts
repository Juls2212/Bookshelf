import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';

/** First word of a display name, or null when there is no usable name. */
export function firstNameOf(displayName: string | null | undefined): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * Display name from the profile, falling back to the sign-up metadata stored in the session
 * (available offline before the profile loads).
 */
export function useDisplayName(): string | null {
  const profileName = useProfileStore((state) => state.profile?.displayName ?? null);
  const metadataName = useAuthStore((state) => {
    const value: unknown = state.user?.user_metadata?.display_name;
    return typeof value === 'string' ? value : null;
  });
  const name = (profileName ?? metadataName)?.trim();
  return name ? name : null;
}
