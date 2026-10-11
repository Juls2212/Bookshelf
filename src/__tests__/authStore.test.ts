import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

import * as authService from '@/features/auth/authService';
import { resetAuthStore, useAuthStore } from '@/stores/authStore';

jest.mock('@/features/auth/authService', () => ({
  restoreSession: jest.fn(),
  onAuthStateChange: jest.fn(),
  signOut: jest.fn(),
}));

const service = authService as jest.Mocked<typeof authService>;

type Listener = (event: AuthChangeEvent, session: Session | null) => void;
let emit: Listener = () => {};
const unsubscribe = jest.fn();

const session = (id: string) =>
  ({ access_token: 'a', refresh_token: 'r', user: { id } }) as unknown as Session;

beforeEach(() => {
  // Reset first: it unsubscribes the previous test's listener.
  resetAuthStore();
  jest.clearAllMocks();
  service.onAuthStateChange.mockImplementation((listener) => {
    emit = listener;
    return unsubscribe;
  });
});

describe('authStore', () => {
  it('starts loading and becomes signedOut without a stored session', async () => {
    expect(useAuthStore.getState().status).toBe('loading');
    service.restoreSession.mockResolvedValue({ session: null });
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedOut',
      session: null,
      user: null,
    });
  });

  it('becomes signedIn with a stored session (also offline)', async () => {
    const stored = session('user-1');
    service.restoreSession.mockResolvedValue({ session: stored });
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedIn',
      session: stored,
      user: { id: 'user-1' },
    });
  });

  it('initializes only once', async () => {
    service.restoreSession.mockResolvedValue({ session: null });
    await Promise.all([useAuthStore.getState().initialize(), useAuthStore.getState().initialize()]);
    expect(service.restoreSession).toHaveBeenCalledTimes(1);
    expect(service.onAuthStateChange).toHaveBeenCalledTimes(1);
  });

  it('follows sign-in, token refresh and sign-out events', async () => {
    service.restoreSession.mockResolvedValue({ session: null });
    await useAuthStore.getState().initialize();

    emit('SIGNED_IN', session('user-2'));
    expect(useAuthStore.getState().status).toBe('signedIn');

    const refreshed = session('user-2');
    emit('TOKEN_REFRESHED', refreshed);
    expect(useAuthStore.getState().session).toBe(refreshed);

    emit('SIGNED_OUT', null);
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedOut', session: null });
  });

  it('stays signed in when an event arrives without a session (offline refresh failure)', async () => {
    const stored = session('user-3');
    service.restoreSession.mockResolvedValue({ session: stored });
    await useAuthStore.getState().initialize();

    emit('INITIAL_SESSION', null);
    emit('TOKEN_REFRESHED', null);
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', session: stored });
  });

  it('signs out through the service', async () => {
    service.restoreSession.mockResolvedValue({ session: session('user-4') });
    await useAuthStore.getState().initialize();

    service.signOut.mockResolvedValue({ ok: false, error: 'unknown' });
    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState().status).toBe('signedIn');

    service.signOut.mockResolvedValue({ ok: true, data: null });
    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState().status).toBe('signedOut');
  });

  it('unsubscribes on reset', async () => {
    service.restoreSession.mockResolvedValue({ session: null });
    await useAuthStore.getState().initialize();
    resetAuthStore();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe('loading');
  });
});
