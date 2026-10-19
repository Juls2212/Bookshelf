// Profile photos: take or pick an image, prepare it (square crop, 512x512 JPEG), keep it in
// documents/avatars/{userId}/, upload it to the private avatars bucket, remove it, download it
// on other devices and resolve a short-lived signed URL. Same patterns as coverService.
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { BookErrorCode } from '@/features/library/bookRepository';
import { cropToPixels, type CropRect, type Size } from '@/features/library/coverCrop';
import type { LocalImage } from '@/features/library/coverService';
import { mapBookError } from '@/features/library/supabaseBookGateway';
import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';
import { AVATARS_BUCKET } from '@/types/database';

import { avatarPathFor } from './avatarPath';

/** Side of the saved photo, in pixels. */
export const AVATAR_SIZE = 512;
export const AVATAR_JPEG_QUALITY = 0.8;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
/** Refresh the cached URL a bit before it expires. */
const EXPIRY_MARGIN_MS = 60 * 1000;

type AvatarErrorCode = 'cancelled' | BookErrorCode;
/** `cause` carries the raw failure for the sync engine's retry classification (never logged). */
type AvatarResult<T> =
  { ok: true; data: T } | { ok: false; error: AvatarErrorCode; cause?: unknown };

/** Camera permission for "Tomar foto": `blocked` = only the system settings can change it. */
export type CameraPermission = 'granted' | 'denied' | 'blocked';

/** Square crop in whole pixels of the decoded image (the smaller side wins), centered. */
export function avatarPixelCrop(crop: CropRect, image: Size) {
  const pixels = cropToPixels(crop, image);
  const side = Math.min(pixels.width, pixels.height);
  return {
    originX: pixels.originX + Math.floor((pixels.width - side) / 2),
    originY: pixels.originY + Math.floor((pixels.height - side) / 2),
    width: side,
    height: side,
  };
}

/** Local file system used for the photo copies (injected in tests). */
type AvatarFiles = {
  /** Copies `sourceUri` to documents/avatars/{userId}/avatar_{stamp}.jpg; returns its URI. */
  save(sourceUri: string, userId: string, stamp: number): Promise<string>;
  /** Downloads `url` to documents/avatars/{userId}/avatar_{stamp}.jpg; returns the local URI. */
  download(url: string, userId: string, stamp: number): Promise<string>;
  remove(uri: string): void;
  /** Deletes every photo of the user except `keepUri` (all of them when null). */
  removeOthers(userId: string, keepUri: string | null): void;
  /** Deletes documents/avatars/{userId}. */
  removeUserDir(userId: string): void;
};

const avatarDir = (userId: string) => new Directory(Paths.document, 'avatars', userId);

const avatarFile = (userId: string, stamp: number) => {
  const dir = avatarDir(userId);
  dir.create({ intermediates: true, idempotent: true });
  return new File(dir, `avatar_${stamp}.jpg`);
};

const deviceAvatarFiles: AvatarFiles = {
  async save(sourceUri, userId, stamp) {
    const destination = avatarFile(userId, stamp);
    await new File(sourceUri).copy(destination, { overwrite: true });
    if (!destination.exists || !destination.size) throw new Error('empty_local_avatar');
    return destination.uri;
  },
  async download(url, userId, stamp) {
    const file = await File.downloadFileAsync(url, avatarFile(userId, stamp), { idempotent: true });
    if (!file.exists || !file.size) throw new Error('empty_download');
    return file.uri;
  },
  remove(uri) {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
  removeOthers(userId, keepUri) {
    const dir = avatarDir(userId);
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      if (entry instanceof File && entry.uri !== keepUri) entry.delete();
    }
  },
  removeUserDir(userId) {
    const dir = avatarDir(userId);
    if (dir.exists) dir.delete();
  },
};

/** The system camera and photo picker (injected in tests). */
type AvatarPicker = {
  requestCameraPermission(): Promise<CameraPermission>;
  launchCamera(): Promise<LocalImage | null>;
  launchLibrary(): Promise<LocalImage | null>;
};

const toLocalImage = (result: ImagePicker.ImagePickerResult): LocalImage | null => {
  const asset = result.canceled ? undefined : result.assets[0];
  return asset ? { uri: asset.uri, width: asset.width, height: asset.height } : null;
};

const devicePicker: AvatarPicker = {
  async requestCameraPermission() {
    const response = await ImagePicker.requestCameraPermissionsAsync();
    if (response.granted) return 'granted';
    return response.canAskAgain ? 'denied' : 'blocked';
  },
  // No system editor: the app's own square crop step follows.
  async launchCamera() {
    return toLocalImage(
      await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 }),
    );
  },
  async launchLibrary() {
    return toLocalImage(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
      }),
    );
  },
};

/** expo-file-system reads local file:// URIs reliably (see coverService). */
function readLocalFile(uri: string): Promise<ArrayBuffer> {
  return new File(uri).arrayBuffer();
}

/** Logs only an error code (never paths, URLs or tokens). */
function warnCode(operation: string, code: string): void {
  console.warn(`[avatars] ${operation} failed: ${code}`);
}

type Deps = {
  getClient?: () => AppSupabaseClient;
  now?: () => number;
  readFile?: (uri: string) => Promise<ArrayBuffer>;
  files?: AvatarFiles;
  picker?: AvatarPicker;
};

