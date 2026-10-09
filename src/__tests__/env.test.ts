import { EnvConfigError, getEnv } from '@/lib/env';

const TEST_URL = 'https://example.supabase.co';
const TEST_KEY = 'test-publishable-key';
const ORIGINAL_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Mutates process.env in place: babel-preset-expo rewrites `process.env.EXPO_PUBLIC_*`
// to a module holding the original object, so reassigning process.env has no effect.
function setEnv(url?: string, key?: string) {
  if (url === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = url;
  if (key === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  else process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
}

afterAll(() => {
  setEnv(ORIGINAL_URL, ORIGINAL_KEY);
});

describe('getEnv', () => {
  it('throws EnvConfigError listing both names when variables are missing', () => {
    setEnv();
    expect(() => getEnv()).toThrow(EnvConfigError);
    try {
      getEnv();
    } catch (error) {
      expect((error as EnvConfigError).variables).toEqual([
        'EXPO_PUBLIC_SUPABASE_URL',
        'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      ]);
    }
  });

  it('rejects a non-https URL without leaking values', () => {
    setEnv('http://example.supabase.co', TEST_KEY);
    expect.assertions(4);
    try {
      getEnv();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvConfigError);
      const message = (error as Error).message;
      expect(message).toContain('EXPO_PUBLIC_SUPABASE_URL');
      expect(message).not.toContain('example.supabase.co');
      expect(message).not.toContain(TEST_KEY);
    }
  });

  it('rejects an empty key', () => {
    setEnv(TEST_URL, '   ');
    expect(() => getEnv()).toThrow(EnvConfigError);
  });

  it('returns the values when valid', () => {
    setEnv(`${TEST_URL}/`, TEST_KEY);
    expect(getEnv()).toEqual({ supabaseUrl: TEST_URL, supabasePublishableKey: TEST_KEY });
  });
});
