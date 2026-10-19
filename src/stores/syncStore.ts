import { create } from 'zustand';

import { EMPTY_SYNC_SNAPSHOT, type SyncSnapshot } from '@/features/sync/syncEngine';

type SyncActions = {
  syncNow: () => Promise<void>;
  retryFailed: () => Promise<void>;
};

type SyncState = SyncSnapshot & SyncActions;

/** The running engine (set by the sync runtime); null while nobody is signed in. */
let engineActions: SyncActions | null = null;

export function setSyncEngineActions(actions: SyncActions | null): void {
  engineActions = actions;
}

/** Sync status for the UI (badge, Perfil, first-run message). Updated by the sync engine. */
export const useSyncStore = create<SyncState>()(() => ({
  ...EMPTY_SYNC_SNAPSHOT,
  syncNow: async () => engineActions?.syncNow(),
  retryFailed: async () => engineActions?.retryFailed(),
}));
