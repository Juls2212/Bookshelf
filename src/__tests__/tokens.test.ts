import { contrastRatio } from '@/design/contrast';
import { palettes, type ColorScheme, type ColorToken } from '@/design/tokens';

const MIN_CONTRAST = 4.5;

/** Text colors used on the app's surfaces (cards, sheets, fields, paper). */
const TEXT_TOKENS: ColorToken[] = [
  'textPrimary',
  'textSecondary',
  'textMuted',
  'accentText',
  'danger',
  'success',
  'warning',
];
const SURFACES: ColorToken[] = [
  'background',
  'surface',
  'surfaceElevated',
  'field',
  'paperSheet',
  'tabBar',
];

// Disabled controls (disabledText on disabledSurface) are exempt from WCAG 1.4.3.
const pairs: [foreground: ColorToken, background: ColorToken][] = [
  ...TEXT_TOKENS.flatMap((fg) => SURFACES.map((bg) => [fg, bg] as [ColorToken, ColorToken])),
  ['actionPrimaryText', 'actionPrimary'],
  ['tagStrongText', 'tagStrong'],
  ['onHighlight', 'highlight'],
  ['danger', 'dangerSoft'],
  ['textPrimary', 'dangerSoft'],
];

/** Librarian panels: always dark (SchemeOverride), text drawn on featureSurface. */
const FEATURE_TEXT: ColorToken[] = [
  'textPrimary',
  'textSecondary',
  'textMuted',
  'accentText',
  'highlight',
  'success',
  'warning',
];

describe('design tokens', () => {
  it('exposes identical keys in light and dark palettes', () => {
    expect(Object.keys(palettes.dark).sort()).toEqual(Object.keys(palettes.light).sort());
  });

  it('uses #RRGGBB values only', () => {
    for (const palette of Object.values(palettes)) {
      for (const value of Object.values(palette)) expect(value).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe('contrastRatio', () => {
  it('matches known WCAG references', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
  });

  const cases = (Object.keys(palettes) as ColorScheme[]).flatMap((scheme) =>
    pairs.map(([fg, bg]) => [scheme, fg, bg] as const),
  );

  it.each(cases)('%s: %s on %s is at least 4.5:1', (scheme, fg, bg) => {
    const palette = palettes[scheme];
    expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it.each(FEATURE_TEXT)('dark: %s on featureSurface is at least 4.5:1', (fg) => {
    const { dark } = palettes;
    expect(contrastRatio(dark[fg], dark.featureSurface)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});
