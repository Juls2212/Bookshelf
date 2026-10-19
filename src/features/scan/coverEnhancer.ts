// "Mejorar portada": straightens the cover from its 4 corners and evens out its contrast and
// brightness, offscreen with Skia. Works from a downscaled copy of the original (max 2000 px) to
// keep memory low; draws the cover through a subdivided textured mesh (reliable on Android,
// unlike perspective matrices); applies automatic levels computed from a small sampled
// histogram; encodes a JPEG (max 1200 px high) into the cache. 10 s timeout and cancel. Any
// failure is reported, and the caller keeps the plain crop. Image data is never logged.
import {
  AlphaType,
  BlendMode,
  ColorType,
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  TileMode,
  VertexMode,
  type SkCanvas,
  type SkPaint,
} from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { palettes } from '@/design/tokens';
import type { LocalImage } from '@/features/library/coverService';

import {
  computeAutoLevels,
  IDENTITY_LEVELS,
  levelsColorMatrix,
  luminanceHistogram,
  straightenedSize,
  toPixels,
  warpMesh,
  type Levels,
  type Quad,
} from './coverGeometry';

export const ENHANCE_TIMEOUT_MS = 10_000;
const WORKING_MAX_SIDE = 2000;
const ENHANCED_MAX_HEIGHT = 1200;
export const ENHANCED_JPEG_QUALITY = 85;
/** Width of the tiny render used for the histogram. */
const HISTOGRAM_WIDTH = 64;

type EnhanceErrorCode = 'timeout' | 'cancelled' | 'failed';

/** Typed failure; `message` is the English code (never image data). */
export class EnhanceError extends Error {
  readonly code: EnhanceErrorCode;

  constructor(code: EnhanceErrorCode) {
    super(code);
    this.name = 'EnhanceError';
    this.code = code;
  }
}

export type EnhanceOptions = { signal?: AbortSignal };

export interface CoverEnhancer {
  /** `corners`: normalized (0..1) in the image as decoded. Resolves with the improved cover. */
  enhance(image: LocalImage, corners: Quad, options?: EnhanceOptions): Promise<LocalImage>;
}

type Deps = {
  /** Downscaled, upright working copy of the photo (max 2000 px long side). */
  prepareWorkingCopy?: (image: LocalImage) => Promise<LocalImage>;
  readBytes?: (uri: string) => Promise<Uint8Array>;
  writeJpeg?: (bytes: Uint8Array) => string;
  removeFile?: (uri: string) => void;
  timeoutMs?: number;
};

/** Resize target keeping the aspect ratio, or null when already small enough. */
export function workingResizeFor(
  width: number,
  height: number,
): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= WORKING_MAX_SIDE) return null;
  return width >= height ? { width: WORKING_MAX_SIDE } : { height: WORKING_MAX_SIDE };
}

async function deviceWorkingCopy(image: LocalImage): Promise<LocalImage> {
  // The manipulator applies the photo's orientation, like the identification copy the corners
  // were found on, so normalized corners match this copy.
  const context = ImageManipulator.manipulate(image.uri);
  const decoded = await context.renderAsync();
  const resize = workingResizeFor(decoded.width, decoded.height);
  const working = resize ? ImageManipulator.manipulate(decoded).resize(resize) : null;
  const rendered = working ? await working.renderAsync() : decoded;
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

async function deviceReadBytes(uri: string): Promise<Uint8Array> {
  return new Uint8Array(await new File(uri).arrayBuffer());
}

function deviceWriteJpeg(bytes: Uint8Array): string {
  const file = new File(Paths.cache, `cover-enhanced-${Date.now()}.jpg`);
  file.create({ overwrite: true });
  file.write(bytes);
  return file.uri;
}

function deviceRemoveFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}

type Disposable = { dispose?: () => void } | null | undefined;
const disposeAll = (items: Disposable[]) => {
  for (const item of items) {
    try {
      item?.dispose?.();
    } catch {
      // Best effort: native memory is released by the GC anyway.
    }
  }
};

/** Levels from a tiny render of the straightened cover (RGBA pixels). */
function sampleLevels(
  draw: (canvas: SkCanvas) => void,
  size: { width: number; height: number },
): Levels {
  const width = HISTOGRAM_WIDTH;
  const height = Math.max(1, Math.round((size.height / size.width) * width));
  const surface = Skia.Surface.Make(width, height);
  if (!surface) return { ...IDENTITY_LEVELS };
  let snapshot: Disposable = null;
  try {
    const canvas = surface.getCanvas();
    canvas.scale(width / size.width, height / size.height);
    draw(canvas);
    surface.flush();
    const image = surface.makeImageSnapshot();
    snapshot = image;
    const pixels = image.readPixels(0, 0, {
      width,
      height,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    });
    if (!pixels || pixels instanceof Float32Array) return { ...IDENTITY_LEVELS };
    return computeAutoLevels(luminanceHistogram(pixels));
  } finally {
    disposeAll([snapshot, surface]);
  }
}

