// Pure math of "Mejorar portada" (no Skia here): corner ordering and validation, the homography
// that straightens the cover, default corners, and the automatic levels (contrast/brightness).
import type { CropRect } from '@/features/library/coverCrop';

export type Point = { x: number; y: number };
/** Top-left, top-right, bottom-right, bottom-left (image coordinates: y grows downwards). */
export type Quad = [Point, Point, Point, Point];
/** Row-major 3x3 matrix with h[8] = 1. */
type Homography = number[];

/** Smallest cover quadrilateral, as a fraction of the image area. */
const MIN_QUAD_AREA = 0.05;
/** Without any hint from the AI: the whole image, 5 % in from every edge. */
const DEFAULT_INSET = 0.05;
/**
 * Width / height of a BookCover (1 / its COVER_ASPECT of 1.42; a test keeps them equal). Kept
 * here so this pure module does not import a component.
 */
export const COVER_WIDTH_RATIO = 1 / 1.42;

// ---------------------------------------------------------------------------
// Quadrilaterals
// ---------------------------------------------------------------------------

function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Strictly convex: every turn has the same sign and none is (almost) straight. */
function isConvexQuad(points: readonly Point[]): boolean {
  if (points.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const c = points[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (current !== sign) return false;
  }
  return true;
}

/** Clockwise on screen around the centroid, starting with the top-left (smallest x + y). */
export function orderCorners(points: readonly Point[]): Quad {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  let start = 0;
  for (let i = 1; i < 4; i += 1) {
    if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  }
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]) as Quad;
}

const inside01 = (p: Point) =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

/** Normalized corners the app can use: inside the image, convex, big enough. */
export function isValidQuad(quad: readonly Point[] | null | undefined, minArea = MIN_QUAD_AREA) {
  return (
    !!quad &&
    quad.length === 4 &&
    quad.every(inside01) &&
    isConvexQuad(quad) &&
    polygonArea(quad) >= minArea
  );
}

export function insetCorners(inset = DEFAULT_INSET): Quad {
  return [
    { x: inset, y: inset },
    { x: 1 - inset, y: inset },
    { x: 1 - inset, y: 1 - inset },
    { x: inset, y: 1 - inset },
  ];
}

function cornersFromBox(box: CropRect): Quad {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
}

/** The AI's corners when valid; else the corners of its box; else the image inset by 5 %. */
export function defaultCorners({
  coverCorners,
  coverBox,
}: {
  coverCorners?: readonly Point[] | null;
  coverBox?: CropRect | null;
} = {}): Quad {
  if (coverCorners?.length === 4) {
    // Ordered first: a valid shape may arrive in any order.
    const ordered = orderCorners(coverCorners);
    if (isValidQuad(ordered)) return ordered;
  }
  if (coverBox) {
    const fromBox = cornersFromBox(coverBox);
    if (isValidQuad(fromBox)) return fromBox;
  }
  return insetCorners();
}

/**
 * Moves one corner (corner editor). The result must stay inside the image, convex and big
 * enough; otherwise the previous corners are kept.
 */
export function moveCorner(quad: Quad, index: number, to: Point): Quad {
  const clamped = { x: Math.min(1, Math.max(0, to.x)), y: Math.min(1, Math.max(0, to.y)) };
  const next = quad.map((p, i) => (i === index ? clamped : p)) as Quad;
  return isValidQuad(next) ? next : quad;
}

export const toPixels = (quad: Quad, width: number, height: number): Quad =>
  quad.map((p) => ({ x: p.x * width, y: p.y * height })) as Quad;

// ---------------------------------------------------------------------------
// Homography
// ---------------------------------------------------------------------------

/**
 * Solves A·x = b (n x n) by Gaussian elimination with partial pivoting. Null when the system
 * is singular (degenerate points).
 */
function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      for (let k = col; k <= n; k += 1) m[row][k] -= factor * m[col][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** The projective map sending each `src[i]` to `dst[i]` (8x8 linear system), or null. */
export function solveHomography(src: readonly Point[], dst: readonly Point[]): Homography | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(a, b);
  return h && h.every(Number.isFinite) ? [...h, 1] : null;
}

export function mapPoint(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Size of the straightened cover: as tall as the cover's longer side edge (in pixels of the
 * source), with the BookCover proportions, at most `maxHeight` high.
 */
export function straightenedSize(
  quadPx: Quad,
  maxHeight: number,
  widthRatio = COVER_WIDTH_RATIO,
): { width: number; height: number } {
  const [tl, tr, br, bl] = quadPx;
  const height = Math.min(maxHeight, Math.max(distance(tl, bl), distance(tr, br)));
  const rounded = Math.max(1, Math.round(height));
  return { width: Math.max(1, Math.round(rounded * widthRatio)), height: rounded };
}

/**
 * A grid over the destination rectangle with, for each vertex, where it comes from in the
 * source photo (inverse homography). Drawing the triangles with the photo as texture
 * straightens the cover; a fine grid makes the piecewise-linear result match the perspective.
 */
