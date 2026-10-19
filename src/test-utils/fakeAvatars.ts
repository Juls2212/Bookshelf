// In-memory stand-in for the avatars bucket and the local photo folder, for sync tests.
import { avatarPathFor } from '@/features/profile/avatarPath';

/** `stored`: remote objects by path (content = the local URI that was uploaded). */
export function fakeAvatars() {
  const stored = new Map<string, string>();
  const localFiles = new Set<string>();
  let downloads = 0;
  const service = {
    upload: jest.fn(async (userId: string, localUri: string) => {
      const path = avatarPathFor(userId);
      stored.set(path, localUri);
      return { ok: true as const, data: path };
    }),
    remove: jest.fn(async (userId: string) => {
      stored.delete(avatarPathFor(userId));
      return { ok: true as const, data: null };
    }),
    downloadToLocal: jest.fn(async (userId: string, path: string) => {
      if (!stored.has(path)) return { ok: false as const, error: 'not_found' as const };
      downloads += 1;
      const uri = `file:///documents/avatars/${userId}/avatar_download_${downloads}.jpg`;
      localFiles.add(uri);
      return { ok: true as const, data: uri };
    }),
    removeLocal: jest.fn((uri: string) => {
      localFiles.delete(uri);
    }),
    pruneLocal: jest.fn((_userId: string, keepUri: string | null) => {
      for (const uri of [...localFiles]) if (uri !== keepUri) localFiles.delete(uri);
    }),
  };
  return { service, stored, localFiles };
}
