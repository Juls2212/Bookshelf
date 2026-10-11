import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import {
  COVER_JPEG_QUALITY,
  COVER_MAX_HEIGHT,
  SIGNED_URL_TTL_SECONDS,
  coverPathFor,
  coverResizeFor,
  createCoverService,
} from '@/features/library/coverService';
import type { AppSupabaseClient } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => {
  const context: { resize: jest.Mock; renderAsync: jest.Mock } = {
    resize: jest.fn((): unknown => context),
    renderAsync: jest.fn(async () => ({
      saveAsync: jest.fn(async () => ({ uri: 'file:///prepared.jpg', width: 900, height: 1200 })),
    })),
  };
  return {
    SaveFormat: { JPEG: 'jpeg' },
    ImageManipulator: { manipulate: jest.fn(() => context), __context: context },
  };
});

const manipulator = ImageManipulator as unknown as {
  manipulate: jest.Mock;
  __context: { resize: jest.Mock; renderAsync: jest.Mock };
};
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

function storageMock() {
  const bucket = {
    upload: jest.fn(async () => ({ data: { path: 'p' }, error: null })),
    remove: jest.fn(async () => ({ data: [], error: null })),
    info: jest.fn(async () => ({ data: { size: 48_213 }, error: null })),
    createSignedUrls: jest.fn(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
      error: null,
    })),
  };
  const from = jest.fn(() => bucket);
  const client = { storage: { from } } as unknown as AppSupabaseClient;
  return { client, bucket, from };
}

let warn: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

/** Logs must carry error codes only: no paths (user/book ids) and no URLs. */
function expectSafeLogs() {
  for (const [message] of warn.mock.calls) {
    expect(String(message)).not.toMatch(/u1\/|https?:|token/i);
  }
}

describe('cover prepare logic', () => {
  it('builds the storage path', () => {
    expect(coverPathFor('user-1', 'book-1')).toBe('user-1/book-1.jpg');
  });

  it('only resizes images taller than the maximum', () => {
    expect(coverResizeFor(COVER_MAX_HEIGHT + 1)).toEqual({ height: COVER_MAX_HEIGHT });
    expect(coverResizeFor(COVER_MAX_HEIGHT)).toBeNull();
    expect(coverResizeFor(800)).toBeNull();
  });

  it('resizes tall images and always re-encodes as JPEG 0.8', async () => {
    const service = createCoverService();
    const result = await service.prepare({ uri: 'file:///big.heic', width: 3000, height: 4000 });
    expect(manipulator.manipulate).toHaveBeenCalledWith('file:///big.heic');
    expect(manipulator.__context.resize).toHaveBeenCalledWith({ height: COVER_MAX_HEIGHT });
    const rendered = await manipulator.__context.renderAsync.mock.results[0].value;
    expect(rendered.saveAsync).toHaveBeenCalledWith({
      format: SaveFormat.JPEG,
      compress: COVER_JPEG_QUALITY,
    });
    expect(result).toEqual({
      ok: true,
      data: { uri: 'file:///prepared.jpg', width: 900, height: 1200 },
    });
  });

  it('does not upscale small images', async () => {
    await createCoverService().prepare({ uri: 'file:///small.jpg', width: 300, height: 400 });
    expect(manipulator.__context.resize).not.toHaveBeenCalled();
  });
});

describe('gallery picker', () => {
  it('asks for a single 3:4 image', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked.jpg', width: 900, height: 1200 }],
    } as ImagePicker.ImagePickerResult);
    const result = await createCoverService().pickFromGallery();
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], allowsEditing: true, aspect: [3, 4] }),
    );
    expect(result).toEqual({
      ok: true,
      data: { uri: 'file:///picked.jpg', width: 900, height: 1200 },
    });
  });

  it('reports cancellation', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    await expect(createCoverService().pickFromGallery()).resolves.toEqual({
      ok: false,
      error: 'cancelled',
    });
  });
});

