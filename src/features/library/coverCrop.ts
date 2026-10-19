// Pure geometry of cover crops: the default crop of a scanned photo, crop -> pixels of the
// original image, and the crop editor's move/resize rules (aspect locked, kept inside the photo).

/** Rectangle as fractions (0..1) of the image; x and y are the top-left corner. */
export type CropRect = { x: number; y: number; width: number; height: number };

export type Size = { width: number; height: number };

/** Rectangle in pixels (or display points); x and y are the top-left corner. */
export type Rect = { x: number; y: number; width: number; height: number };

/** Crop in pixels of the decoded image, as expo-image-manipulator expects it. */
type PixelCrop = { originX: number; originY: number; width: number; height: number };

export type CropCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

/** Safety margin added on each side of the box the identifier found. */
const COVER_BOX_MARGIN = 0.02;
/** Smallest plausible cover box (fraction of the image, both sides). */
const COVER_BOX_MIN_SIZE = 0.1;
/** Without a usable box: a centered crop of 80 % of the image. */
export const FALLBACK_CROP: CropRect = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
/** The editor's frame never gets smaller than 30 % of the largest frame that fits. */
const CROP_MIN_FRACTION = 0.3;

const EPSILON = 1e-6;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** The identifier's box is used only when it is a sane rectangle inside the image. */
export function isPlausibleCoverBox(box: unknown): box is CropRect {
  if (typeof box !== 'object' || box === null) return false;
  const { x, y, width, height } = box as Record<string, unknown>;
  if (![x, y, width, height].every(isFiniteNumber)) return false;
  const b = box as CropRect;
  return (
    b.x >= 0 &&
    b.y >= 0 &&
    b.width >= COVER_BOX_MIN_SIZE &&
    b.height >= COVER_BOX_MIN_SIZE &&
    b.x + b.width <= 1 + EPSILON &&
    b.y + b.height <= 1 + EPSILON
  );
}

/** The box plus a 2 % margin per side (clamped to the image), or the centered 80 % crop. */
export function defaultCoverCrop(box: CropRect | null | undefined): CropRect {
  if (!isPlausibleCoverBox(box)) return { ...FALLBACK_CROP };
  const left = clamp(box.x - COVER_BOX_MARGIN, 0, 1);
  const top = clamp(box.y - COVER_BOX_MARGIN, 0, 1);
  const right = clamp(box.x + box.width + COVER_BOX_MARGIN, 0, 1);
  const bottom = clamp(box.y + box.height + COVER_BOX_MARGIN, 0, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The crop in pixels of the image as decoded (orientation already applied), whole pixels and
 * always inside the image and at least 1 px.
 */
export function cropToPixels(crop: CropRect, image: Size): PixelCrop {
  const originX = clamp(Math.round(crop.x * image.width), 0, image.width - 1);
  const originY = clamp(Math.round(crop.y * image.height), 0, image.height - 1);
  const width = clamp(Math.round(crop.width * image.width), 1, image.width - originX);
  const height = clamp(Math.round(crop.height * image.height), 1, image.height - originY);
  return { originX, originY, width, height };
}

// ---------------------------------------------------------------------------
// Crop editor (display points of the photo as shown on screen)
// ---------------------------------------------------------------------------

export function toDisplayRect(crop: CropRect, frame: Size): Rect {
  return {
    x: crop.x * frame.width,
    y: crop.y * frame.height,
    width: crop.width * frame.width,
    height: crop.height * frame.height,
  };
}

export function toCropRect(rect: Rect, frame: Size): CropRect {
  const x = clamp(rect.x / frame.width, 0, 1);
  const y = clamp(rect.y / frame.height, 0, 1);
  return {
    x,
    y,
    width: clamp(rect.width / frame.width, 0, 1 - x),
    height: clamp(rect.height / frame.height, 0, 1 - y),
  };
}

/** Size that shows a whole image of `image` proportions inside `area` (contain). */
export function containSize(image: Size, area: Size): Size {
  const scale = Math.min(area.width / image.width, area.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

/** Largest frame width with this aspect (width / height) that fits in `bounds`. */
function maxWidthFor(bounds: Size, aspect: number): number {
  return Math.min(bounds.width, bounds.height * aspect);
}

/** Smallest frame width allowed by the editor. */
export function minFrameWidth(bounds: Size, aspect: number): number {
  return maxWidthFor(bounds, aspect) * CROP_MIN_FRACTION;
}

/** Keeps a frame of the given size inside `bounds`, moving it as little as possible. */
function placeInside(x: number, y: number, width: number, height: number, bounds: Size): Rect {
  return {
    x: clamp(x, 0, bounds.width - width),
    y: clamp(y, 0, bounds.height - height),
    width,
    height,
  };
}

/** Frame of `width` (height from the aspect) centered on (cx, cy), kept inside `bounds`. */
function centeredFrame(cx: number, cy: number, width: number, bounds: Size, aspect: number): Rect {
  const w = clamp(width, minFrameWidth(bounds, aspect), maxWidthFor(bounds, aspect));
  const h = w / aspect;
  return placeInside(cx - w / 2, cy - h / 2, w, h, bounds);
}

/**
 * The editor's starting frame: same center and height as `rect` (the book's height decides the
 * crop), with the locked aspect, within the size limits and inside `bounds`.
 */
export function fitToAspect(rect: Rect, bounds: Size, aspect: number): Rect {
  return centeredFrame(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
    rect.height * aspect,
    bounds,
    aspect,
  );
}

/** Drags the whole frame; it stops at the edges of the photo. */
export function moveRect(start: Rect, dx: number, dy: number, bounds: Size): Rect {
  return placeInside(start.x + dx, start.y + dy, start.width, start.height, bounds);
}

/**
 * Drags one corner while the opposite corner stays put. The aspect stays locked, the frame
 * stays inside `bounds` and never gets smaller than the minimum.
 */
export function resizeFromCorner(
  start: Rect,
  corner: CropCorner,
  dx: number,
  dy: number,
  bounds: Size,
  aspect: number,
): Rect {
  const right = corner === 'topRight' || corner === 'bottomRight';
  const bottom = corner === 'bottomLeft' || corner === 'bottomRight';
  const anchorX = right ? start.x : start.x + start.width;
  const anchorY = bottom ? start.y : start.y + start.height;
  // Both finger directions count: the width they suggest is averaged.
  const fromX = start.width + (right ? dx : -dx);
  const fromY = (start.height + (bottom ? dy : -dy)) * aspect;
  const room = Math.min(
    right ? bounds.width - anchorX : anchorX,
    (bottom ? bounds.height - anchorY : anchorY) * aspect,
  );
  const width = clamp((fromX + fromY) / 2, Math.min(minFrameWidth(bounds, aspect), room), room);
  const height = width / aspect;
  return {
    x: right ? anchorX : anchorX - width,
    y: bottom ? anchorY : anchorY - height,
    width,
    height,
  };
}

/** Grows (factor > 1) or shrinks the frame around its center (screen reader actions). */
export function scaleRect(rect: Rect, factor: number, bounds: Size, aspect: number): Rect {
  return centeredFrame(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
    rect.width * factor,
    bounds,
    aspect,
  );
}
