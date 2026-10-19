// recommendationsStore: request flow, session exclusions, dispositions and the offline cache.
import { openUserDatabase } from '@/db/database';
import { listSyncQueue } from '@/db/syncQueue';
import { createLibrarySession } from '@/features/library/librarySession';
import type { NewRecommendation } from '@/features/recommendations/recommendationRepository';
import {
  RecommendError,
  type RecommendRequest,
} from '@/features/recommendations/recommendationService';
import { createSqliteRecommendationRepository } from '@/features/recommendations/sqliteRecommendationRepository';
import { createRecommendationsStore } from '@/stores/recommendationsStore';
import { createMemoryOpener } from '@/test-utils/nodeSqlite';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
// Tuesday 2026-10-13, 21:30 on the device.
const NOW = new Date(2026, 9, 13, 21, 30);

function fakeService() {
  let n = 0;
  return {
    recommend: jest.fn(async (request: RecommendRequest): Promise<NewRecommendation> => {
      n += 1;
      const bookId = ['b1', 'b2', 'b3'].find((id) => !request.excludeBookIds.includes(id));
      if (!bookId) throw new RecommendError('no_candidates');
      return {
        recommendationId: `rec-${n}`,
        bookId,
        rationale: `Motivo ${n}.`,
        createdAt: new Date(Date.UTC(2026, 9, 11, 10, n)).toISOString(),
      };
    }),
  };
}

async function setup({ online = true } = {}) {
  const opener = createMemoryOpener();
  const session = createLibrarySession({ open: (u) => openUserDatabase(u, opener) });
  await session.start(USER);
  const db = (await session.current())!.db;
  const repository = createSqliteRecommendationRepository({ session, onWrite: jest.fn() });
  const service = fakeService();
  const network = { isOnline: jest.fn(async () => online) };
  const syncFirst = jest.fn(async () => undefined);
  const make = () =>
    createRecommendationsStore({ repository, service, network, syncFirst, now: () => NOW });
  const store = make();
  await store.getState().load(USER);
  return { db, repository, service, network, syncFirst, store, make };
}