export function createAvatarService({
  getClient = getSupabaseClient,
  now = () => Date.now(),
  readFile = readLocalFile,
  files = deviceAvatarFiles,
  picker = devicePicker,
}: Deps = {}) {
  let signed: { path: string; url: string; expiresAt: number } | null = null;
  const bucket = () => getClient().storage.from(AVATARS_BUCKET);

  const pick = async (
    launch: () => Promise<LocalImage | null>,
  ): Promise<AvatarResult<LocalImage>> => {
    try {
      const image = await launch();
      return image ? { ok: true, data: image } : { ok: false, error: 'cancelled' };
    } catch {
      return { ok: false, error: 'unknown' };
    }
  };

  const service = {
    async requestCameraPermission(): Promise<CameraPermission> {
      try {
        return await picker.requestCameraPermission();
      } catch {
        return 'denied';
      }
    },

    takePhoto: () => pick(() => picker.launchCamera()),

    pickFromLibrary: () => pick(() => picker.launchLibrary()),

    /**
     * The square crop of the original image (orientation applied), resized to 512x512 and
     * encoded as JPEG (quality 0.8), in the cache directory.
     */
    async prepare(image: LocalImage): Promise<AvatarResult<string>> {
      try {
        const original = await ImageManipulator.manipulate(image.uri).renderAsync();
        const size = { width: original.width, height: original.height };
        const crop = avatarPixelCrop(image.crop ?? { x: 0, y: 0, width: 1, height: 1 }, size);
        const rendered = await ImageManipulator.manipulate(original)
          .crop(crop)
          .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE })
          .renderAsync();
        const saved = await rendered.saveAsync({
          format: SaveFormat.JPEG,
          compress: AVATAR_JPEG_QUALITY,
        });
        return { ok: true, data: saved.uri };
      } catch {
        warnCode('prepare', 'image_error');
        return { ok: false, error: 'unknown' };
      }
    },

    /** Keeps the prepared photo as documents/avatars/{userId}/avatar_{timestamp}.jpg. */
    async saveLocal(userId: string, preparedUri: string): Promise<AvatarResult<string>> {
      try {
        return { ok: true, data: await files.save(preparedUri, userId, now()) };
      } catch {
        warnCode('save local', 'file_error');
        return { ok: false, error: 'unknown' };
      }
    },

    /** Best-effort removal of one local photo file. */
    removeLocal(localUri: string): void {
      try {
        files.remove(localUri);
      } catch {
        // Already gone.
      }
    },

    /** Best-effort: deletes the user's other local photos (old versions). */
    pruneLocal(userId: string, keepUri: string | null): void {
      try {
        files.removeOthers(userId, keepUri);
      } catch {
        warnCode('prune local', 'file_error');
      }
    },

    /** Uploads (or replaces) the photo at {userId}/avatar.jpg and checks it is not empty. */
    async upload(userId: string, localUri: string): Promise<AvatarResult<string>> {
      const path = avatarPathFor(userId);
      try {
        let body: ArrayBuffer;
        try {
          body = await readFile(localUri);
        } catch {
          warnCode('upload', 'missing_file');
          return { ok: false, error: 'unknown', cause: { code: 'missing_file' } };
        }
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
        if (signed?.path === path) signed = null;
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

    /** Deletes the remote photo (removing a missing object also succeeds). */
    async remove(userId: string): Promise<AvatarResult<null>> {
      const path = avatarPathFor(userId);
      try {
        const { error } = await bucket().remove([path]);
        if (error) {
          const code = mapBookError(error);
          warnCode('remove', code);
          return { ok: false, error: code, cause: error };
        }
        if (signed?.path === path) signed = null;
        return { ok: true, data: null };
      } catch (error) {
        const code = mapBookError(error);
        warnCode('remove', code);
        return { ok: false, error: code, cause: error };
      }
    },

    /** Signed URL (1 h) of the remote photo, cached until shortly before it expires. */
    async getSignedUrl(path: string): Promise<AvatarResult<string>> {
      const current = now();
      if (signed && signed.path === path && signed.expiresAt - EXPIRY_MARGIN_MS > current) {
        return { ok: true, data: signed.url };
      }
      try {
        const { data, error } = await bucket().createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        if (error || !data?.signedUrl) {
          const code = mapBookError(error ?? {});
          warnCode('signed URL', code);
          return { ok: false, error: code, cause: error };
        }
        signed = { path, url: data.signedUrl, expiresAt: current + SIGNED_URL_TTL_SECONDS * 1000 };
        return { ok: true, data: data.signedUrl };
      } catch (error) {
        const code = mapBookError(error);
        warnCode('signed URL', code);
        return { ok: false, error: code, cause: error };
      }
    },

    /** Downloads the remote photo into this device's avatar folder; returns the local URI. */
    async downloadToLocal(userId: string, path: string): Promise<AvatarResult<string>> {
      const url = await service.getSignedUrl(path);
      if (!url.ok) return url;
      try {
        return { ok: true, data: await files.download(url.data, userId, now()) };
      } catch (error) {
        warnCode('download', 'file_error');
        return { ok: false, error: 'unknown', cause: error };
      }
    },

    /** Removes the user's local photos (clean sign-out). */
    deleteLocalAvatars(userId: string): boolean {
      try {
        files.removeUserDir(userId);
        return true;
      } catch {
        warnCode('delete local', 'file_error');
        return false;
      }
    },

    /** Drops the cached signed URL (e.g. on sign-out). */
    clearCache(): void {
      signed = null;
    },
  };
  return service;
}

export type AvatarService = ReturnType<typeof createAvatarService>;

export const avatarService: AvatarService = createAvatarService();
