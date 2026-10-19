// Official NetInfo mock (connectivity).
jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock'),
);

// Official gesture-handler mocks (native modules are not available in Jest).
require('react-native-gesture-handler/jestSetup');

// Reanimated 4 needs the worklets native module, which does not exist in Jest.
// Both libraries ship official mocks (see the Reanimated testing guide). The Reanimated mock
// lacks `useReducedMotion`, so it defaults to "motion allowed"; tests can override it.
jest.mock('react-native-worklets', () =>
  jest.requireActual('react-native-worklets/lib/module/mock'),
);
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: jest.fn(() => false),
}));

// Skia renders natively; Jest has no native side. Every call fails here, so "Mejorar portada"
// falls back to the plain crop, exactly as on a device where Skia is unavailable. Tests that
// need rendering override `Skia` with their own fakes.
jest.mock('@shopify/react-native-skia', () => {
  const unavailable = () => {
    throw new Error('skia_unavailable_in_jest');
  };
  const factory = new Proxy({}, { get: () => unavailable });
  return {
    Skia: new Proxy({}, { get: () => factory }),
    AlphaType: { Unpremul: 3 },
    BlendMode: { Modulate: 13 },
    ColorType: { RGBA_8888: 4 },
    FilterMode: { Linear: 1 },
    ImageFormat: { JPEG: 3 },
    MipmapMode: { None: 0 },
    TileMode: { Clamp: 0 },
    VertexMode: { Triangles: 0 },
  };
});
