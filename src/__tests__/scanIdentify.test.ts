import { PermissionStatus } from 'expo-camera';

import { fakeIdentifiedBook } from '@/dev/fakeFixtures';
import { addBook } from '@/features/library/addBook';
import type { LocalImage } from '@/features/library/coverService';
import {
  BookIdentifyError,
  IDENTIFY_ERROR_CODES,
  type BookIdentifier,
  type IdentifiedBook,
} from '@/features/scan/bookIdentifier';
import { cameraAccessFor } from '@/features/scan/cameraAccess';
import { createFakeBookIdentifier } from '@/features/scan/fakeBookIdentifier';
import { createBookIdentifier, useFakeIdentifierStore } from '@/features/scan/identifierFactory';
import { IDENTIFY_TIMEOUT_MS, identifyBook } from '@/features/scan/identifyBook';
import { identificationResizeFor } from '@/features/scan/scanPhoto';
import { identifiedToFormValues, retryActionFor } from '@/features/scan/scanReview';

jest.mock('expo-file-system', () => ({ File: jest.fn(), Directory: jest.fn(), Paths: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const photo: LocalImage = { uri: 'file:///cache/photo.jpg', width: 3000, height: 4000 };
const small: LocalImage = { uri: 'file:///cache/small.jpg', width: 768, height: 1024 };

function deps(identifier: BookIdentifier, online = true) {
  return {
    identifier,
    network: { isOnline: jest.fn(async () => online) },
    prepare: jest.fn(async () => small),
    discard: jest.fn(),
  };
}

const answering = (book: IdentifiedBook): BookIdentifier => ({
  identify: jest.fn(async () => book),
});
const failing = (error: unknown): BookIdentifier => ({
  identify: jest.fn(async () => {
    throw error;
  }),
});
/** Never answers on its own; records the signal it received. */
function hanging() {
  const signals: AbortSignal[] = [];
  const identifier: BookIdentifier = {
    identify: jest.fn((_request, options) => {
      if (options?.signal) signals.push(options.signal);
      return new Promise<IdentifiedBook>(() => {});
    }),
  };
  return { identifier, signals };
}

describe('identifier factory and fake', () => {
  const real: BookIdentifier = { identify: jest.fn(async () => fakeIdentifiedBook) };

  beforeEach(() => jest.clearAllMocks());
  afterEach(() =>
    useFakeIdentifierStore.setState({ fakeEnabled: false, outcome: 'success', delayMs: 0 }),
  );

  it('uses the real identifier by default', async () => {
    const identifier = createBookIdentifier({ dev: true, real });
    await identifier.identify({ imageUri: 'x', mode: 'cover' });
    expect(real.identify).toHaveBeenCalledTimes(1);
  });

  it('uses the fake in development only when the dev gallery turns it on', async () => {
    const identifier = createBookIdentifier({ dev: true, real });
    useFakeIdentifierStore.getState().setOutcome('success');
    useFakeIdentifierStore.setState({ delayMs: 0 });
    await expect(identifier.identify({ imageUri: 'x', mode: 'cover' })).resolves.toEqual(
      fakeIdentifiedBook,
    );
    useFakeIdentifierStore.setState({ outcome: 'low_result' });
    await expect(identifier.identify({ imageUri: 'x', mode: 'spine' })).resolves.toMatchObject({
      confidence: 'low',
    });
    expect(real.identify).not.toHaveBeenCalled();
    useFakeIdentifierStore.getState().chooseReal();
    await identifier.identify({ imageUri: 'x', mode: 'cover' });
    expect(real.identify).toHaveBeenCalledTimes(1);
  });

  it.each(IDENTIFY_ERROR_CODES)('the fake throws a typed %s error', async (code) => {
    const identifier = createFakeBookIdentifier(() => ({ outcome: code, delayMs: 0 }));
    await expect(identifier.identify({ imageUri: 'x', mode: 'cover' })).rejects.toEqual(
      new BookIdentifyError(code),
    );
  });

  it('release builds never use the fake', async () => {
    useFakeIdentifierStore.setState({ fakeEnabled: true, outcome: 'not_a_book', delayMs: 0 });
    await expect(
      createBookIdentifier({ dev: false, real }).identify({ imageUri: 'x', mode: 'cover' }),
    ).resolves.toEqual(fakeIdentifiedBook);
    expect(real.identify).toHaveBeenCalledTimes(1);
  });

  it('the fake stops waiting as soon as the request is aborted', async () => {
    jest.useFakeTimers();
    try {
      const identifier = createFakeBookIdentifier(() => ({ outcome: 'success', delayMs: 5000 }));
      const controller = new AbortController();
      const pending = identifier.identify(
        { imageUri: 'x', mode: 'cover' },
        { signal: controller.signal },
      );
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('identifyBook', () => {
  const signal = () => new AbortController().signal;

  it('identifies the small copy and cleans the result', async () => {
    const d = deps(
      answering({
        title: '  Cartas a nadie ',
        author: ' ',
        genre: 'Novela',
        pageCount: 0,
        confidence: 'medium',
        coverBox: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
        coverCorners: null,
      }),
    );
    const outcome = await identifyBook({ photo, mode: 'spine', signal: signal() }, d);
    expect(outcome).toEqual({
      status: 'success',
      book: {
        title: 'Cartas a nadie',
        author: null,
        genre: 'Novela',
        pageCount: null,
        confidence: 'medium',
        coverBox: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
        coverCorners: null,
      },
    });
    expect(d.prepare).toHaveBeenCalledWith(photo);
    expect(d.identifier.identify).toHaveBeenCalledWith(
      { imageUri: small.uri, mode: 'spine' },
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    // The identification copy never outlives the attempt.
    expect(d.discard).toHaveBeenCalledWith(small.uri);
  });

  it.each(IDENTIFY_ERROR_CODES)('maps a %s failure to its code', async (code) => {
    const d = deps(failing(new BookIdentifyError(code)));
    await expect(identifyBook({ photo, mode: 'cover', signal: signal() }, d)).resolves.toEqual({
      status: 'failed',
      error: code,
    });
  });

  it('maps untyped errors and results without a title', async () => {
    await expect(
      identifyBook({ photo, mode: 'cover', signal: signal() }, deps(failing(new Error('boom')))),
    ).resolves.toEqual({ status: 'failed', error: 'unknown' });
    await expect(
      identifyBook(
        { photo, mode: 'cover', signal: signal() },
        deps(answering({ ...fakeIdentifiedBook, title: ' ' })),
      ),
    ).resolves.toEqual({ status: 'failed', error: 'low_confidence' });
  });

  it('offline skips the photo work and the call', async () => {
    const d = deps(answering(fakeIdentifiedBook), false);
    await expect(identifyBook({ photo, mode: 'cover', signal: signal() }, d)).resolves.toEqual({
      status: 'failed',
      error: 'offline',
    });
    expect(d.prepare).not.toHaveBeenCalled();
    expect(d.identifier.identify).not.toHaveBeenCalled();
  });

  it('cancel aborts the request right away', async () => {
    const { identifier, signals } = hanging();
    const d = deps(identifier);
    const controller = new AbortController();
    const pending = identifyBook({ photo, mode: 'cover', signal: controller.signal }, d);
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(signals).toHaveLength(1);
    controller.abort();
    await expect(pending).resolves.toEqual({ status: 'cancelled' });
    expect(signals[0].aborted).toBe(true);
    expect(d.discard).toHaveBeenCalledWith(small.uri);
  });

  it('times out after 30 s as a timeout, aborting the request', async () => {
    jest.useFakeTimers();
    try {
      const { identifier, signals } = hanging();
      const pending = identifyBook({ photo, mode: 'cover', signal: signal() }, deps(identifier));
      await jest.advanceTimersByTimeAsync(IDENTIFY_TIMEOUT_MS - 1);
      expect(signals[0].aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ status: 'failed', error: 'timeout' });
      expect(signals[0].aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('scan helpers', () => {
  it('resizes the long side to 1024 px only when larger', () => {
    expect(identificationResizeFor(3000, 4000)).toEqual({ height: 1024 });
    expect(identificationResizeFor(4000, 3000)).toEqual({ width: 1024 });
    expect(identificationResizeFor(800, 1024)).toBeNull();
  });

  it('prefills the form like a new book', () => {
    expect(identifiedToFormValues(fakeIdentifiedBook)).toEqual({
      title: 'Cartas a nadie',
      author: 'Julián Rueda',
      genre: 'Novela epistolar',
      pages: '248',
      readingStatus: 'to_read',
      currentPage: '',
      rating: null,
      notes: '',
    });
    expect(
      identifiedToFormValues({ ...fakeIdentifiedBook, author: null, pageCount: null }),
    ).toMatchObject({ author: '', pages: '' });
  });

  it('retakes the photo when it was the problem, otherwise sends it again', () => {
    expect(retryActionFor('not_a_book')).toBe('retake');
    expect(retryActionFor('low_confidence')).toBe('retake');
    for (const code of [
      'network',
      'timeout',
      'rate_limited',
      'unauthorized',
      'unknown',
      'offline',
    ] as const) {
      expect(retryActionFor(code)).toBe('identify');
    }
  });

  it('derives the camera permission states', () => {
    expect(cameraAccessFor(null, false)).toBe('checking');
    expect(
      cameraAccessFor(
        { granted: false, status: PermissionStatus.UNDETERMINED, canAskAgain: true },
        false,
      ),
    ).toBe('request');
    expect(
      cameraAccessFor(
        { granted: false, status: PermissionStatus.DENIED, canAskAgain: false },
        false,
      ),
    ).toBe('denied');
    expect(
      cameraAccessFor(
        { granted: false, status: PermissionStatus.DENIED, canAskAgain: true },
        false,
      ),
    ).toBe('denied');
    expect(
      cameraAccessFor(
        { granted: true, status: PermissionStatus.GRANTED, canAskAgain: true },
        false,
      ),
    ).toBe('ready');
    expect(
      cameraAccessFor({ granted: true, status: PermissionStatus.GRANTED, canAskAgain: true }, true),
    ).toBe('unavailable');
  });

  it('a camera photo is saved as a camera cover', async () => {
    const create = jest.fn(async (input) => ({ ok: true as const, data: input }));
    const covers = {
      prepare: jest.fn(async (image: LocalImage) => ({ ok: true as const, data: image })),
      saveLocal: jest.fn(async () => ({
        ok: true as const,
        data: { localUri: 'file:///doc/covers/u/b.jpg', path: 'u/b.jpg' },
      })),
      removeLocal: jest.fn(),
    };
    await addBook(
      {
        userId: 'u',
        input: { title: 'T', readingStatus: 'to_read' },
        cover: { ...photo, source: 'camera' },
      },
      { create, covers, newId: () => 'b' },
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ coverSource: 'camera' }));
  });
});
