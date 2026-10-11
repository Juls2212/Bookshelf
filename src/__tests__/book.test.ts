import { contrastRatio } from '@/design/contrast';
import { coverColorFor, coverHeightFactorFor } from '@/design/coverColor';
import { coverPalette } from '@/design/tokens';
import { computeProgressPercent, isLent } from '@/lib/book';

describe('computeProgressPercent', () => {
  it.each([
    [214, 312, 69],
    [0, 312, 0],
    [312, 312, 100],
    [1, 3, 33],
  ])('%p of %p pages is %p%%', (current, total, expected) => {
    expect(computeProgressPercent(current, total)).toBe(expected);
  });

  it.each([
    [null, 312],
    [214, null],
    [undefined, undefined],
    [10, 0],
    [10, -5],
    [Number.NaN, 100],
    [10, Number.POSITIVE_INFINITY],
  ])('returns 0 for unknown or invalid input (%p, %p)', (current, total) => {
    expect(computeProgressPercent(current, total)).toBe(0);
  });

  it('clamps to 0-100', () => {
    expect(computeProgressPercent(500, 312)).toBe(100);
    expect(computeProgressPercent(-20, 312)).toBe(0);
  });
});

describe('isLent', () => {
  it('is true only with a non-empty borrower', () => {
    expect(isLent({ lentTo: 'Ana' })).toBe(true);
    expect(isLent({ lentTo: '   ' })).toBe(false);
    expect(isLent({ lentTo: null })).toBe(false);
  });
});

describe('cover colors', () => {
  it('gives the same color for the same title (ignoring case and spaces)', () => {
    expect(coverColorFor('Los almendros')).toBe(coverColorFor('Los almendros'));
    expect(coverColorFor('  los ALMENDROS ')).toBe(coverColorFor('Los almendros'));
    expect(coverHeightFactorFor('Mapa de sal')).toBe(coverHeightFactorFor('Mapa de sal'));
  });

  it('spreads titles across the palette', () => {
    const titles = Array.from({ length: 40 }, (_, i) => `title-${i}`);
    const used = new Set(titles.map((title) => coverColorFor(title)));
    expect(used.size).toBeGreaterThan(5);
    for (const color of used) expect(coverPalette).toContain(color);
  });

  it('keeps readable text on every cover color', () => {
    for (const { background, text } of coverPalette) {
      expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
