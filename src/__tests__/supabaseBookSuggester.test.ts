import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';

import { BookSuggestError } from '@/features/suggestions/bookSuggester';
import {
  createBookSuggester,
  useFakeSuggesterStore,
} from '@/features/suggestions/suggesterFactory';
import {
  createSupabaseBookSuggester,
  suggestCacheKey,
  SUGGEST_FUNCTION,
} from '@/features/suggestions/supabaseBookSuggester';

jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

type InvokeResult = { data: unknown; error: unknown };
type InvokeOptions = { body: unknown; signal?: AbortSignal };

function setup(
  result: InvokeResult | ((options: InvokeOptions) => Promise<InvokeResult>),
  timeoutMs?: number,
) {
  const invoke = jest.fn<Promise<InvokeResult>, [string, InvokeOptions]>(
    typeof result === 'function' ? (_name, options) => result(options) : async () => result,
  );
  const suggester = createSupabaseBookSuggester({
    getClient: () => ({ functions: { invoke } }) as never,
    timeoutMs,
  });
  return { suggester, invoke };
}

const ok = (candidates: unknown[]): InvokeResult => ({
  data: { data: { candidates } },
  error: null,
});

const httpError = (status: number, body?: unknown) =>
  new FunctionsHttpError(
    new Response(body === undefined ? 'oops' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': body === undefined ? 'text/plain' : 'application/json' },
    }),
  );

const rayuela = {
  title: 'Rayuela',
  canonical_title: 'Rayuela (novela)',
  author: 'Julio Cortázar',
  genre: 'Novela',
  page_count: 600,
};

