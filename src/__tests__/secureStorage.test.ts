import * as SecureStore from 'expo-secure-store';

import { CHUNK_MAX_BYTES, secureStorage, splitIntoChunks } from '@/lib/secureStorage';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK: 0,
    __store: store,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe('splitIntoChunks', () => {
  it('keeps every chunk under the byte limit, including multi-byte characters', () => {
    const value = 'ñ€😀a'.repeat(1000);
    const chunks = splitIntoChunks(value);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(value);
    for (const chunk of chunks) expect(utf8Bytes(chunk)).toBeLessThanOrEqual(CHUNK_MAX_BYTES);
  });

  it('returns a single chunk for short and empty values', () => {
    expect(splitIntoChunks('abc')).toEqual(['abc']);
    expect(splitIntoChunks('')).toEqual(['']);
  });
});

describe('secureStorage', () => {
  // Similar in size to a real Supabase session (two JWTs + user JSON).
  const bigValue = JSON.stringify({ access_token: 'x'.repeat(3000), user: { name: 'Peñafiel' } });

  it('round-trips a value larger than one chunk', async () => {
    await secureStorage.setItem('sb-auth', bigValue);
    expect(Number(store.get('sb-auth.count'))).toBeGreaterThan(1);
    for (const [key, value] of store) {
      if (key !== 'sb-auth.count') expect(utf8Bytes(value)).toBeLessThanOrEqual(CHUNK_MAX_BYTES);
    }
    await expect(secureStorage.getItem('sb-auth')).resolves.toBe(bigValue);
  });

  it('returns null when nothing is stored or a chunk is missing', async () => {
    await expect(secureStorage.getItem('missing')).resolves.toBeNull();
    await secureStorage.setItem('sb-auth', bigValue);
    store.delete('sb-auth.1');
    await expect(secureStorage.getItem('sb-auth')).resolves.toBeNull();
  });

  it('removes stale chunks when a value shrinks', async () => {
    await secureStorage.setItem('sb-auth', bigValue);
    await secureStorage.setItem('sb-auth', 'small');
    expect([...store.keys()].sort()).toEqual(['sb-auth.0', 'sb-auth.count']);
    await expect(secureStorage.getItem('sb-auth')).resolves.toBe('small');
  });

  it('cleans up every chunk on removal', async () => {
    await secureStorage.setItem('sb-auth', bigValue);
    await secureStorage.removeItem('sb-auth');
    expect(store.size).toBe(0);
  });

  it('sanitizes keys to the characters SecureStore accepts', async () => {
    await secureStorage.setItem('sb:auth/token', 'v');
    expect(store.has('sb_auth_token.count')).toBe(true);
    await expect(secureStorage.getItem('sb:auth/token')).resolves.toBe('v');
  });
});
