// Supabase auth storage adapter over expo-secure-store.
// SecureStore values should stay under ~2 KB, but a Supabase session (JWTs + user) is larger,
// so each value is split into UTF-8 chunks of at most CHUNK_MAX_BYTES:
//   `${key}.count` -> number of chunks, `${key}.0`, `${key}.1`, ... -> chunk contents.
// Values are session secrets: never log them.
import * as SecureStore from 'expo-secure-store';

export const CHUNK_MAX_BYTES = 1800;

const OPTIONS: SecureStore.SecureStoreOptions = {
  // Readable after the first unlock so background token refresh keeps working.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** SecureStore keys may only contain alphanumerics, ".", "-" and "_". */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

const countKey = (key: string) => `${safeKey(key)}.count`;
const chunkKey = (key: string, index: number) => `${safeKey(key)}.${index}`;

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** Splits on code point boundaries so no chunk exceeds `maxBytes` in UTF-8. */
export function splitIntoChunks(value: string, maxBytes = CHUNK_MAX_BYTES): string[] {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of value) {
    const size = utf8Length(char.codePointAt(0) ?? 0);
    if (bytes + size > maxBytes) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  if (current.length > 0 || chunks.length === 0) chunks.push(current);
  return chunks;
}

async function readCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key), OPTIONS);
  const count = raw === null ? 0 : Number(raw);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

async function deleteChunks(key: string, from: number, to: number): Promise<void> {
  for (let i = from; i < to; i += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS);
  }
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await readCount(key);
    if (count === 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i), OPTIONS);
      // A missing chunk means a corrupted value: treat as no stored session.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const previous = await readCount(key);
    const chunks = splitIntoChunks(value);
    for (let i = 0; i < chunks.length; i += 1) {
      await SecureStore.setItemAsync(chunkKey(key, i), chunks[i], OPTIONS);
    }
    await SecureStore.setItemAsync(countKey(key), String(chunks.length), OPTIONS);
    await deleteChunks(key, chunks.length, previous);
  },

  async removeItem(key: string): Promise<void> {
    const count = await readCount(key);
    await deleteChunks(key, 0, count);
    await SecureStore.deleteItemAsync(countKey(key), OPTIONS);
  },
};
