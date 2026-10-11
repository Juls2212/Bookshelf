// Book covers: pick from the gallery, prepare (resize + JPEG), upload to the private bucket,
// remove, and resolve short-lived signed URLs with an in-memory cache.
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';
import { BOOK_COVERS_BUCKET } from '@/types/database';

import type { BookErrorCode } from './bookRepository';
import { mapBookError } from './supabaseBookRepository';

export const COVER_MAX_HEIGHT = 1200;
export const COVER_JPEG_QUALITY = 0.8;
export const COVER_ASPECT: [number, number] = [3, 4];
export const SIGNED_URL_TTL_SECONDS = 60 * 60;
/** Refresh cached URLs a bit before they expire. */
const EXPIRY_MARGIN_MS = 60 * 1000;

export type CoverErrorCode = 'cancelled' | BookErrorCode;
export type CoverResult<T> = { ok: true; data: T } | { ok: false; error: CoverErrorCode };

export type LocalImage = { uri: string; width: number; height: number };

export function coverPathFor(userId: string, bookId: string): string {
  return `${userId}/${bookId}.jpg`;
}

/** Target size for the resize step, or null when the image is already small enough. */
export function coverResizeFor(height: number): { height: number } | null {
  return height > COVER_MAX_HEIGHT ? { height: COVER_MAX_HEIGHT } : null;
}

type Deps = {
  getClient?: () => AppSupabaseClient;
  now?: () => number;
  /** Reads a local file as bytes for upload. */
  readFile?: (uri: string) => Promise<ArrayBuffer>;
};

/**
 * expo-file-system's File API reads local file:// URIs reliably on Android and iOS
 * (and in Expo Go). `fetch(uri).arrayBuffer()` can return empty bytes on Android, which
 * uploaded 0-byte covers that rendered as blank blocks.
 */
export function readLocalFile(uri: string): Promise<ArrayBuffer> {
  return new File(uri).arrayBuffer();
}

/** Logs only an error code (never paths, URLs, tokens or book data). */
function warnCode(operation: string, code: string): void {
  console.warn(`[covers] ${operation} failed: ${code}`);
}

export function createCoverService({
  getClient = getSupabaseClient,
  now = () => Date.now(),
  readFile = readLocalFile,
}: Deps = {}) {
  const cache = new Map<string, { url: string; expiresAt: number }>();
  const bucket = () => getClient().storage.from(BOOK_COVERS_BUCKET);

  return {
    /** Single image from the gallery, cropped to 3:4 by the system editor. */
    async pickFromGallery(): Promise<CoverResult<LocalImage>> {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: COVER_ASPECT,
          allowsMultipleSelection: false,
          quality: 1,
        });
        const asset = result.canceled ? undefined : result.assets[0];
        if (!asset) return { ok: false, error: 'cancelled' };
        return { ok: true, data: { uri: asset.uri, width: asset.width, height: asset.height } };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },

    /** Resizes to at most 1200 px high and re-encodes as JPEG (quality 0.8). */
    async prepare(image: LocalImage): Promise<CoverResult<LocalImage>> {
      try {
        const context = ImageManipulator.manipulate(image.uri);
        const resize = coverResizeFor(image.height);
        if (resize) context.resize(resize);
        const rendered = await context.renderAsync();
        const saved = await rendered.saveAsync({
          format: SaveFormat.JPEG,
          compress: COVER_JPEG_QUALITY,
        });
        return { ok: true, data: { uri: saved.uri, width: saved.width, height: saved.height } };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },

    /** Uploads (or replaces) the prepared cover and returns its storage path. */
    async upload(userId: string, bookId: string, localUri: string): Promise<CoverResult<string>> {
      const path = coverPathFor(userId, bookId);
      try {
        const body = await readFile(localUri);
        // Never upload an empty file: it would be saved as a broken cover.
        if (body.byteLength === 0) {
          warnCode('upload', 'empty_file');
          return { ok: false, error: 'unknown' };
        }
        const { error } = await bucket().upload(path, body, {
          contentType: 'image/jpeg',
          upsert: true,
        });
        if (error) {
          const code = mapBookError(error);
          warnCode('upload', code);
          return { ok: false, error: code };
        }
        cache.delete(path);
        // Verify what the server stored. A reported size of 0 means a broken upload.
        const info = await bucket().info(path);
        if (!info.error && info.data.size === 0) {
          warnCode('upload', 'empty_object');
          await bucket()
            .remove([path])
            .catch(() => undefined);
          return { ok: false, error: 'unknown' };
        }
        return { ok: true, data: path };
      } catch (error) {
        const code = mapBookError(error);
        warnCode('upload', code);
        return { ok: false, error: code };
      }
    },

    async remove(path: string): Promise<CoverResult<null>> {
      try {
        const { error } = await bucket().remove([path]);
        if (error) return { ok: false, error: mapBookError(error) };
        cache.delete(path);
        return { ok: true, data: null };
      } catch (error) {
        return { ok: false, error: mapBookError(error) };
      }
    },

    /**
     * Signed URLs (1 h) for many paths with a single request for the ones not cached.
     * Paths that fail are left out of the result.
     */
    async getSignedUrls(paths: string[]): Promise<CoverResult<Record<string, string>>> {
      const result: Record<string, string> = {};
      const missing: string[] = [];
      const current = now();
      for (const path of new Set(paths)) {
        const cached = cache.get(path);
        if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > current) result[path] = cached.url;
        else missing.push(path);
      }
      if (missing.length === 0) return { ok: true, data: result };
      try {
        const { data, error } = await bucket().createSignedUrls(missing, SIGNED_URL_TTL_SECONDS);
        if (error) {
          const code = mapBookError(error);
          warnCode('signed URLs', code);
          return { ok: false, error: code };
        }
        const expiresAt = current + SIGNED_URL_TTL_SECONDS * 1000;
        let failed = 0;
        for (const item of data) {
          if (item.path && item.signedUrl && !item.error) {
            cache.set(item.path, { url: item.signedUrl, expiresAt });
            result[item.path] = item.signedUrl;
          } else {
            // Not cached, so the next request retries it.
            failed += 1;
          }
        }
        if (failed > 0) warnCode('signed URLs', `${failed} of ${missing.length} not signed`);
        return { ok: true, data: result };
      } catch (error) {
        const code = mapBookError(error);
        warnCode('signed URLs', code);
        return { ok: false, error: code };
      }
    },

    /** Drops every cached URL (e.g. on sign-out). */
    clearCache(): void {
      cache.clear();
    },
  };
}

export type CoverService = ReturnType<typeof createCoverService>;

export const coverService: CoverService = createCoverService();