describe('SupabaseBookSuggester', () => {
  it('sends the trimmed title and author and maps the candidates', async () => {
    const { suggester, invoke } = setup(ok([rayuela, { title: 'Otra', author: null }]));
    await expect(suggester.suggest({ title: ' Rayuela ', author: ' Cortázar ' })).resolves.toEqual([
      {
        title: 'Rayuela',
        canonicalTitle: 'Rayuela (novela)',
        author: 'Julio Cortázar',
        genre: 'Novela',
        pageCount: 600,
      },
      { title: 'Otra', canonicalTitle: null, author: null, genre: null, pageCount: null },
    ]);
    expect(invoke).toHaveBeenCalledWith(SUGGEST_FUNCTION, {
      body: { title: 'Rayuela', author: 'Cortázar' },
      signal: expect.any(AbortSignal),
    });
  });

  it('omits an empty author and drops malformed candidates', async () => {
    const { suggester, invoke } = setup(
      ok([{ title: '  ' }, 'x', { ...rayuela, page_count: 0 }, rayuela, rayuela, rayuela]),
    );
    const books = await suggester.suggest({ title: 'Rayuela', author: '  ' });
    expect(invoke.mock.calls[0][1].body).toEqual({ title: 'Rayuela' });
    expect(books).toHaveLength(3);
    expect(books[0].pageCount).toBeNull();
  });

  it.each([
    ['unauthorized', 'unauthorized'],
    ['rate_limited', 'rate_limited'],
    ['no_suggestions', 'no_suggestions'],
    ['timeout', 'timeout'],
    ['upstream_error', 'unknown'],
    ['invalid_request', 'unknown'],
  ])('maps the function error %s to %s', async (serverCode, appCode) => {
    const { suggester } = setup({ data: null, error: httpError(422, { error: serverCode }) });
    await expect(suggester.suggest({ title: 'Rayuela' })).rejects.toEqual(
      new BookSuggestError(appCode as never),
    );
  });

  it('falls back to the HTTP status, and maps fetch and relay errors', async () => {
    const cases: [unknown, string][] = [
      [httpError(401), 'unauthorized'],
      [httpError(429), 'rate_limited'],
      [httpError(500), 'unknown'],
      [new FunctionsFetchError(new TypeError('Network request failed')), 'network'],
      [new FunctionsRelayError(new Response('', { status: 502 })), 'unknown'],
    ];
    for (const [error, code] of cases) {
      const { suggester } = setup({ data: null, error });
      await expect(suggester.suggest({ title: 'Rayuela' })).rejects.toMatchObject({ code });
    }
  });

  it('an empty or malformed answer is no_suggestions or unknown', async () => {
    await expect(setup(ok([])).suggester.suggest({ title: 'Rayuela' })).rejects.toMatchObject({
      code: 'no_suggestions',
    });
    await expect(
      setup({ data: { nope: true }, error: null }).suggester.suggest({ title: 'Rayuela' }),
    ).rejects.toMatchObject({ code: 'unknown' });
  });

  it('caches answers by normalized title and author', async () => {
    const { suggester, invoke } = setup(ok([rayuela]));
    const first = await suggester.suggest({ title: 'Rayuela', author: 'Cortázar' });
    const again = await suggester.suggest({ title: '  rayuela ', author: 'CORTÁZAR  ' });
    expect(again).toEqual(first);
    expect(invoke).toHaveBeenCalledTimes(1);
    // A cached result is a copy: changing it never changes the cache.
    again[0].title = 'Changed';
    expect((await suggester.suggest({ title: 'Rayuela', author: 'Cortázar' }))[0].title).toBe(
      'Rayuela',
    );
    await suggester.suggest({ title: 'Rayuela' });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(suggestCacheKey(' A  b ', null)).toBe(suggestCacheKey('a B', ''));
  });

  it('does not cache failures', async () => {
    let calls = 0;
    const { suggester } = setup(async () => {
      calls += 1;
      return calls === 1
        ? { data: null, error: httpError(502, { error: 'upstream_error' }) }
        : ok([rayuela]);
    });
    await expect(suggester.suggest({ title: 'Rayuela' })).rejects.toBeInstanceOf(BookSuggestError);
    await expect(suggester.suggest({ title: 'Rayuela' })).resolves.toHaveLength(1);
  });

  it('aborts the request when the caller aborts, and reports it as an abort', async () => {
    let requestSignal: AbortSignal | undefined;
    const { suggester } = setup(
      (options) =>
        new Promise(() => {
          requestSignal = options.signal;
        }),
    );
    const controller = new AbortController();
    const pending = suggester.suggest({ title: 'Rayuela' }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestSignal?.aborted).toBe(true);

    const before = new AbortController();
    before.abort();
    await expect(
      suggester.suggest({ title: 'Rayuela' }, { signal: before.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('gives up after the client timeout with a timeout error', async () => {
    jest.useFakeTimers();
    try {
      let requestSignal: AbortSignal | undefined;
      const { suggester } = setup(
        (options) =>
          new Promise(() => {
            requestSignal = options.signal;
          }),
        20_000,
      );
      const pending = suggester.suggest({ title: 'Rayuela' });
      jest.advanceTimersByTime(20_000);
      await expect(pending).rejects.toEqual(new BookSuggestError('timeout'));
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('suggester factory', () => {
  afterEach(() => useFakeSuggesterStore.setState({ fakeEnabled: false, outcome: 'success' }));

  it('uses the real suggester unless the dev gallery turns the fake on', async () => {
    const real = { suggest: jest.fn(async () => []) };
    const suggester = createBookSuggester({ dev: true, real });
    await suggester.suggest({ title: 'Rayuela' });
    expect(real.suggest).toHaveBeenCalledTimes(1);

    useFakeSuggesterStore.setState({ fakeEnabled: true, outcome: 'single', delayMs: 0 });
    await expect(suggester.suggest({ title: 'Rayuela' })).resolves.toHaveLength(1);
    expect(real.suggest).toHaveBeenCalledTimes(1);

    // A release build never uses the fake.
    await createBookSuggester({ dev: false, real }).suggest({ title: 'Rayuela' });
    expect(real.suggest).toHaveBeenCalledTimes(2);
  });
});
