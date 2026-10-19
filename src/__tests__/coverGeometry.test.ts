// "Mejorar portada": pure geometry (homography, corners) and automatic levels.
import { COVER_ASPECT } from '@/components/BookCover';
import {
  applyLevels,
  computeAutoLevels,
  COVER_WIDTH_RATIO,
  defaultCorners,
  IDENTITY_LEVELS,
  insetCorners,
  isValidQuad,
  levelsColorMatrix,
  luminanceHistogram,
  mapPoint,
  moveCorner,
  orderCorners,
  solveHomography,
  straightenedSize,
  warpMesh,
  type Point,
  type Quad,
} from '@/features/scan/coverGeometry';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const unit: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const close = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('homography', () => {
  it('identity maps every point to itself', () => {
    const h = solveHomography(unit, unit)!;
    expect(h).toHaveLength(9);
    close(mapPoint(h, { x: 0.3, y: 0.7 }), { x: 0.3, y: 0.7 });
  });

  it('a scale and translation is exact', () => {
    const dst: Quad = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 220 },
      { x: 10, y: 220 },
    ];
    const h = solveHomography(unit, dst)!;
    close(mapPoint(h, { x: 0.5, y: 0.5 }), { x: 60, y: 120 });
  });

  it('a perspective (tilted cover) maps the 4 corners exactly, and back', () => {
    const tilted: Quad = [
      { x: 120, y: 80 },
      { x: 610, y: 140 },
      { x: 650, y: 900 },
      { x: 90, y: 860 },
    ];
    const rect: Quad = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 710 },
      { x: 0, y: 710 },
    ];
    const forward = solveHomography(tilted, rect)!;
    const back = solveHomography(rect, tilted)!;
    tilted.forEach((p, i) => close(mapPoint(forward, p), rect[i]));
    const inside = { x: 300, y: 400 };
    close(mapPoint(back, mapPoint(forward, inside)), inside);
    // Straight lines stay straight: the middle of the top edge stays on the top edge.
    expect(mapPoint(forward, { x: 365, y: 110 }).y).toBeCloseTo(0, 5);
  });

  it('degenerate input (three points on a line, repeated points) has no solution', () => {
    const collinear = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(solveHomography(collinear, unit)).toBeNull();
    expect(solveHomography([unit[0], unit[0], unit[0], unit[0]], unit)).toBeNull();
    expect(solveHomography(unit.slice(0, 3), unit)).toBeNull();
  });
});

describe('straightening', () => {
  it('uses the BookCover proportions and caps the height', () => {
    expect(COVER_WIDTH_RATIO).toBeCloseTo(1 / COVER_ASPECT, 10);
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 2000 },
      { x: 0, y: 2000 },
    ];
    expect(straightenedSize(quad, 1200)).toEqual({ width: Math.round(1200 / 1.42), height: 1200 });
    expect(straightenedSize(quad, 5000).height).toBe(2000);
  });

  it('the mesh corners sample exactly the cover corners of the photo', () => {
    const quad: Quad = [
      { x: 120, y: 80 },
      { x: 610, y: 140 },
      { x: 650, y: 900 },
      { x: 90, y: 860 },
    ];
    const mesh = warpMesh(quad, { width: 500, height: 710 }, 4)!;
    expect(mesh.positions).toHaveLength(25);
    expect(mesh.indices).toHaveLength(4 * 4 * 6);
    close(mesh.textures[0], quad[0]);
    close(mesh.textures[4], quad[1]);
    close(mesh.textures[24], quad[2]);
    close(mesh.textures[20], quad[3]);
    expect(warpMesh([quad[0], quad[0], quad[0], quad[0]], { width: 10, height: 10 })).toBeNull();
  });
});

