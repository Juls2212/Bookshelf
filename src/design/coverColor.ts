import { coverPalette, type CoverColor } from './tokens';

// FNV-1a: small, stable string hash so a title always gets the same cover color.
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function coverColorFor(title: string): CoverColor {
  const key = title.trim().toLocaleLowerCase();
  return coverPalette[hashString(key) % coverPalette.length];
}

/** Deterministic height factor (0.88-1) so covers on a shelf look like real books. */
export function coverHeightFactorFor(title: string): number {
  const factors = [1, 0.94, 0.9, 0.97, 0.88];
  return factors[hashString(`h:${title.trim().toLocaleLowerCase()}`) % factors.length];
}