describe('requestRecommendation', () => {
  it('syncs first, sends weekday, hour and context, and caches the result', async () => {
    const t = await setup();
    await expect(t.store.getState().requestRecommendation('  algo corto ')).resolves.toBe(true);
    expect(t.syncFirst).toHaveBeenCalledTimes(1);
    expect(t.service.recommend).toHaveBeenCalledWith(
      {
        context: 'algo corto',
        availableTime: null,
        mood: null,
        excludeBookIds: [],
        localWeekday: 2,
        localHour: 21,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(t.store.getState()).toMatchObject({
      status: 'ready',
      error: null,
      current: { id: 'rec-1', bookId: 'b1', disposition: 'suggested' },
      sessionSuggestedBookIds: ['b1'],
    });
    expect(t.store.getState().history.map((r) => r.id)).toEqual(['rec-1']);
    const cached = await t.repository.listHistory(USER);
    expect(cached.ok && cached.data[0]).toMatchObject({ id: 'rec-1', rationale: 'Motivo 1.' });
  });

  it('sends the chosen time and mood', async () => {
    const t = await setup();
    await t.store.getState().requestRecommendation(null, {
      availableTime: 'two_hours_plus',
      mood: 'thoughtful',
    });
    expect(t.service.recommend.mock.calls[0][0]).toMatchObject({
      context: null,
      availableTime: 'two_hours_plus',
      mood: 'thoughtful',
    });
  });

  it('excludes the books already suggested in this session', async () => {
    const t = await setup();
    await t.store.getState().requestRecommendation();
    await t.store.getState().requestRecommendation();
    expect(t.service.recommend.mock.calls[1][0].excludeBookIds).toEqual(['b1']);
    expect(t.store.getState().current?.bookId).toBe('b2');
    expect(t.store.getState().sessionSuggestedBookIds).toEqual(['b1', 'b2']);
  });

  it('when every book was suggested this session, says so; "Empezar de nuevo" clears it', async () => {
    const t = await setup();
    for (let i = 0; i < 3; i += 1) await t.store.getState().requestRecommendation();
    await expect(t.store.getState().requestRecommendation()).resolves.toBe(false);
    expect(t.store.getState()).toMatchObject({
      status: 'error',
      error: 'exhausted',
      sessionSuggestedBookIds: ['b1', 'b2', 'b3'],
    });
    // The current recommendation stays available.
    expect(t.store.getState().current?.bookId).toBe('b3');
    await expect(t.store.getState().startOver()).resolves.toBe(true);
    expect(t.service.recommend.mock.calls[4][0].excludeBookIds).toEqual([]);
    expect(t.store.getState()).toMatchObject({
      current: { bookId: 'b1' },
      sessionSuggestedBookIds: ['b1'],
    });
  });

  it('cancel aborts the request and goes back to the previous state', async () => {
    const t = await setup();
    let signal: AbortSignal | undefined;
    t.service.recommend.mockImplementationOnce(
      (_request, options?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          signal = options?.signal;
          signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const pending = t.store.getState().requestRecommendation();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.store.getState().status).toBe('loading');
    t.store.getState().cancel();
    await expect(pending).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(t.store.getState()).toMatchObject({ status: 'idle', error: null, current: null });
  });

  it('with no books at all, reports no_candidates', async () => {
    const t = await setup();
    t.service.recommend.mockRejectedValueOnce(new RecommendError('no_candidates'));
    await t.store.getState().requestRecommendation();
    expect(t.store.getState().error).toBe('no_candidates');
  });

  it.each(['rate_limited', 'network', 'unauthorized', 'unknown'] as const)(
    'reports %s as a typed error',
    async (code) => {
      const t = await setup();
      t.service.recommend.mockRejectedValueOnce(new RecommendError(code));
      await t.store.getState().requestRecommendation();
      expect(t.store.getState()).toMatchObject({ status: 'error', error: code });
    },
  );

  it('offline: no request, and the last recommendation stays from the cache', async () => {
    const t = await setup();
    await t.store.getState().requestRecommendation();
    // A restart while offline: the session is empty, the cache is not.
    t.network.isOnline.mockResolvedValue(false);
    const restarted = t.make();
    await restarted.getState().load(USER);
    expect(restarted.getState().current).toMatchObject({ id: 'rec-1', bookId: 'b1' });
    expect(restarted.getState().sessionSuggestedBookIds).toEqual([]);
    await expect(restarted.getState().requestRecommendation()).resolves.toBe(false);
    expect(restarted.getState()).toMatchObject({ error: 'offline', current: { id: 'rec-1' } });
    expect(t.service.recommend).toHaveBeenCalledTimes(1);
  });

  it('waits at most 5 s for the pre-sync', async () => {
    jest.useFakeTimers();
    try {
      const t = await setup();
      t.syncFirst.mockImplementation(() => new Promise(() => undefined));
      const pending = t.store.getState().requestRecommendation();
      await jest.advanceTimersByTimeAsync(4_999);
      expect(t.service.recommend).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe(true);
      expect(t.service.recommend).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a newer request replaces an older one', async () => {
    const t = await setup();
    let release: () => void = () => undefined;
    t.service.recommend.mockImplementationOnce(
      (_request, options?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
          release = () => reject(new RecommendError('unknown'));
        }),
    );
    const first = t.store.getState().requestRecommendation();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = t.store.getState().requestRecommendation();
    release();
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(t.store.getState()).toMatchObject({ status: 'ready', error: null });
  });
});

describe('dispositions', () => {
  it('markViewed, saveForLater and skip are saved locally and queued', async () => {
    const t = await setup();
    await t.store.getState().requestRecommendation();
    const id = t.store.getState().current!.id;

    await expect(t.store.getState().markViewed(id)).resolves.toBe(true);
    expect(t.store.getState().current).toMatchObject({ disposition: 'viewed', pending: true });
    await t.store.getState().saveForLater(id);
    expect(t.store.getState().history[0]).toMatchObject({ disposition: 'read_later' });
    // Opening a saved one later keeps it saved.
    await t.store.getState().markViewed(id);
    expect(t.store.getState().current?.disposition).toBe('read_later');
    await t.store.getState().skip(id);
    expect(t.store.getState().current?.disposition).toBe('skipped');
    expect(await listSyncQueue(t.db)).toMatchObject([{ entity: 'recommendation', entity_id: id }]);
  });

  it('"Otra recomendación": a new request that excludes it, then the old one is skipped', async () => {
    const t = await setup();
    await t.store.getState().requestRecommendation();
    await expect(t.store.getState().requestAnother()).resolves.toBe(true);
    expect(t.store.getState().history.map((r) => [r.id, r.disposition])).toEqual([
      ['rec-2', 'suggested'],
      ['rec-1', 'skipped'],
    ]);
    expect(t.service.recommend.mock.calls[1][0].excludeBookIds).toEqual(['b1']);
  });

  it('"Otra recomendación" that fails leaves the current one untouched', async () => {
    const t = await setup();
    await t.store.getState().requestRecommendation();
    t.service.recommend.mockRejectedValueOnce(new RecommendError('timeout'));
    await expect(t.store.getState().requestAnother()).resolves.toBe(false);
    expect(t.store.getState().error).toBe('timeout');
    expect(t.store.getState().history.map((r) => [r.id, r.disposition])).toEqual([
      ['rec-1', 'suggested'],
    ]);
    expect(await listSyncQueue(t.db)).toEqual([]);
  });

  it('rolls back when the local save fails', async () => {
    const t = await setup();
    await t.store.getState().requestRecommendation();
    const id = t.store.getState().current!.id;
    jest
      .spyOn(t.repository, 'updateDisposition')
      .mockResolvedValueOnce({ ok: false, error: 'unknown' });
    await expect(t.store.getState().saveForLater(id)).resolves.toBe(false);
    expect(t.store.getState().current).toMatchObject({ disposition: 'suggested', pending: false });
  });

  it('loadHistory reads the cache; clear() forgets everything', async () => {
    const t = await setup();
    await t.store.getState().requestRecommendation();
    await t.store.getState().requestRecommendation();
    const other = t.make();
    await other.getState().load(USER);
    await other.getState().loadHistory();
    expect(other.getState().history.map((r) => r.id)).toEqual(['rec-2', 'rec-1']);
    other.getState().clear();
    expect(other.getState()).toMatchObject({ userId: null, current: null, history: [] });
  });
});
