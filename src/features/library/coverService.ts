// Book covers: pick from the gallery, prepare (crop + resize + JPEG), upload to the private
// bucket, remove, and resolve short-lived signed URLs with an in-memory cache.
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';
import { BOOK_COVERS_BUCKET, type CoverSource } from '@/types/database';

import type { BookErrorCode } from './bookRepository';
import { cropToPixels, type CropRect, type Size } from './coverCrop';
import { mapBookError } from './supabaseBookGateway';

export const COVER_MAX_HEIGHT = 1200;
export const COVER_JPEG_QUALITY = 0.8;
const COVER_ASPECT: [number, number] = [3, 4];
/** Preview of a crop in the form (not saved). */
export const CROP_PREVIEW_MAX_HEIGHT = 480;
export const SIGNED_URL_TTL_SECONDS = 60 * 60;
/** Refresh cached URLs a bit before they expire. */
const EXPIRY_MARGIN_MS = 60 * 1000;

type CoverErrorCode = 'cancelled' | 'camera_denied' | BookErrorCode;
/** `cause` carries the raw failure for the sync engine's retry classification (never logged). */
type CoverResult<T> = { ok: true; data: T } | { ok: false; error: CoverErrorCode; cause?: unknown };

/**
 * `source`: where the image came from (saved as the cover source; gallery when absent).
 * `crop`: the part of the image kept as the cover (fractions of the image as decoded, so the
 * orientation is already applied); absent or null keeps the whole image.
 */
export type LocalImage = {
  uri: string;
  width: number;
  height: number;
  source?: CoverSource;
  crop?: CropRect | null;
};

export function coverPathFor(userId: string, bookId: string): string {
  return `${userId}/${bookId}.jpg`;
}

/** Saved local cover: the file on this device and the planned remote storage path. */
type LocalCover = { localUri: string; path: string };

/** Local file system used for cover copies (injected in tests). */
type CoverFiles = {
  /**
   * Copies `sourceUri` to a new unique file documents/covers/{userId}/{bookId}_{stamp}.jpg and
   * returns its URI. A new cover never reuses the previous file name, so image caches keyed by
   * the URI can never serve the old picture.
   */
  save(sourceUri: string, userId: string, bookId: string): Promise<string>;
  remove(uri: string): void;
  /** Downloads `url` to documents/covers/{userId}/{bookId}.jpg; returns the local URI. */
  download(url: string, userId: string, bookId: string): Promise<string>;
  /** Deletes documents/covers/{userId} (every local cover of that user). */
  removeUserCovers(userId: string): void;
};

const coverFile = (userId: string, bookId: string, name = `${bookId}.jpg`) => {
  const dir = new Directory(Paths.document, 'covers', userId);
  dir.create({ intermediates: true, idempotent: true });
  return new File(dir, name);
};

