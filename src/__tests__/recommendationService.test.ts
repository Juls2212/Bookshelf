import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';

import { createFakeRecommendationService } from '@/features/recommendations/fakeRecommendationService';
import { RecommendError } from '@/features/recommendations/recommendationService';
import {
  createRecommendationService,
  useFakeRecommendStore,
} from '@/features/recommendations/serviceFactory';
import {
  createSupabaseRecommendationService,
  RECOMMEND_FUNCTION,
} from '@/features/recommendations/supabaseRecommendationService';

jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'rec-fake') }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));

type InvokeResult = { data: unknown; error: unknown };
type InvokeOptions = { body: Record<string, unknown>; signal?: AbortSignal };

function setup(
  result: InvokeResult | ((options: InvokeOptions) => Promise<InvokeResult>),
  timeoutMs?: number,
) {
  const invoke = jest.fn<Promise<InvokeResult>, [string, InvokeOptions]>(
    typeof result === 'function' ? (_name, options) => result(options) : async () => result,
  );
  const service = createSupabaseRecommendationService({
    getClient: () => ({ functions: { invoke } }) as never,
    timeoutMs,
  });
  return { service, invoke };
}

const request = {
  context: '  algo breve ',
  availableTime: null,
  mood: null,
  excludeBookIds: ['b1'],
  localWeekday: 3,
  localHour: 22,
};

const okBody = {
  data: {
    data: {
      recommendation_id: 'rec-1',
      book_id: 'b2',
      rationale: ' Es corto. ',
      created_at: '2026-10-11T10:00:00.000Z',
    },
  },
  error: null,
};

const httpError = (status: number, body?: unknown) =>
  new FunctionsHttpError(
    new Response(body === undefined ? 'oops' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': body === undefined ? 'text/plain' : 'application/json' },
    }),
  );

describe('SupabaseRecommendationService', () => {
  it('sends the context, exclusions, weekday and hour, and maps the result', async () => {
    const { service, invoke } = setup(okBody);
    await expect(service.recommend(request)).resolves.toEqual({
      recommendationId: 'rec-1',
      bookId: 'b2',
      rationale: 'Es corto.',
      createdAt: '2026-10-11T10:00:00.000Z',
    });
    expect(invoke).toHaveBeenCalledWith(RECOMMEND_FUNCTION, {
      body: { context: 'algo breve', exclude_book_ids: ['b1'], local_weekday: 3, local_hour: 22 },
      signal: expect.any(AbortSignal),
    });
  });

  it('sends the chosen time and mood', async () => {
    const { service, invoke } = setup(okBody);
    await service.recommend({ ...request, availableTime: 'about_1_hour', mood: 'calm' });
    expect(invoke.mock.calls[0][1].body).toMatchObject({
      available_time: 'about_1_hour',
      mood: 'calm',
    });
  });

  it('omits an empty context', async () => {
    const { service, invoke } = setup(okBody);
    await service.recommend({ ...request, context: '   ' });
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty('context');
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty('available_time');
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty('mood');
  });

  it.each([
    ['unauthorized', 'unauthorized'],
    ['rate_limited', 'rate_limited'],
    ['no_candidates', 'no_candidates'],
    ['timeout', 'timeout'],
    ['upstream_error', 'unknown'],
    ['invalid_request', 'unknown'],
  ])('maps the function error %s to %s', async (serverCode, appCode) => {
    const { service } = setup({ data: null, error: httpError(422, { error: serverCode }) });
    await expect(service.recommend(request)).rejects.toEqual(new RecommendError(appCode as never));
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
      const { service } = setup({ data: null, error });
      await expect(service.recommend(request)).rejects.toMatchObject({ code });
    }
  });

  it('a malformed answer is unknown', async () => {
    const { service } = setup({ data: { data: { book_id: 'b2' } }, error: null });
    await expect(service.recommend(request)).rejects.toEqual(new RecommendError('unknown'));
  });

  it('aborts the request when the caller aborts', async () => {
    let requestSignal: AbortSignal | undefined;
    const { service } = setup(
      (options) =>
        new Promise(() => {
          requestSignal = options.signal;
        }),
    );
    const controller = new AbortController();
    const pending = service.recommend(request, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestSignal?.aborted).toBe(true);

    const before = new AbortController();
    before.abort();
    await expect(service.recommend(request, { signal: before.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('gives up after 30 s with a timeout error', async () => {
    jest.useFakeTimers();
    try {
      const { service } = setup(() => new Promise(() => undefined));
      const pending = service.recommend(request);
      jest.advanceTimersByTime(30_000);
      await expect(pending).rejects.toEqual(new RecommendError('timeout'));
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('fake service and factory', () => {
  afterEach(() => useFakeRecommendStore.setState({ fakeEnabled: false, outcome: 'success' }));

  it('recommends the first of the user books that is not excluded', async () => {
    const fake = createFakeRecommendationService({
      getConfig: () => ({ outcome: 'success', delayMs: 0 }),
      getToReadBookIds: () => ['b1', 'b2'],
      newId: () => 'rec-9',
      now: () => new Date('2026-10-11T10:00:00.000Z'),
    });
    await expect(fake.recommend(request)).resolves.toMatchObject({
      recommendationId: 'rec-9',
      bookId: 'b2',
    });
    await expect(fake.recommend({ ...request, excludeBookIds: ['b1', 'b2'] })).rejects.toEqual(
      new RecommendError('no_candidates'),
    );
  });

  it('uses the real service unless the dev gallery turns the fake on', async () => {
    const real = { recommend: jest.fn(async () => ({}) as never) };
    const service = createRecommendationService({ dev: true, real });
    await service.recommend(request);
    expect(real.recommend).toHaveBeenCalledTimes(1);

    useFakeRecommendStore.setState({ fakeEnabled: true, outcome: 'rate_limited', delayMs: 0 });
    await expect(service.recommend(request)).rejects.toEqual(new RecommendError('rate_limited'));
    expect(real.recommend).toHaveBeenCalledTimes(1);

    await createRecommendationService({ dev: false, real }).recommend(request);
    expect(real.recommend).toHaveBeenCalledTimes(2);
  });
});