export function warpMesh(
  quadPx: Quad,
  size: { width: number; height: number },
  segments = 16,
): { positions: Point[]; textures: Point[]; indices: number[] } | null {
  const dst: Quad = [
    { x: 0, y: 0 },
    { x: size.width, y: 0 },
    { x: size.width, y: size.height },
    { x: 0, y: size.height },
  ];
  const toSource = solveHomography(dst, quadPx);
  if (!toSource) return null;
  const positions: Point[] = [];
  const textures: Point[] = [];
  for (let row = 0; row <= segments; row += 1) {
    for (let col = 0; col <= segments; col += 1) {
      const p = { x: (col / segments) * size.width, y: (row / segments) * size.height };
      positions.push(p);
      textures.push(mapPoint(toSource, p));
    }
  }
  const indices: number[] = [];
  const stride = segments + 1;
  for (let row = 0; row < segments; row += 1) {
    for (let col = 0; col < segments; col += 1) {
      const i = row * stride + col;
      indices.push(i, i + 1, i + stride, i + 1, i + stride + 1, i + stride);
    }
  }
  return { positions, textures, indices };
}

// ---------------------------------------------------------------------------
// Automatic levels
// ---------------------------------------------------------------------------

export type Levels = {
  /** Multiplies every channel (>= 1: only stretches, never flattens). */
  scale: number;
  /** Added after the scale, in 0..255 units. */
  offset: number;
  /** 1 = unchanged; mild boost, luminance-preserving (keeps the hue). */
  saturation: number;
};

export const IDENTITY_LEVELS: Levels = { scale: 1, offset: 0, saturation: 1 };

/** A stretch smaller than this is not worth touching a good photo. */
const MIN_USEFUL_SCALE = 1.05;
/** The stretch never multiplies by more than this (mild, never harsh). */
const MAX_SCALE = 1.6;
const SATURATION_BOOST = 1.08;
/** Below this luminance range the photo is (nearly) flat: stretching would only add noise. */
const MIN_RANGE = 12;

/** Luminance histogram (256 bins) of RGBA pixels, sampling every `step`-th pixel. */
export function luminanceHistogram(rgba: ArrayLike<number>, step = 1): number[] {
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i + 3 < rgba.length; i += 4 * Math.max(1, step)) {
    const lum = Math.round(0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]);
    histogram[Math.min(255, Math.max(0, lum))] += 1;
  }
  return histogram;
}

function percentile(histogram: readonly number[], total: number, fraction: number): number {
  const target = total * fraction;
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen > target) return value;
  }
  return histogram.length - 1;
}

/**
 * Stretches the luminance between the 1st and 99th percentile (the contrast boost, capped at
 * 1.6x so it stays mild) plus a mild saturation boost. When the cap applies, the result is
 * centered (which also corrects the brightness of a dark or washed-out photo). The 1st
 * percentile never goes below 0 and the 99th never above 255: highlights are not blown out.
 * The same scale and offset apply to R, G and B, and saturation preserves luminance, so the
 * hue does not change. A (nearly) flat or empty histogram returns the identity.
 */
export function computeAutoLevels(histogram: readonly number[]): Levels {
  const total = histogram.reduce((sum, n) => sum + n, 0);
  if (total === 0) return { ...IDENTITY_LEVELS };
  const low = percentile(histogram, total, 0.01);
  const high = percentile(histogram, total, 0.99);
  const range = high - low;
  if (range < MIN_RANGE) return { ...IDENTITY_LEVELS };
  const scale = Math.min(MAX_SCALE, 255 / range);
  if (scale < MIN_USEFUL_SCALE) {
    // Already (almost) uses the whole range: only the gentle saturation boost.
    return { scale: 1, offset: 0, saturation: SATURATION_BOOST };
  }
  const margin = (255 - range * scale) / 2;
  return {
    scale: Math.round(scale * 1000) / 1000,
    offset: Math.round((margin - low * scale) * 100) / 100,
    saturation: SATURATION_BOOST,
  };
}

/** Where a 0..255 value ends up (for checks and tests). */
export function applyLevels(value: number, levels: Levels): number {
  return Math.min(255, Math.max(0, value * levels.scale + levels.offset));
}

/**
 * 4x5 row-major color matrix (RGBA, translation in 0..1 as Skia expects): levels first, then
 * a luminance-preserving saturation.
 */
export function levelsColorMatrix({ scale, offset, saturation: s }: Levels): number[] {
  const lum = [0.2126, 0.7152, 0.0722];
  const t = offset / 255;
  const row = (channel: number) => [
    ...lum.map((weight, i) => scale * ((1 - s) * weight + (i === channel ? s : 0))),
    0,
    t,
  ];
  return [...row(0), ...row(1), ...row(2), 0, 0, 0, 1, 0];
}