/** Lets the JS thread paint a frame (spinner, cancel button) between heavy Skia steps. */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Skia part: decode, warp, levels, encode. Each step is synchronous; the function yields
 * between them and stops early once `cancelled()` is true. Throws on any failure.
 */
async function renderEnhancedCover(
  bytes: Uint8Array,
  corners: Quad,
  cancelled: () => boolean,
): Promise<Uint8Array> {
  const step = async () => {
    await yieldToUi();
    if (cancelled()) throw new EnhanceError('cancelled');
  };
  const data = Skia.Data.fromBytes(bytes);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new EnhanceError('failed');
  const disposables: Disposable[] = [image, data];
  try {
    const quadPx = toPixels(corners, image.width(), image.height());
    const size = straightenedSize(quadPx, ENHANCED_MAX_HEIGHT);
    const mesh = warpMesh(quadPx, size);
    if (!mesh) throw new EnhanceError('failed');
    const vertices = Skia.MakeVertices(
      VertexMode.Triangles,
      mesh.positions,
      mesh.textures,
      undefined,
      mesh.indices,
    );
    const shader = image.makeShaderOptions(
      TileMode.Clamp,
      TileMode.Clamp,
      FilterMode.Linear,
      MipmapMode.None,
    );
    disposables.push(vertices, shader);
    const plain = Skia.Paint();
    plain.setShader(shader);
    disposables.push(plain);
    const drawWith = (paint: SkPaint) => (canvas: SkCanvas) =>
      canvas.drawVertices(vertices, BlendMode.Modulate, paint);

    await step();
    const levels = sampleLevels(drawWith(plain), size);

    await step();
    const surface = Skia.Surface.Make(size.width, size.height);
    if (!surface) throw new EnhanceError('failed');
    disposables.push(surface);
    const paint = Skia.Paint();
    paint.setShader(shader);
    const filter = Skia.ColorFilter.MakeMatrix(levelsColorMatrix(levels));
    paint.setColorFilter(filter);
    disposables.push(paint, filter);
    const canvas = surface.getCanvas();
    canvas.drawColor(Skia.Color(palettes.light.background));
    drawWith(paint)(canvas);
    surface.flush();
    const result = surface.makeImageSnapshot();
    disposables.push(result);
    await step();
    const jpeg = result.encodeToBytes(ImageFormat.JPEG, ENHANCED_JPEG_QUALITY);
    if (!jpeg || jpeg.length === 0) throw new EnhanceError('failed');
    return jpeg;
  } finally {
    disposeAll(disposables);
  }
}

export function createCoverEnhancer({
  prepareWorkingCopy = deviceWorkingCopy,
  readBytes = deviceReadBytes,
  writeJpeg = deviceWriteJpeg,
  removeFile = deviceRemoveFile,
  timeoutMs = ENHANCE_TIMEOUT_MS,
}: Deps = {}): CoverEnhancer {
  return {
    enhance(image, corners, { signal } = {}) {
      if (signal?.aborted) return Promise.reject(new EnhanceError('cancelled'));
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const work = async (): Promise<LocalImage> => {
        const working = await prepareWorkingCopy(image);
        try {
          if (settled || signal?.aborted) throw new EnhanceError('cancelled');
          const bytes = await readBytes(working.uri);
          if (settled || signal?.aborted) throw new EnhanceError('cancelled');
          const jpeg = await renderEnhancedCover(
            bytes,
            corners,
            () => settled || Boolean(signal?.aborted),
          );
          const uri = writeJpeg(jpeg);
          // Finished too late (timeout or cancel): nobody will use this file.
          if (settled) {
            removeFile(uri);
            throw new EnhanceError('cancelled');
          }
          const size = straightenedSize(
            toPixels(corners, working.width, working.height),
            ENHANCED_MAX_HEIGHT,
          );
          return { uri, width: size.width, height: size.height, source: image.source };
        } finally {
          if (working.uri !== image.uri) removeFile(working.uri);
        }
      };

      return new Promise<LocalImage>((resolve, reject) => {
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          fn();
        };
        const onAbort = () => finish(() => reject(new EnhanceError('cancelled')));
        signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => finish(() => reject(new EnhanceError('timeout'))), timeoutMs);
        work().then(
          (result) => finish(() => resolve(result)),
          (error) =>
            finish(() =>
              reject(error instanceof EnhanceError ? error : new EnhanceError('failed')),
            ),
        );
      });
    },
  };
}

export const coverEnhancer: CoverEnhancer = createCoverEnhancer();
