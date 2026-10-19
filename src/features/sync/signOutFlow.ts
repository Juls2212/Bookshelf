// Safe sign-out. Before signing out, unsynced changes get one last sync attempt; if some remain
// the UI asks for confirmation. After signing out, the engine stops and the database closes;
// the user's local files (database, covers, profile photos) are deleted only when nothing was
// left to sync. A confirmed sign-out
// with pending changes keeps them, so they sync when the same user signs in again.
// A forced sign-out (expired or invalid session) never goes through here, so it never deletes
// local data: it only stops the engine and closes the database (see the auth bindings).
import { deleteUserDatabase } from '@/db/database';
import { countSyncQueue } from '@/db/syncQueue';
import type { AuthResult } from '@/features/auth/authService';
import { coverService } from '@/features/library/coverService';
import { librarySession, type LibrarySession } from '@/features/library/librarySession';
import { avatarService } from '@/features/profile/avatarService';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';

import { stopSyncEngine } from './syncRuntime';

type SignOutCheck = 'clean' | 'unsynced';

type Deps = {
  session: Pick<LibrarySession, 'current' | 'stop'>;
  /** Runs a sync now (a no-op while offline). */
  syncNow: () => Promise<void>;
  signOut: () => Promise<AuthResult>;
  stopEngine: () => void;
  deleteDatabase: (userId: string) => Promise<boolean>;
  deleteCovers: (userId: string) => boolean;
  deleteAvatars: (userId: string) => boolean;
};

type SignOutFlow = {
  /** Tries a final sync when something is unsynced; 'unsynced' means the UI must confirm. */
  prepare(): Promise<SignOutCheck>;
  /** Signs out; deletes this user's local data only if the queue was empty. */
  signOut(): Promise<AuthResult>;
};

export function createSignOutFlow(deps: Deps): SignOutFlow {
  /** Pending + failed queue entries of the signed-in user (from the database itself). */
  const unsyncedCount = async (): Promise<number | null> => {
    try {
      const active = await deps.session.current();
      return active ? await countSyncQueue(active.db) : null;
    } catch {
      return null;
    }
  };

  return {
    async prepare() {
      if (((await unsyncedCount()) ?? 0) === 0) return 'clean';
      await deps.syncNow();
      return ((await unsyncedCount()) ?? 0) === 0 ? 'clean' : 'unsynced';
    },

    async signOut() {
      const active = await deps.session.current().catch(() => null);
      const queued = await unsyncedCount();
      const result = await deps.signOut();
      if (!result.ok) return result;
      deps.stopEngine();
      await deps.session.stop();
      // Unknown (null) counts as unsynced: when in doubt, keep the data.
      if (active && queued === 0) {
        await deps.deleteDatabase(active.userId);
        deps.deleteCovers(active.userId);
        deps.deleteAvatars(active.userId);
      }
      return result;
    },
  };
}

export const signOutFlow: SignOutFlow = createSignOutFlow({
  session: librarySession,
  syncNow: () => useSyncStore.getState().syncNow(),
  signOut: () => useAuthStore.getState().signOut(),
  stopEngine: stopSyncEngine,
  deleteDatabase: (userId) => deleteUserDatabase(userId),
  deleteCovers: (userId) => coverService.deleteLocalCovers(userId),
  deleteAvatars: (userId) => avatarService.deleteLocalAvatars(userId),
});