const deviceCoverFiles: CoverFiles = {
  async save(sourceUri, userId, bookId) {
    const destination = coverFile(userId, bookId, `${bookId}_${Date.now().toString(36)}.jpg`);
    await new File(sourceUri).copy(destination, { overwrite: true });
    if (!destination.exists || !destination.size) throw new Error('empty_local_cover');
    return destination.uri;
  },
  remove(uri) {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
  async download(url, userId, bookId) {
    const file = await File.downloadFileAsync(url, coverFile(userId, bookId), { idempotent: true });
    if (!file.exists || !file.size) throw new Error('empty_download');
    return file.uri;
  },
  removeUserCovers(userId) {
    const dir = new Directory(Paths.document, 'covers', userId);
    if (dir.exists) dir.delete();
  },
};

/** Target size for the resize step, or null when the image is already small enough. */
export function coverResizeFor(
  height: number,
  maxHeight: number = COVER_MAX_HEIGHT,
): { height: number } | null {
  return height > maxHeight ? { height: maxHeight } : null;
}

/**
 * Renders `image` (cropped when it has a crop) at most `maxHeight` high as JPEG. The crop is
 * computed on the decoded original at full resolution: its real size (orientation applied) is
 * measured first, the same way the identification copy was made, so the box matches the photo.
 */
async function renderImage(
  image: LocalImage,
  maxHeight: number,
  compress: number,
): Promise<LocalImage> {
  let context = ImageManipulator.manipulate(image.uri);
  let height = image.height;
  if (image.crop) {
    const original = await context.renderAsync();
    const crop = cropToPixels(image.crop, { width: original.width, height: original.height });
    context = ImageManipulator.manipulate(original).crop(crop);
    height = crop.height;
  }
  const resize = coverResizeFor(height, maxHeight);
  if (resize) context.resize(resize);
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

type Deps = {
  getClient?: () => AppSupabaseClient;
  now?: () => number;
  /** Reads a local file as bytes for upload. */
  readFile?: (uri: string) => Promise<ArrayBuffer>;
  files?: CoverFiles;
};

/**
 * expo-file-system's File API reads local file:// URIs reliably on Android and iOS
 * (and in Expo Go). `fetch(uri).arrayBuffer()` can return empty bytes on Android, which
 * uploaded 0-byte covers that rendered as blank blocks.
 */
function readLocalFile(uri: string): Promise<ArrayBuffer> {
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
  files = deviceCoverFiles,
}: Deps = {}) {
  const cache = new Map<string, { url: string; expiresAt: number }>();
  const bucket = () => getClient().storage.from(BOOK_COVERS_BUCKET);

  const service = {
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

    /** A photo taken with the system camera (the app's crop editor follows when needed). */
    async takePhoto(): Promise<CoverResult<LocalImage>> {
      try {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) return { ok: false, error: 'camera_denied' };
        const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
        const asset = result.canceled ? undefined : result.assets[0];
        if (!asset) return { ok: false, error: 'cancelled' };
        return {
          ok: true,
          data: { uri: asset.uri, width: asset.width, height: asset.height, source: 'camera' },
        };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },

    /**
     * Applies the crop (if any) to the original image, resizes to at most 1200 px high and
     * re-encodes as JPEG (quality 0.8).
     */
    async prepare(image: LocalImage): Promise<CoverResult<LocalImage>> {
      try {
        return { ok: true, data: await renderImage(image, COVER_MAX_HEIGHT, COVER_JPEG_QUALITY) };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },

    /** Small temporary copy of the cropped cover for the form preview (cache, never saved). */
    async renderPreview(image: LocalImage): Promise<CoverResult<LocalImage>> {
      try {
        return {
          ok: true,
          data: await renderImage(image, CROP_PREVIEW_MAX_HEIGHT, COVER_JPEG_QUALITY),
        };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },

    /** Size of the image as decoded (orientation applied), as the crop editor shows it. */
    async measure(uri: string): Promise<CoverResult<Size>> {
      try {
        const decoded = await ImageManipulator.manipulate(uri).renderAsync();
        return { ok: true, data: { width: decoded.width, height: decoded.height } };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },

    /**
     * Keeps the prepared cover on this device and returns its local URI plus the remote path it
     * will be uploaded to by the sync engine. Nothing is uploaded here.
     */
    async saveLocal(
      userId: string,
      bookId: string,
      preparedUri: string,
    ): Promise<CoverResult<LocalCover>> {
      try {
        const localUri = await files.save(preparedUri, userId, bookId);
        return { ok: true, data: { localUri, path: coverPathFor(userId, bookId) } };
      } catch {
        warnCode('save local', 'file_error');
        return { ok: false, error: 'unknown' };
      }
    },

    /** Best-effort removal of a local cover copy. */
    removeLocal(localUri: string): void {
      try {
        files.remove(localUri);
      } catch {
        // Already gone.
      }
    },

    /** Uploads (or replaces) the prepared cover and returns its storage path. */
    async upload(userId: string, bookId: string, localUri: string): Promise<CoverResult<string>> {
      const path = coverPathFor(userId, bookId);
      try {
        let body: ArrayBuffer;
        try {
          body = await readFile(localUri);
        } catch {
          warnCode('upload', 'missing_file');
          return { ok: false, error: 'unknown', cause: { code: 'missing_file' } };
        }
        // Never upload an empty file: it would be saved as a broken cover.
        if (body.byteLength === 0) {
          warnCode('upload', 'empty_file');
          return { ok: false, error: 'unknown', cause: { code: 'empty_file' } };
        }
        const { error } = await bucket().upload(path, body, {
          contentType: 'image/jpeg',
          upsert: true,
        });
        if (error) {
          const code = mapBookError(error);
          warnCode('upload', code);
          return { ok: false, error: code, cause: error };
        }
        cache.delete(path);
        // Verify what the server stored. A reported size of 0 means a broken upload.
        const info = await bucket().info(path);
        if (!info.error && info.data.size === 0) {
          warnCode('upload', 'empty_object');
          await bucket()
            .remove([path])
            .catch(() => undefined);
          return { ok: false, error: 'unknown', cause: { code: 'empty_object' } };
        }
        return { ok: true, data: path };
      } catch (error) {
        const code = mapBookError(error);
        warnCode('upload', code);
        return { ok: false, error: code, cause: error };
      }
    },

    /**
     * Downloads a remote cover into this device's cover folder (offline cache) and returns the
     * local URI. Uses a short-lived signed URL; failures are reported, never thrown.
     */
    async downloadToLocal(
      userId: string,
      bookId: string,
      path: string,
    ): Promise<CoverResult<string>> {
      const signed = await service.getSignedUrls([path]);
      if (!signed.ok) return signed;
      const url = signed.data[path];
      if (!url) return { ok: false, error: 'not_found' };
      try {
        return { ok: true, data: await files.download(url, userId, bookId) };
      } catch (error) {
        warnCode('download', 'file_error');
        return { ok: false, error: 'unknown', cause: error };
      }
    },

    /** Removes this user's local cover copies (sign-out with nothing left to sync). */
    deleteLocalCovers(userId: string): boolean {
      try {
        files.removeUserCovers(userId);
        return true;
      } catch {
        warnCode('delete local', 'file_error');
        return false;
      }
    },

    async remove(path: string): Promise<CoverResult<null>> {
      try {
        const { error } = await bucket().remove([path]);
        if (error) return { ok: false, error: mapBookError(error), cause: error };
        cache.delete(path);
        return { ok: true, data: null };
      } catch (error) {
        return { ok: false, error: mapBookError(error), cause: error };
      }
    },

    /** Forgets the cached signed URL of a cover that no longer exists. */
    forgetSignedUrl(path: string): void {
      cache.delete(path);
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
  return service;
}

export type CoverService = ReturnType<typeof createCoverService>;

export const coverService: CoverService = createCoverService();
