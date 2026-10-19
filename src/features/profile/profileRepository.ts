// Profile data access contract. The UI uses it (via the profile store), never Supabase or SQLite.
// The app implementation is local-first (sqliteProfileRepository); the sync engine pushes and
// pulls the profile with supabaseProfileGateway.
import type { ThemePreference } from '@/types/database';

export type Profile = {
  id: string;
  displayName: string | null;
  theme: ThemePreference;
  /** Remote path of the photo (avatars bucket), or null without a photo. */
  avatarPath: string | null;
  /** The photo file on this device; null without a photo or before it is downloaded. */
  avatarLocalUri: string | null;
  /** When the photo last changed; part of the image cache key. */
  avatarUpdatedAt: string | null;
  createdAt: string;
};

export type ProfileErrorCode = 'not_found' | 'network_error' | 'unknown';

export type RepoResult<T> = { ok: true; data: T } | { ok: false; error: ProfileErrorCode };

export interface ProfileRepository {
  /** The cached profile; not_found until it has been pulled once on this device. */
  getProfile(userId: string): Promise<RepoResult<Profile>>;
  /** Saves locally and queues the change for sync. */
  updateDisplayName(userId: string, displayName: string): Promise<RepoResult<Profile>>;
  /** Saves locally and queues the change for sync. */
  updateTheme(userId: string, theme: ThemePreference): Promise<RepoResult<Profile>>;
  /** Uses a prepared local photo file; saves locally and queues its upload. */
  setAvatar(userId: string, localUri: string): Promise<RepoResult<Profile>>;
  /** Removes the photo; saves locally and queues the removal of the remote copy. */
  removeAvatar(userId: string): Promise<RepoResult<Profile>>;
}