describe('corners', () => {
  const tilted: Quad = [
    { x: 0.25, y: 0.1 },
    { x: 0.8, y: 0.15 },
    { x: 0.75, y: 0.9 },
    { x: 0.2, y: 0.85 },
  ];

  it('orders and validates', () => {
    expect(orderCorners([tilted[2], tilted[0], tilted[3], tilted[1]])).toEqual(tilted);
    expect(isValidQuad(tilted)).toBe(true);
    expect(isValidQuad([tilted[0], tilted[2], tilted[1], tilted[3]])).toBe(false);
    expect(isValidQuad(null)).toBe(false);
    expect(isValidQuad(insetCorners(0.45))).toBe(false); // 10 % x 10 % < 5 %... of the image
  });

  it('default corners: the AI corners, else its box, else the image inset by 5 %', () => {
    expect(defaultCorners({ coverCorners: [tilted[3], tilted[1], tilted[0], tilted[2]] })).toEqual(
      tilted,
    );
    const box = { x: 0.2, y: 0.1, width: 0.6, height: 0.8 };
    expect(defaultCorners({ coverCorners: null, coverBox: box })).toEqual([
      { x: 0.2, y: 0.1 },
      { x: 0.8, y: 0.1 },
      { x: 0.8, y: 0.9 },
      { x: 0.2, y: 0.9 },
    ]);
    // Invalid corners fall back to the box; nothing at all to the inset image.
    const concave = [tilted[0], tilted[1], { x: 0.5, y: 0.3 }, tilted[3]];
    expect(defaultCorners({ coverCorners: concave, coverBox: box })[0]).toEqual({ x: 0.2, y: 0.1 });
    expect(defaultCorners()).toEqual(insetCorners(0.05));
    expect(defaultCorners({ coverBox: { x: 0, y: 0, width: 0.1, height: 0.1 } })).toEqual(
      insetCorners(0.05),
    );
  });

  it('moving a corner keeps the shape convex, inside the image and big enough', () => {
    const moved = moveCorner(tilted, 0, { x: 0.3, y: 0.2 });
    expect(moved[0]).toEqual({ x: 0.3, y: 0.2 });
    // Past the opposite side would cross the edges: ignored.
    expect(moveCorner(tilted, 0, { x: 0.9, y: 0.95 })).toBe(tilted);
    // Outside the photo: clamped to its edge.
    expect(moveCorner(tilted, 0, { x: -0.5, y: -0.2 })[0]).toEqual({ x: 0, y: 0 });
    // Collapsing the shape below 5 % of the image: ignored.
    const small: Quad = [
      { x: 0.4, y: 0.4 },
      { x: 0.65, y: 0.4 },
      { x: 0.65, y: 0.65 },
      { x: 0.4, y: 0.65 },
    ];
    expect(moveCorner(small, 2, { x: 0.45, y: 0.45 })).toBe(small);
  });
});

describe('automatic levels', () => {
  const histogramOf = (values: number[]) => {
    const h = new Array<number>(256).fill(0);
    for (const v of values) h[v] += 1;
    return h;
  };
  const spread = (low: number, high: number) =>
    Array.from({ length: 1000 }, (_, i) => Math.round(low + ((high - low) * i) / 999));

  it('an empty or flat image is left as it is', () => {
    expect(computeAutoLevels(new Array(256).fill(0))).toEqual(IDENTITY_LEVELS);
    expect(computeAutoLevels(histogramOf(new Array(500).fill(128)))).toEqual(IDENTITY_LEVELS);
  });

  it('a low-contrast photo is stretched mildly and centered, without clipping', () => {
    const levels = computeAutoLevels(histogramOf(spread(90, 170)));
    expect(levels.scale).toBeGreaterThan(1);
    expect(levels.scale).toBeLessThanOrEqual(1.6);
    expect(applyLevels(90, levels)).toBeGreaterThanOrEqual(0);
    expect(applyLevels(170, levels)).toBeLessThanOrEqual(255);
    // Centered: the middle stays in the middle.
    expect(applyLevels(130, levels)).toBeCloseTo(127.5, 0);
    expect(levels.saturation).toBeGreaterThan(1);
    expect(levels.saturation).toBeLessThanOrEqual(1.1);
  });

  it('a slightly dull photo is stretched to its 1st and 99th percentiles exactly', () => {
    const levels = computeAutoLevels(histogramOf(spread(30, 220)));
    expect(applyLevels(30, levels)).toBeCloseTo(0, 0);
    expect(applyLevels(220, levels)).toBeCloseTo(255, 0);
  });

  it('a photo that already uses the whole range keeps its levels', () => {
    const levels = computeAutoLevels(histogramOf(spread(0, 255)));
    expect(levels.scale).toBe(1);
    expect(levels.offset).toBe(0);
  });

  it('extreme outliers (1 %) do not drive the stretch, and highlights never blow out', () => {
    const values = [...spread(60, 200), ...new Array(5).fill(0), ...new Array(5).fill(255)];
    const levels = computeAutoLevels(histogramOf(values));
    expect(levels.scale).toBeGreaterThan(1);
    expect(applyLevels(200, levels)).toBeLessThanOrEqual(255);
    expect(applyLevels(255, levels)).toBe(255);
    expect(applyLevels(0, levels)).toBe(0);
  });

  it('the color matrix keeps grays gray (no hue change) and applies the levels', () => {
    const identity = levelsColorMatrix(IDENTITY_LEVELS);
    expect(identity).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
    const m = levelsColorMatrix({ scale: 1.5, offset: -30, saturation: 1.08 });
    // A gray pixel (r = g = b) stays gray: every color row sums to the same scale.
    const rowSum = (row: number) => m[row * 5] + m[row * 5 + 1] + m[row * 5 + 2];
    expect(rowSum(0)).toBeCloseTo(1.5, 6);
    expect(rowSum(1)).toBeCloseTo(1.5, 6);
    expect(rowSum(2)).toBeCloseTo(1.5, 6);
    expect(m[4]).toBeCloseTo(-30 / 255, 6);
    expect(m.slice(15)).toEqual([0, 0, 0, 1, 0]);
  });

  it('builds a luminance histogram from RGBA pixels, sampled', () => {
    const pixels = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    const h = luminanceHistogram(pixels);
    expect(h[255]).toBe(1);
    expect(h[0]).toBe(1);
    expect(h[54]).toBe(1); // pure red: 0.2126 * 255
    expect(luminanceHistogram(pixels, 2).reduce((a, b) => a + b, 0)).toBe(2);
  });
});
