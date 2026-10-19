// Wires the sync engine to the app: the authenticated session, the library store, the profile
// preferences and recommendations stores and the sync store. One engine per signed-in user; stopped on sign-out.
import { useEffect } from 'react';

import { coverService } from '@/features/library/coverService';
import { librarySession } from '@/features/library/librarySession';
import { supabaseBookGateway } from '@/features/library/supabaseBookGateway';
import { supabaseReadingEventGateway } from '@/features/library/supabaseReadingEventGateway';
import { supabasePreferencesGateway } from '@/features/preferences/supabasePreferencesGateway';
import { avatarService } from '@/features/profile/avatarService';
import { supabaseProfileGateway } from '@/features/profile/supabaseProfileGateway';
import { supabaseRecommendationGateway } from '@/features/recommendations/supabaseRecommendationGateway';
import { appForeground, deviceNetwork } from '@/lib/network';
import { useAuthStore } from '@/stores/authStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useProfileStore } from '@/stores/profileStore';
import { useRecommendationsStore } from '@/stores/recommendationsStore';
import { setSyncEngineActions, useSyncStore } from '@/stores/syncStore';

import { setLocalWriteListener } from './localWrites';
import { createSyncEngine, type SyncEngine } from './syncEngine';

let engine: SyncEngine | null = null;
let engineUserId: string | null = null;

/** Stops the engine of the signed-in user (idempotent). */
export function stopSyncEngine(): void {
  engine?.stop();
  engine = null;
  engineUserId = null;
  setSyncEngineActions(null);
  setLocalWriteListener(null);
  usePreferencesStore.getState().clear();
  useRecommendationsStore.getState().clear();
}

async function startEngine(userId: string): Promise<void> {
  if (engineUserId === userId) return;
  stopSyncEngine();
  engineUserId = userId;
  // Session ready (database open + initial pull attempted) before the first sync.
  await librarySession.start(userId).catch(() => undefined);
  if (engineUserId !== userId) return; // signed out or switched meanwhile
  // The cached profile is readable now (also offline).
  void useProfileStore.getState().load(userId);
  void usePreferencesStore.getState().load(userId);
  // The last recommendation is readable from the cache, also offline.
  void useRecommendationsStore.getState().load(userId);

  const created = createSyncEngine({
    session: librarySession,
    gateway: supabaseBookGateway,
    profiles: supabaseProfileGateway,
    preferences: supabasePreferencesGateway,
    recommendations: supabaseRecommendationGateway,
    readingEvents: supabaseReadingEventGateway,
    covers: coverService,
    avatars: avatarService,
    network: deviceNetwork,
    foreground: appForeground,
    onSnapshot: (snapshot) => useSyncStore.setState(snapshot),
    onRemoteChanges: () => void useLibraryStore.getState().refresh(),
    onProfileChange: () => void useProfileStore.getState().load(userId),
    onPreferencesChange: () => void usePreferencesStore.getState().load(userId),
    onRecommendationsChange: () => void useRecommendationsStore.getState().loadHistory(),
  });
  engine = created;
  setSyncEngineActions({ syncNow: created.syncNow, retryFailed: created.retryFailed });
  setLocalWriteListener(() => created.notifyLocalChange());
  created.start();
}

/** Starts the engine for the signed-in user and stops it on sign-out. Returns an unbind. */
export function bindSyncToAuth(): () => void {
  const apply = (userId: string | null) => {
    if (userId) void startEngine(userId);
    else stopSyncEngine();
  };
  apply(useAuthStore.getState().user?.id ?? null);
  const unsubscribe = useAuthStore.subscribe((state, previous) => {
    const userId = state.user?.id ?? null;
    if (userId !== (previous.user?.id ?? null)) apply(userId);
  });
  return () => {
    unsubscribe();
    stopSyncEngine();
  };
}

/** Root-layout hook: keeps the sync engine bound to the authenticated session. */
export function useSyncLifecycle(): void {
  useEffect(() => bindSyncToAuth(), []);
}
