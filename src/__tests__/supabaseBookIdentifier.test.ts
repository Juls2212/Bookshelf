import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';

import { BookIdentifyError } from '@/features/scan/bookIdentifier';
import {
  createSupabaseBookIdentifier,
  IDENTIFY_FUNCTION,
} from '@/features/scan/supabaseBookIdentifier';

jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

type InvokeResult = { data: unknown; error: unknown };

function setup(result: InvokeResult | (() => Promise<InvokeResult>)) {
  const invoke = jest.fn<Promise<InvokeResult>, [string, { body: unknown; signal?: AbortSignal }]>(
    typeof result === 'function' ? result : async () => result,
  );
  const readBase64 = jest.fn(async () => 'BASE64');
  const identifier = createSupabaseBookIdentifier({
    getClient: () => ({ functions: { invoke } }) as never,
    readBase64,
  });
  return { identifier, invoke, readBase64 };
}

const request = { imageUri: 'file:///cache/small.jpg', mode: 'cover' as const };

const httpError = (status: number, body?: unknown) =>
  new FunctionsHttpError(
    new Response(body === undefined ? 'oops' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': body === undefined ? 'text/plain' : 'application/json' },
    }),
  );

describe('SupabaseBookIdentifier', () => {
  it('sends the photo as base64 with the mode and maps the result', async () => {
    const { identifier, invoke, readBase64 } = setup({
      data: {
        data: {
          title: 'Cartas a nadie',
          author: 'Julián Rueda',
          genre: null,
          page_count: 248,
          confidence: 'high',
          cover_box: { x: 0.2, y: 0.1, width: 0.55, height: 0.8 },
        },
      },
      error: null,
    });
    const signal = new AbortController().signal;
    await expect(identifier.identify(request, { signal })).resolves.toEqual({
      title: 'Cartas a nadie',
      author: 'Julián Rueda',
      genre: null,
      pageCount: 248,
      confidence: 'high',
      coverBox: { x: 0.2, y: 0.1, width: 0.55, height: 0.8 },
      coverCorners: null,
    });
    expect(readBase64).toHaveBeenCalledWith(request.imageUri);
    expect(invoke).toHaveBeenCalledWith(IDENTIFY_FUNCTION, {
      body: { image_base64: 'BASE64', mode: 'cover' },
      signal,
    });
  });

  it('maps valid cover_corners (reordered) and drops invalid ones', async () => {
    const corners = [
      { x: 0.75, y: 0.9 },
      { x: 0.25, y: 0.1 },
      { x: 0.2, y: 0.85 },
      { x: 0.8, y: 0.15 },
    ];
    const ok = setup({
      data: { data: { title: 'T', confidence: 'high', cover_corners: corners } },
      error: null,
    });
    await expect(ok.identifier.identify(request)).resolves.toMatchObject({
      coverCorners: [
        { x: 0.25, y: 0.1 },
        { x: 0.8, y: 0.15 },
        { x: 0.75, y: 0.9 },
        { x: 0.2, y: 0.85 },
      ],
    });
    const tiny = setup({
      data: {
        data: {
          title: 'T',
          confidence: 'high',
          cover_corners: [
            { x: 0.4, y: 0.4 },
            { x: 0.45, y: 0.4 },
            { x: 0.45, y: 0.45 },
            { x: 0.4, y: 0.45 },
          ],
        },
      },
      error: null,
    });
    await expect(tiny.identifier.identify(request)).resolves.toMatchObject({ coverCorners: null });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['outside the image', { x: 0.6, y: 0, width: 0.6, height: 0.5 }],
    ['too small', { x: 0, y: 0, width: 0.05, height: 0.5 }],
    ['not numbers', { x: '0', y: 0, width: 0.5, height: 0.5 }],
  ])('a cover_box that is %s becomes null', async (_label, coverBox) => {
    const { identifier } = setup({
      data: { data: { title: 'T', confidence: 'low', cover_box: coverBox } },
      error: null,
    });
    await expect(identifier.identify(request)).resolves.toMatchObject({ coverBox: null });
  });

  it.each([
    ['unauthorized', 'unauthorized'],
    ['rate_limited', 'rate_limited'],
    ['not_a_book', 'not_a_book'],
    ['low_confidence', 'low_confidence'],
    ['timeout', 'timeout'],
    ['upstream_error', 'unknown'],
    ['invalid_request', 'unknown'],
    ['image_too_large', 'unknown'],
  ])('maps the function error %s to %s', async (serverCode, appCode) => {
    const { identifier } = setup({ data: null, error: httpError(422, { error: serverCode }) });
    await expect(identifier.identify(request)).rejects.toEqual(
      new BookIdentifyError(appCode as never),
    );
  });

  it('falls back to the HTTP status when the body is not readable', async () => {
    await expect(
      setup({ data: null, error: httpError(401) }).identifier.identify(request),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      setup({ data: null, error: httpError(429) }).identifier.identify(request),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(
      setup({ data: null, error: httpError(500) }).identifier.identify(request),
    ).rejects.toMatchObject({ code: 'unknown' });
  });

  it('maps network and relay failures', async () => {
    await expect(
      setup({
        data: null,
        error: new FunctionsFetchError(new TypeError('Network request failed')),
      }).identifier.identify(request),
    ).rejects.toMatchObject({ code: 'network' });
    await expect(
      setup({
        data: null,
        error: new FunctionsRelayError(new Response('', { status: 502 })),
      }).identifier.identify(request),
    ).rejects.toMatchObject({ code: 'unknown' });
  });

  it('rejects malformed results and unreadable photos as unknown', async () => {
    await expect(
      setup({ data: { data: { title: 42, confidence: 'high' } }, error: null }).identifier.identify(
        request,
      ),
    ).rejects.toMatchObject({ code: 'unknown' });
    const { identifier, readBase64, invoke } = setup({ data: null, error: null });
    readBase64.mockRejectedValueOnce(new Error('missing'));
    await expect(identifier.identify(request)).rejects.toMatchObject({ code: 'unknown' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('passes the abort signal to the request and reports a cancel as an abort', async () => {
    const controller = new AbortController();
    const { identifier, invoke } = setup(
      () =>
        new Promise<InvokeResult>((resolve) => {
          controller.signal.addEventListener('abort', () =>
            resolve({ data: null, error: new FunctionsFetchError(new Error('aborted')) }),
          );
        }),
    );
    const pending = identifier.identify(request, { signal: controller.signal });
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(invoke.mock.calls[0][1].signal).toBe(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('never calls the function when already cancelled', async () => {
    const { identifier, invoke } = setup({ data: null, error: null });
    const controller = new AbortController();
    controller.abort();
    await expect(identifier.identify(request, { signal: controller.signal })).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
