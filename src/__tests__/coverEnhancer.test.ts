// "Mejorar portada" rendering pipeline with a fake Skia (real rendering is checked on a device).
import {
  createCoverEnhancer,
  ENHANCE_TIMEOUT_MS,
  EnhanceError,
  workingResizeFor,
} from '@/features/scan/coverEnhancer';
import { insetCorners, straightenedSize, toPixels } from '@/features/scan/coverGeometry';

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: 'cache' } }));

/** Controls the fake Skia below. */
const mockSkiaState = {
  decodes: true,
  /** Low-contrast pixels (lum 100..150) for the histogram. */
  pixels: new Uint8Array(
    Array.from({ length: 64 * 90 }, (_, i) => {
      const v = 100 + (i % 51);
      return [v, v, v, 255];
    }).flat(),
  ),
  matrices: [] as number[][],
  vertices: [] as unknown[][],
  disposed: 0,
};

jest.mock('@shopify/react-native-skia', () => {
  const disposable = () => ({ dispose: () => (mockSkiaState.disposed += 1) });
  const surface = (width: number, height: number) => ({
    ...disposable(),
    getCanvas: () => ({ scale: jest.fn(), drawVertices: jest.fn(), drawColor: jest.fn() }),
    flush: jest.fn(),
    makeImageSnapshot: () => ({
      ...disposable(),
      readPixels: () => mockSkiaState.pixels,
      encodeToBytes: () => new Uint8Array([0xff, 0xd8, width % 256, height % 256]),
    }),
  });
  return {
    Skia: {
      Data: { fromBytes: () => disposable() },
      Image: {
        MakeImageFromEncoded: () =>
          mockSkiaState.decodes
            ? {
                ...disposable(),
                width: () => 1000,
                height: () => 1500,
                makeShaderOptions: () => disposable(),
              }
            : null,
      },
      MakeVertices: (...args: unknown[]) => {
        mockSkiaState.vertices.push(args);
        return disposable();
      },
      Paint: () => ({ ...disposable(), setShader: jest.fn(), setColorFilter: jest.fn() }),
      Surface: { Make: surface },
      ColorFilter: {
        MakeMatrix: (m: number[]) => {
          mockSkiaState.matrices.push(m);
          return disposable();
        },
      },
      Color: () => 0,
    },
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

const photo = {
  uri: 'file:///cache/camera.jpg',
  width: 3000,
  height: 4500,
  source: 'camera' as const,
};
const working = { uri: 'file:///cache/working.jpg', width: 1000, height: 1500 };
const corners = insetCorners(0.1);

function setup(overrides: Partial<Parameters<typeof createCoverEnhancer>[0]> = {}) {
  const deps = {
    prepareWorkingCopy: jest.fn(async () => working),
    readBytes: jest.fn(async () => new Uint8Array([1, 2, 3])),
    writeJpeg: jest.fn(() => 'file:///cache/cover-enhanced.jpg'),
    removeFile: jest.fn(),
    ...overrides,
  };
  return { deps, enhancer: createCoverEnhancer(deps) };
}

beforeEach(() => {
  mockSkiaState.decodes = true;
  mockSkiaState.matrices = [];
  mockSkiaState.vertices = [];
});

describe('cover enhancer', () => {
  it('works from a copy of at most 2000 px', () => {
    expect(workingResizeFor(4000, 3000)).toEqual({ width: 2000 });
    expect(workingResizeFor(3000, 4500)).toEqual({ height: 2000 });
    expect(workingResizeFor(1600, 1200)).toBeNull();
  });

  it('straightens with a mesh, applies levels, encodes and writes the JPEG', async () => {
    const { enhancer, deps } = setup();
    const result = await enhancer.enhance(photo, corners);
    const size = straightenedSize(toPixels(corners, 1000, 1500), 1200);
    expect(result).toEqual({
      uri: 'file:///cache/cover-enhanced.jpg',
      width: size.width,
      height: size.height,
      source: 'camera',
    });
    expect(deps.prepareWorkingCopy).toHaveBeenCalledWith(photo);
    // Triangles with texture coordinates (the photo) and indices.
    const [mode, positions, textures, , indices] = mockSkiaState.vertices[0];
    expect(mode).toBe(0);
    expect((positions as unknown[]).length).toBe(17 * 17);
    expect((textures as unknown[]).length).toBe(17 * 17);
    expect((indices as unknown[]).length).toBe(16 * 16 * 6);
    // The low-contrast sample produced a real stretch (not the identity matrix).
    expect(mockSkiaState.matrices[0][0]).toBeGreaterThan(1);
    expect(deps.writeJpeg).toHaveBeenCalledWith(expect.any(Uint8Array));
    // The working copy is temporary.
    expect(deps.removeFile).toHaveBeenCalledWith(working.uri);
  });

  it('a photo Skia cannot decode fails (the form keeps the plain crop)', async () => {
    mockSkiaState.decodes = false;
    const { enhancer, deps } = setup();
    await expect(enhancer.enhance(photo, corners)).rejects.toEqual(new EnhanceError('failed'));
    expect(deps.writeJpeg).not.toHaveBeenCalled();
    expect(deps.removeFile).toHaveBeenCalledWith(working.uri);
  });

  it('any other failure is reported as "failed"', async () => {
    const { enhancer } = setup({
      readBytes: jest.fn(async () => {
        throw new Error('disk');
      }),
    });
    await expect(enhancer.enhance(photo, corners)).rejects.toEqual(new EnhanceError('failed'));
  });

  it('gives up after 10 s', async () => {
    jest.useFakeTimers();
    try {
      const { enhancer } = setup({
        prepareWorkingCopy: jest.fn(() => new Promise<never>(() => undefined)),
      });
      const pending = enhancer.enhance(photo, corners);
      jest.advanceTimersByTime(ENHANCE_TIMEOUT_MS);
      await expect(pending).rejects.toEqual(new EnhanceError('timeout'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancel rejects at once, and a late result file is removed', async () => {
    let release: (value: typeof working) => void = () => undefined;
    const { enhancer, deps } = setup({
      prepareWorkingCopy: jest.fn(
        () =>
          new Promise<typeof working>((resolve) => {
            release = resolve;
          }),
      ),
    });
    const controller = new AbortController();
    const pending = enhancer.enhance(photo, corners, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toEqual(new EnhanceError('cancelled'));
    release(working);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.writeJpeg).not.toHaveBeenCalled();
    expect(deps.removeFile).toHaveBeenCalledWith(working.uri);

    const before = new AbortController();
    before.abort();
    await expect(enhancer.enhance(photo, corners, { signal: before.signal })).rejects.toEqual(
      new EnhanceError('cancelled'),
    );
  });
});
