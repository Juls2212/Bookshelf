// Design tokens. The ONLY place where raw color values are allowed.
// Source of truth: docs/references mockups (pages 12-13 light, 25-26 dark).

const light = {
  background: '#F4EBDC', // Crema papel
  surface: '#EBDDC6', // Beige calido
  surfaceElevated: '#F9F3E8',
  field: '#EBDDC6',
  border: '#DCC8A6', // Arena
  track: '#DCC8A6',
  textPrimary: '#2A1A12', // Tinta, never pure black
  textSecondary: '#67594F', // textPrimary at ~70% over background
  textMuted: '#76604D',
  accent: '#B7773A', // Caramelo
  accentText: '#8A5224', // Caramelo oscuro
  actionPrimary: '#3B2418', // Espresso
  actionPrimaryText: '#F4EBDC',
  focusBorder: '#B7773A',
  shelf: '#8C5A36', // Madera
  shelfEnd: '#8C5A36',
  danger: '#A8492F', // Terracota
  dangerSoft: '#F8E8DF',
  success: '#466128',
  warning: '#835400',
  highlight: '#E6C887', // Dorado tenue
  onHighlight: '#2A1A12',
  tagStrong: '#3B2418',
  tagStrongText: '#F4EBDC',
  disabledSurface: '#B5A28C',
  disabledText: '#F4EBDC',
  textureDot: '#8C5A36',
  tabBar: '#F4EBDC',
  shadow: '#3B2418',
  featureSurface: '#3B2418',
  featureGlow: '#7A4E26',
  scrim: '#2A1A12',
  switchThumb: '#F4EBDC',
  paperSheet: '#F9F3E8',
} as const;

export type ColorToken = keyof typeof light;
export type Palette = Record<ColorToken, string>;

const dark: Palette = {
  background: '#1F140E', // Fondo noche
  surface: '#2C1D14', // Nogal
  surfaceElevated: '#43301F', // Marron medio
  field: '#36241A', // Cacao
  border: '#4A3426', // Linea
  track: '#5A4130', // Pista
  textPrimary: '#F2E6D0', // Crema marfil
  textSecondary: '#C2AE92', // Beige tostado
  textMuted: '#B8A488', // Taupe claro
  accent: '#D29559',
  accentText: '#DDA468', // Caramelo claro
  actionPrimary: '#D29559', // Caramelo
  actionPrimaryText: '#1F140E',
  focusBorder: '#E6C887',
  shelf: '#5E3E29', // Madera (gradient start)
  shelfEnd: '#46301F', // Madera (gradient end)
  danger: '#E0866A', // Error terracota
  dangerSoft: '#4A2419',
  success: '#A7B583', // Exito oliva
  warning: '#E3B05C', // Alerta ambar
  highlight: '#E6C887', // Dorado tenue
  onHighlight: '#1F140E',
  tagStrong: '#5A4130',
  tagStrongText: '#F2E6D0',
  disabledSurface: '#5A4130',
  disabledText: '#B8A488',
  textureDot: '#E6C887',
  tabBar: '#2C1D14',
  shadow: '#0E0906',
  featureSurface: '#2C1D14',
  featureGlow: '#6B4422',
  scrim: '#0E0906',
  switchThumb: '#F2E6D0',
  paperSheet: '#2C1D14',
};

export const palettes: { light: Palette; dark: Palette } = { light, dark };

export type ColorScheme = keyof typeof palettes;

export const textureDotOpacity = { light: 0.07, dark: 0.05 } as const;

export const scrimOpacity = { light: 0.4, dark: 0.6 } as const;

// Wooden spines behind the recommended book (always-dark warm scene).
export const sceneSpines = [
  '#5E3E29',
  '#4A3426',
  '#6B4429',
  '#3B2418',
  '#7A4E2E',
  '#553823',
] as const;
export const sceneSpineBand = '#C9A060';

export type CoverColor = { background: string; text: string };

// Typographic fallback covers, sampled from the mockup covers. Same in both themes;
// every pair keeps text contrast >= 4.5:1.
export const coverPalette: readonly CoverColor[] = [
  { background: '#4E5F3A', text: '#F4EBDC' }, // olive (Los almendros)
  { background: '#2E4F4A', text: '#F4EBDC' }, // deep teal (Mapa de sal)
  { background: '#A9472F', text: '#F4EBDC' }, // terracotta (Cartas a nadie)
  { background: '#D9A441', text: '#2A1A12' }, // mustard (El invierno de las abejas)
  { background: '#3B2418', text: '#F4EBDC' }, // espresso (Lo que callan los rios)
  { background: '#C98B7E', text: '#2A1A12' }, // dusty rose (Casa de vidrio)
  { background: '#B7773A', text: '#2A1A12' }, // caramel (Ceniza y miel)
  { background: '#E8DCC0', text: '#2A1A12' }, // cream (Tiempo prestado)
  { background: '#6B2A2E', text: '#F4EBDC' }, // burgundy (Noches de tinta)
  { background: '#7E8F6C', text: '#2A1A12' }, // sage (Las horas quietas)
];

// Darker spine strip on the left edge of every cover.
export const coverSpine = { color: '#1F140E', opacity: 0.22 } as const;

export const radii = {
  tag: 4,
  field: 12,
  button: 14,
  surface: 22,
  sheet: 28,
  pill: 999,
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const sizes = {
  shelfHeight: 9,
  tabBarHeight: 64,
  scanButton: 64,
  minTouchTarget: 44,
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
  borderWidth: 1,
} as const;

export const fonts = {
  serif: 'InstrumentSerif_400Regular',
  serifItalic: 'InstrumentSerif_400Regular_Italic',
  sansRegular: 'HankenGrotesk_400Regular',
  sansMedium: 'HankenGrotesk_500Medium',
  sansSemiBold: 'HankenGrotesk_600SemiBold',
  sansBold: 'HankenGrotesk_700Bold',
} as const;

export const typeScale = {
  display: { fontFamily: fonts.serif, fontSize: 40, lineHeight: 44 },
  title: { fontFamily: fonts.serif, fontSize: 30, lineHeight: 34 },
  heading: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 26 },
  body: { fontFamily: fonts.sansRegular, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: fonts.sansSemiBold, fontSize: 11, lineHeight: 14, letterSpacing: 1.6 },
  caption: { fontFamily: fonts.sansRegular, fontSize: 13, lineHeight: 18 },
  italicNote: { fontFamily: fonts.serifItalic, fontSize: 18, lineHeight: 24 },
  button: { fontFamily: fonts.sansSemiBold, fontSize: 15, lineHeight: 20 },
  tag: { fontFamily: fonts.sansSemiBold, fontSize: 10, lineHeight: 13, letterSpacing: 1.4 },
} as const;
