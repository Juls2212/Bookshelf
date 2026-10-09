import { checkSupabaseHealth } from '@/lib/supabaseHealth';

const ORIGINAL_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const TEST_URL = 'https://example.supabase.co';
const TEST_KEY = 'test-publishable-key';

function response(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

// Mutates process.env in place: babel-preset-expo rewrites `process.env.EXPO_PUBLIC_*`
// to a module holding the original object, so reassigning process.env has no effect.
function setEnv(url?: string, key?: string) {
  if (url === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = url;
  if (key === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  else process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
}

beforeEach(() => {
  setEnv(TEST_URL, TEST_KEY);
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  setEnv(ORIGINAL_URL, ORIGINAL_KEY);
});

describe('checkSupabaseHealth', () => {
  it('returns ok and calls the settings endpoint with the apikey header', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(200));
    await expect(checkSupabaseHealth(fetchMock)).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${TEST_URL}/auth/v1/settings`,
      expect.objectContaining({ method: 'GET', headers: { apikey: TEST_KEY } }),
    );
  });

  it('maps 401 to unauthorized', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(401));
    await expect(checkSupabaseHealth(fetchMock)).resolves.toEqual({
      status: 'error',
      code: 'unauthorized',
    });
  });

  it('maps other statuses to unexpected_status', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(500));
    await expect(checkSupabaseHealth(fetchMock)).resolves.toEqual({
      status: 'error',
      code: 'unexpected_status',
    });
  });

  it('returns timeout when the request is aborted after timeoutMs', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = checkSupabaseHealth(fetchMock, 1000);
    jest.advanceTimersByTime(1000);
    await expect(pending).resolves.toEqual({ status: 'error', code: 'timeout' });
  });

  it('returns network_error when fetch rejects', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(checkSupabaseHealth(fetchMock)).resolves.toEqual({
      status: 'error',
      code: 'network_error',
    });
  });

  it('returns missing_env without calling fetch', async () => {
    setEnv();
    const fetchMock = jest.fn();
    await expect(checkSupabaseHealth(fetchMock)).resolves.toEqual({
      status: 'error',
      code: 'missing_env',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
