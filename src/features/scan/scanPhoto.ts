// Photos taken for identification. The copy sent to the identifier is small (1024 px on the
// long side, JPEG 0.7) and separate from the cover saved later (1200 px / 0.8 in coverService).
// Every file stays in the app sandbox (cache) and is never logged.
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { LocalImage } from '@/features/library/coverService';

const IDENTIFY_MAX_SIDE = 1024;
const IDENTIFY_JPEG_QUALITY = 0.7;

/** Resize target keeping the aspect ratio, or null when the image is already small enough. */
export function identificationResizeFor(
  width: number,
  height: number,
): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= IDENTIFY_MAX_SIDE) return null;
  return width >= height ? { width: IDENTIFY_MAX_SIDE } : { height: IDENTIFY_MAX_SIDE };
}

/** Writes the identification copy of `image` to the cache. Throws on failure. */
export async function prepareForIdentification(image: LocalImage): Promise<LocalImage> {
  const context = ImageManipulator.manipulate(image.uri);
  const resize = identificationResizeFor(image.width, image.height);
  if (resize) context.resize(resize);
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: IDENTIFY_JPEG_QUALITY,
  });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/** Best-effort removal of a temporary photo. */
export function discardImage(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone, or the cache was cleared by the system.
  }
}
