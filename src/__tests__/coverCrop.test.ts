// Pure geometry of cover crops: default crop, pixels of the original, crop editor rules.
import {
  containSize,
  cropToPixels,
  defaultCoverCrop,
  FALLBACK_CROP,
  fitToAspect,
  isPlausibleCoverBox,
  minFrameWidth,
  moveRect,
  resizeFromCorner,
  scaleRect,
  toCropRect,
  toDisplayRect,
  type Rect,
} from '@/features/library/coverCrop';

/** BookCover proportions (width / height). */
const ASPECT = 1 / 1.42;
const BOUNDS = { width: 300, height: 400 };

const expectInside = (rect: Rect, bounds = BOUNDS) => {
  expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
  expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
  expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.width + 1e-9);
  expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.height + 1e-9);
};
const expectAspect = (rect: Rect) => expect(rect.width / rect.height).toBeCloseTo(ASPECT, 6);

describe('default crop', () => {
  it('adds a 2 % margin per side to a valid box', () => {
    const crop = defaultCoverCrop({ x: 0.3, y: 0.2, width: 0.4, height: 0.5 });
    expect(crop.x).toBeCloseTo(0.28);
    expect(crop.y).toBeCloseTo(0.18);
    expect(crop.width).toBeCloseTo(0.44);
    expect(crop.height).toBeCloseTo(0.54);
  });

  it('clamps the margin at the edges of the image', () => {
    const crop = defaultCoverCrop({ x: 0.01, y: 0, width: 0.98, height: 1 });
    expect(crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    const corner = defaultCoverCrop({ x: 0.6, y: 0.7, width: 0.4, height: 0.3 });
    expect(corner.x).toBeCloseTo(0.58);
    expect(corner.y).toBeCloseTo(0.68);
    expect(corner.x + corner.width).toBeCloseTo(1);
    expect(corner.y + corner.height).toBeCloseTo(1);
  });

  it('falls back to a centered 80 % crop without a usable box', () => {
    expect(defaultCoverCrop(null)).toEqual(FALLBACK_CROP);
    expect(defaultCoverCrop(undefined)).toEqual({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    // Implausible: too small, outside the image, not numbers.
    expect(defaultCoverCrop({ x: 0.1, y: 0.1, width: 0.05, height: 0.5 })).toEqual(FALLBACK_CROP);
    expect(defaultCoverCrop({ x: 0.7, y: 0, width: 0.5, height: 0.5 })).toEqual(FALLBACK_CROP);
    expect(defaultCoverCrop({ x: -0.1, y: 0, width: 0.5, height: 0.5 })).toEqual(FALLBACK_CROP);
    expect(defaultCoverCrop({ x: Number.NaN, y: 0, width: 0.5, height: 0.5 } as never)).toEqual(
      FALLBACK_CROP,
    );
  });

  it('only accepts boxes that are sane rectangles inside the image', () => {
    expect(isPlausibleCoverBox({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isPlausibleCoverBox({ x: 0, y: 0, width: 0.1, height: 0.1 })).toBe(true);
    expect(isPlausibleCoverBox({ x: 0, y: 0, width: 1 })).toBe(false);
    expect(isPlausibleCoverBox('box')).toBe(false);
    expect(isPlausibleCoverBox(null)).toBe(false);
  });
});

describe('crop in pixels of the original image', () => {
  it('uses the decoded size of the original, not the small identification copy', () => {
    const crop = { x: 0.2, y: 0.1, width: 0.6, height: 0.8 };
    expect(cropToPixels(crop, { width: 3024, height: 4032 })).toEqual({
      originX: 605,
      originY: 403,
      width: 1814,
      height: 3226,
    });
    // The same crop on a 768 x 1024 copy would be much smaller.
    expect(cropToPixels(crop, { width: 768, height: 1024 }).width).toBe(461);
  });

  it('stays inside the image and is at least 1 px', () => {
    const image = { width: 1000, height: 800 };
    const edge = cropToPixels({ x: 0.9, y: 0.95, width: 0.2, height: 0.2 }, image);
    expect(edge.originX + edge.width).toBeLessThanOrEqual(1000);
    expect(edge.originY + edge.height).toBeLessThanOrEqual(800);
    expect(cropToPixels({ x: 1, y: 1, width: 0, height: 0 }, image)).toEqual({
      originX: 999,
      originY: 799,
      width: 1,
      height: 1,
    });
  });
});

describe('crop editor', () => {
  it('converts between the crop and the photo shown on screen', () => {
    const frame = { width: 300, height: 400 };
    const crop = { x: 0.1, y: 0.25, width: 0.5, height: 0.5 };
    expect(toDisplayRect(crop, frame)).toEqual({ x: 30, y: 100, width: 150, height: 200 });
    expect(toCropRect(toDisplayRect(crop, frame), frame)).toEqual(crop);
    expect(containSize({ width: 4000, height: 3000 }, { width: 300, height: 500 })).toEqual({
      width: 300,
      height: 225,
    });
  });

  it('starts from the crop reshaped to the cover proportions, centered and inside', () => {
    const start = fitToAspect({ x: 60, y: 40, width: 180, height: 320 }, BOUNDS, ASPECT);
    expectAspect(start);
    expect(start.height).toBeCloseTo(320);
    expect(start.x + start.width / 2).toBeCloseTo(150);
    expectInside(start);
    // The whole photo becomes the largest frame that fits.
    const whole = fitToAspect({ x: 0, y: 0, ...BOUNDS }, BOUNDS, ASPECT);
    expectAspect(whole);
    expect(whole.width).toBeCloseTo(Math.min(300, 400 * ASPECT));
    expectInside(whole);
    // A tiny box grows to the minimum size.
    const tiny = fitToAspect({ x: 0, y: 0, width: 5, height: 5 }, BOUNDS, ASPECT);
    expect(tiny.width).toBeCloseTo(minFrameWidth(BOUNDS, ASPECT));
    expectInside(tiny);
  });

  it('moves the frame but never past the edges', () => {
    const rect = { x: 50, y: 50, width: 100, height: 100 / ASPECT };
    expect(moveRect(rect, 20, -10, BOUNDS)).toMatchObject({ x: 70, y: 40 });
    const pushed = moveRect(rect, 1000, 1000, BOUNDS);
    expect(pushed.x + pushed.width).toBeCloseTo(300);
    expect(pushed.y + pushed.height).toBeCloseTo(400);
    expect(moveRect(rect, -1000, -1000, BOUNDS)).toMatchObject({ x: 0, y: 0 });
  });

  it('resizes from a corner with the aspect locked and the opposite corner fixed', () => {
    const rect = { x: 50, y: 50, width: 100, height: 100 / ASPECT };
    const grown = resizeFromCorner(rect, 'bottomRight', 40, 40, BOUNDS, ASPECT);
    expectAspect(grown);
    expect(grown.x).toBe(50);
    expect(grown.y).toBe(50);
    expect(grown.width).toBeGreaterThan(100);

    const fromTopLeft = resizeFromCorner(rect, 'topLeft', -30, -30, BOUNDS, ASPECT);
    expectAspect(fromTopLeft);
    expect(fromTopLeft.x + fromTopLeft.width).toBeCloseTo(150);
    expect(fromTopLeft.y + fromTopLeft.height).toBeCloseTo(50 + 100 / ASPECT);
    expectInside(fromTopLeft);
  });

  it('never grows past the photo nor shrinks below 30 % of the largest frame', () => {
    const rect = { x: 50, y: 50, width: 100, height: 100 / ASPECT };
    const huge = resizeFromCorner(rect, 'bottomRight', 5000, 5000, BOUNDS, ASPECT);
    expectAspect(huge);
    expectInside(huge);
    const tiny = resizeFromCorner(rect, 'bottomRight', -5000, -5000, BOUNDS, ASPECT);
    expect(tiny.width).toBeCloseTo(minFrameWidth(BOUNDS, ASPECT));
    expect(minFrameWidth(BOUNDS, ASPECT)).toBeCloseTo(0.3 * Math.min(300, 400 * ASPECT));
    for (const corner of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const) {
      const r = resizeFromCorner(rect, corner, 37, -91, BOUNDS, ASPECT);
      expectAspect(r);
      expectInside(r);
    }
  });

  it('grows and shrinks around the center for screen readers', () => {
    const rect = { x: 50, y: 50, width: 100, height: 100 / ASPECT };
    const bigger = scaleRect(rect, 1.1, BOUNDS, ASPECT);
    expect(bigger.width).toBeCloseTo(110);
    expect(bigger.x + bigger.width / 2).toBeCloseTo(100);
    expectAspect(bigger);
    expectInside(scaleRect(rect, 10, BOUNDS, ASPECT));
  });
});