describe('storage', () => {
  it('uploads JPEG bytes to {userId}/{bookId}.jpg with upsert', async () => {
    const { client, bucket, from } = storageMock();
    const bytes = new ArrayBuffer(4);
    const service = createCoverService({ getClient: () => client, readFile: async () => bytes });
    await expect(service.upload('u1', 'b1', 'file:///prepared.jpg')).resolves.toEqual({
      ok: true,
      data: 'u1/b1.jpg',
    });
    expect(from).toHaveBeenCalledWith('book-covers');
    expect(bucket.upload).toHaveBeenCalledWith('u1/b1.jpg', bytes, {
      contentType: 'image/jpeg',
      upsert: true,
    });
  });

  it('rejects an empty local file without uploading it', async () => {
    const { client, bucket } = storageMock();
    const service = createCoverService({
      getClient: () => client,
      readFile: async () => new ArrayBuffer(0),
    });
    await expect(service.upload('u1', 'b1', 'file:///empty.jpg')).resolves.toEqual({
      ok: false,
      error: 'unknown',
    });
    expect(bucket.upload).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[covers] upload failed: empty_file');
    expectSafeLogs();
  });

  it('treats a stored object of 0 bytes as a failed upload and removes it', async () => {
    const { client, bucket } = storageMock();
    bucket.info.mockResolvedValueOnce({ data: { size: 0 }, error: null });
    const service = createCoverService({
      getClient: () => client,
      readFile: async () => new ArrayBuffer(8),
    });
    await expect(service.upload('u1', 'b1', 'file:///p.jpg')).resolves.toEqual({
      ok: false,
      error: 'unknown',
    });
    expect(bucket.remove).toHaveBeenCalledWith(['u1/b1.jpg']);
    expectSafeLogs();
  });

  it('reports a failed upload request with its code only', async () => {
    const { client, bucket } = storageMock();
    bucket.upload.mockResolvedValueOnce({
      data: null,
      error: { statusCode: '403', message: 'new row violates row-level security policy' },
    } as never);
    const service = createCoverService({
      getClient: () => client,
      readFile: async () => new ArrayBuffer(8),
    });
    await expect(service.upload('u1', 'b1', 'file:///p.jpg')).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
    expect(warn).toHaveBeenCalledWith('[covers] upload failed: unauthorized');
    expectSafeLogs();
  });

  it('does not cache paths that could not be signed, so they are retried', async () => {
    const { client, bucket } = storageMock();
    bucket.createSignedUrls.mockResolvedValueOnce({
      data: [
        { path: 'u1/a.jpg', signedUrl: 'https://signed/u1/a.jpg?token=x', error: null },
        { path: 'u1/b.jpg', signedUrl: null, error: 'Object not found' },
      ],
      error: null,
    } as never);
    const service = createCoverService({ getClient: () => client });
    const first = await service.getSignedUrls(['u1/a.jpg', 'u1/b.jpg']);
    expect(first).toEqual({ ok: true, data: { 'u1/a.jpg': 'https://signed/u1/a.jpg?token=x' } });
    expect(warn).toHaveBeenCalledWith('[covers] signed URLs failed: 1 of 2 not signed');

    await service.getSignedUrls(['u1/a.jpg', 'u1/b.jpg']);
    expect(bucket.createSignedUrls).toHaveBeenLastCalledWith(['u1/b.jpg'], SIGNED_URL_TTL_SECONDS);
    expectSafeLogs();
  });

  it('does not cache anything when the whole request fails', async () => {
    const { client, bucket } = storageMock();
    bucket.createSignedUrls.mockRejectedValueOnce(new TypeError('Network request failed'));
    const service = createCoverService({ getClient: () => client });
    await expect(service.getSignedUrls(['u1/a.jpg'])).resolves.toEqual({
      ok: false,
      error: 'network_error',
    });
    await service.getSignedUrls(['u1/a.jpg']);
    expect(bucket.createSignedUrls).toHaveBeenCalledTimes(2);
    expectSafeLogs();
  });

  it('removes a cover', async () => {
    const { client, bucket } = storageMock();
    await createCoverService({ getClient: () => client }).remove('u1/b1.jpg');
    expect(bucket.remove).toHaveBeenCalledWith(['u1/b1.jpg']);
  });

  it('batches signed URLs and caches them until shortly before expiry', async () => {
    const { client, bucket } = storageMock();
    let now = 1_000_000;
    const service = createCoverService({ getClient: () => client, now: () => now });

    const first = await service.getSignedUrls(['u1/a.jpg', 'u1/b.jpg', 'u1/a.jpg']);
    expect(first).toEqual({
      ok: true,
      data: { 'u1/a.jpg': 'https://signed/u1/a.jpg', 'u1/b.jpg': 'https://signed/u1/b.jpg' },
    });
    expect(bucket.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(bucket.createSignedUrls).toHaveBeenCalledWith(
      ['u1/a.jpg', 'u1/b.jpg'],
      SIGNED_URL_TTL_SECONDS,
    );

    // Cached: only the new path is requested.
    await service.getSignedUrls(['u1/a.jpg', 'u1/c.jpg']);
    expect(bucket.createSignedUrls).toHaveBeenLastCalledWith(['u1/c.jpg'], SIGNED_URL_TTL_SECONDS);

    // Near expiry: requested again.
    now += SIGNED_URL_TTL_SECONDS * 1000 - 30_000;
    await service.getSignedUrls(['u1/a.jpg']);
    expect(bucket.createSignedUrls).toHaveBeenLastCalledWith(['u1/a.jpg'], SIGNED_URL_TTL_SECONDS);

    service.clearCache();
    await service.getSignedUrls(['u1/b.jpg']);
    expect(bucket.createSignedUrls).toHaveBeenCalledTimes(4);
  });

  it('maps storage errors', async () => {
    const { client, bucket } = storageMock();
    bucket.createSignedUrls.mockResolvedValueOnce({
      data: null,
      error: { statusCode: '403', message: 'denied' },
    } as never);
    await expect(
      createCoverService({ getClient: () => client }).getSignedUrls(['x/y.jpg']),
    ).resolves.toEqual({ ok: false, error: 'unauthorized' });
  });
});
