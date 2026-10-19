import * as authService from '@/features/auth/authService';
import { secureStorage } from '@/lib/secureStorage';
import { getSupabaseClient } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  AUTH_STORAGE_KEY: 'bookshelf.auth',
  getSupabaseClient: jest.fn(),
}));

jest.mock('@/lib/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const auth = {
  getSession: jest.fn(),
  signUp: jest.fn(),
  signInWithPassword: jest.fn(),
  signOut: jest.fn(),
  resetPasswordForEmail: jest.fn(),
};
const storage = secureStorage as jest.Mocked<typeof secureStorage>;

const storedSession = {
  access_token: 'expired-access',
  refresh_token: 'refresh',
  user: { id: 'user-1' },
};
const networkError = { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' };

beforeEach(() => {
  jest.clearAllMocks();
  (getSupabaseClient as jest.Mock).mockReturnValue({ auth });
});

describe('restoreSession (offline rule)', () => {
  it('returns the live session when available', async () => {
    auth.getSession.mockResolvedValue({ data: { session: storedSession }, error: null });
    await expect(authService.restoreSession()).resolves.toEqual({ session: storedSession });
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it('falls back to the stored session when the refresh fails for lack of network', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: networkError });
    storage.getItem.mockResolvedValue(JSON.stringify(storedSession));
    await expect(authService.restoreSession()).resolves.toEqual({ session: storedSession });
    expect(storage.getItem).toHaveBeenCalledWith('bookshelf.auth');
  });

  it('falls back to the stored session when the network hangs', async () => {
    jest.useFakeTimers();
    auth.getSession.mockReturnValue(new Promise(() => {}));
    storage.getItem.mockResolvedValue(JSON.stringify(storedSession));
    const pending = authService.restoreSession(1000);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ session: storedSession });
    jest.useRealTimers();
  });

  it('signs out (null) when the server rejects the session', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' },
    });
    await expect(authService.restoreSession()).resolves.toEqual({ session: null });
  });

  it('ignores corrupted stored data', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: networkError });
    storage.getItem.mockResolvedValue('{not json');
    await expect(authService.restoreSession()).resolves.toEqual({ session: null });
  });
});

describe('auth actions', () => {
  it('signUp sends display_name metadata and reports whether a session was created', async () => {
    auth.signUp.mockResolvedValue({
      data: { user: { identities: [{}] }, session: { access_token: 'a' } },
      error: null,
    });
    const result = await authService.signUp({
      displayName: '  Ana  ',
      email: ' ana@example.com ',
      password: 'secret-123',
    });
    expect(result).toEqual({ ok: true, data: { sessionCreated: true } });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'ana@example.com',
      password: 'secret-123',
      options: { data: { display_name: 'Ana' } },
    });
  });

  it('signUp lowercases the email, keeps the password as typed and cleans the name', async () => {
    auth.signUp.mockResolvedValue({
      data: { user: { identities: [{}] }, session: null },
      error: null,
    });
    const result = await authService.signUp({
      displayName: ' Ana \u0007   María\n',
      email: ' Ana@Example.COM ',
      password: '  keep my spaces  ',
    });
    // No session (Confirm email still on): the UI asks the user to confirm and sign in.
    expect(result).toEqual({ ok: true, data: { sessionCreated: false } });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'ana@example.com',
      password: '  keep my spaces  ',
      options: { data: { display_name: 'Ana María' } },
    });
  });

  it('signUp reports email_taken for an obfuscated existing user', async () => {
    auth.signUp.mockResolvedValue({
      data: { user: { identities: [] }, session: null },
      error: null,
    });
    await expect(
      authService.signUp({ displayName: 'Ana', email: 'a@b.co', password: 'secret-123' }),
    ).resolves.toEqual({ ok: false, error: 'email_taken' });
  });

  it('signIn maps errors to codes instead of throwing', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { name: 'AuthApiError', status: 400, code: 'invalid_credentials' },
    });
    await expect(authService.signIn({ email: 'a@b.co', password: 'x' })).resolves.toEqual({
      ok: false,
      error: 'invalid_credentials',
    });
    auth.signInWithPassword.mockRejectedValue(new TypeError('Network request failed'));
    await expect(authService.signIn({ email: 'a@b.co', password: 'x' })).resolves.toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('signOut removes the local session when offline', async () => {
    auth.signOut.mockResolvedValue({ error: networkError });
    await expect(authService.signOut()).resolves.toEqual({ ok: true, data: null });
    expect(storage.removeItem).toHaveBeenCalledWith('bookshelf.auth');
  });

  it('requestPasswordReset trims the email', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await expect(authService.requestPasswordReset(' a@b.co ')).resolves.toEqual({
      ok: true,
      data: null,
    });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co');
  });
});
