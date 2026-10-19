import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import * as SQLite from 'expo-sqlite';

import * as authService from '@/features/auth/authService';
import { coverService } from '@/features/library/coverService';
import { librarySession } from '@/features/library/librarySession';
import { avatarService } from '@/features/profile/avatarService';
import { bindSyncToAuth } from '@/features/sync/syncRuntime';
import { resetAuthStore, useAuthStore } from '@/stores/authStore';
import '@/stores/libraryStore';
import { useSyncStore } from '@/stores/syncStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('@/features/auth/authService', () => ({
  restoreSession: jest.fn(),
  onAuthStateChange: jest.fn(),
  signOut: jest.fn(),
}));
jest.mock('@/features/library/librarySession', () => ({
  librarySession: {
    start: jest.fn(async () => undefined),
    current: jest.fn(async () => null),
    stop: jest.fn(async () => undefined),
  },
}));
jest.mock('@/features/library/coverService', () => ({
  coverService: { clearCache: jest.fn(), deleteLocalCovers: jest.fn() },
}));
jest.mock('@/features/profile/avatarService', () => ({
  avatarService: { clearCache: jest.fn(), deleteLocalAvatars: jest.fn() },
}));

const auth = authService as jest.Mocked<typeof authService>;
const session = { user: { id: '11111111-1111-4111-8111-111111111111' } } as Session;

it('a forced sign-out (expired or invalid session) stops sync and closes the database but keeps local data', async () => {
  let emit: (event: AuthChangeEvent, next: Session | null) => void = () => undefined;
  auth.restoreSession.mockResolvedValue({ session });
  auth.onAuthStateChange.mockImplementation((listener) => {
    emit = listener;
    return () => undefined;
  });
  resetAuthStore();
  await useAuthStore.getState().initialize();
  const unbind = bindSyncToAuth();
  await Promise.resolve();
  expect(librarySession.start).toHaveBeenCalled();

  // Supabase reports SIGNED_OUT on its own (refresh token revoked or expired).
  emit('SIGNED_OUT', null);
  await Promise.resolve();

  expect(useAuthStore.getState().status).toBe('signedOut');
  expect(librarySession.stop).toHaveBeenCalled();
  expect(useSyncStore.getState()).toMatchObject({ status: 'idle', pendingCount: 0 });
  expect(SQLite.deleteDatabaseAsync).not.toHaveBeenCalled();
  expect(coverService.deleteLocalCovers).not.toHaveBeenCalled();
  expect(avatarService.deleteLocalAvatars).not.toHaveBeenCalled();
  unbind();
});
