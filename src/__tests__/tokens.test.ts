import { contrastRatio } from '@/design/contrast';
import { palettes, type ColorScheme, type ColorToken } from '@/design/tokens';

const MIN_CONTRAST = 4.5;

const pairs: [foreground: ColorToken, background: ColorToken][] = [
  ['textPrimary', 'background'],
  ['textSecondary', 'background'],
  ['accentText', 'background'],
  ['actionPrimaryText', 'actionPrimary'],
  ['danger', 'background'],
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
});
