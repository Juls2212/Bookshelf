// "Nuevas aventuras" on the app side: service, migration 6, local cache, sync and store.
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { openUserDatabase } from '@/db/database';
import { getUserVersion, migrate, MIGRATIONS, SCHEMA_VERSION } from '@/db/schema';
import { listSyncQueue } from '@/db/syncQueue';
import { createLibrarySession } from '@/features/library/librarySession';
import {
  formValuesFromParams,
  suggestionToParams,
} from '@/features/recommendations/addFromSuggestion';
import {
  createDiscoveryService,
  useFakeDiscoverStore,
} from '@/features/recommendations/discoveryFactory';
import {
  DiscoverError,
  type DiscoverRequest,
  type NewDiscovery,
} from '@/features/recommendations/discoveryService';
import { createFakeDiscoveryService } from '@/features/recommendations/fakeDiscoveryService';
import { getLocalRecommendation } from '@/features/recommendations/localRecommendations';
import { addDiscoveryExclusion } from '@/features/recommendations/recommendationRules';
import { createSqliteRecommendationRepository } from '@/features/recommendations/sqliteRecommendationRepository';
import {
  createSupabaseDiscoveryService,
  DISCOVER_FUNCTION,
} from '@/features/recommendations/supabaseDiscoveryService';
import { createSyncEngine } from '@/features/sync/syncEngine';
import { createRecommendationsStore } from '@/stores/recommendationsStore';
import { fakeAvatars } from '@/test-utils/fakeAvatars';
import { fakeReadingEventServer } from '@/test-utils/fakeReadingEventServer';
import { fakePreferencesServer } from '@/test-utils/fakePreferencesServer';
import { fakeRecommendationServer } from '@/test-utils/fakeRecommendationServer';
import { createMemoryDatabase, createMemoryOpener } from '@/test-utils/nodeSqlite';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'rec-fake') }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

const request: DiscoverRequest = {
  seedBookId: null,
  mood: null,
  context: null,
  excludeSuggestions: [],
  localWeekday: 2,
  localHour: 21,
};

const discovery = (n: number, overrides: Partial<NewDiscovery> = {}): NewDiscovery => ({
  recommendationId: `disc-${n}`,
  title: `Libro nuevo ${n}`,
  author: 'Autora',
  genre: 'Novela',
  pageCount: 180,
  verified: true,
  confidence: 'high',
  rationale: `Motivo ${n}.`,
  createdAt: new Date(Date.UTC(2026, 9, 11, 10, n)).toISOString(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type InvokeResult = { data: unknown; error: unknown };
type InvokeOptions = { body: Record<string, unknown>; signal?: AbortSignal };

function setupService(
  result: InvokeResult | ((o: InvokeOptions) => Promise<InvokeResult>),
  timeoutMs?: number,
) {
  const invoke = jest.fn<Promise<InvokeResult>, [string, InvokeOptions]>(
    typeof result === 'function' ? (_n, o) => result(o) : async () => result,
  );
  const service = createSupabaseDiscoveryService({
    getClient: () => ({ functions: { invoke } }) as never,
    timeoutMs,
  });
  return { service, invoke };
}

const okBody: InvokeResult = {
  data: {
    data: {
      recommendation_id: 'disc-1',
      title: ' La hojarasca ',
      author: 'Gabriel García Márquez',
      genre: 'Novela',
      page_count: 144,
      verified: true,
      confidence: 'medium',
      rationale: 'Motivo.',
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

describe('SupabaseDiscoveryService', () => {
  it('sends the request and maps the answer', async () => {
    const { service, invoke } = setupService(okBody);
    await expect(
      service.discover({
        ...request,
        seedBookId: 'b1',
        mood: 'calm',
        context: ' algo ',
        excludeSuggestions: [{ title: 'X', author: null }],
      }),
    ).resolves.toEqual({
      recommendationId: 'disc-1',
      title: 'La hojarasca',
      author: 'Gabriel García Márquez',
      genre: 'Novela',
      pageCount: 144,
      verified: true,
      confidence: 'medium',
      rationale: 'Motivo.',
      createdAt: '2026-10-11T10:00:00.000Z',
    });
    expect(invoke).toHaveBeenCalledWith(DISCOVER_FUNCTION, {
      body: {
        seed_book_id: 'b1',
        mood: 'calm',
        context: 'algo',
        exclude_suggestions: [{ title: 'X', author: null }],
        local_weekday: 2,
        local_hour: 21,
      },
      signal: expect.any(AbortSignal),
    });
  });

  it('omits empty optional fields', async () => {
    const { service, invoke } = setupService(okBody);
    await service.discover(request);
    expect(invoke.mock.calls[0][1].body).toEqual({
      exclude_suggestions: [],
      local_weekday: 2,
      local_hour: 21,
    });
  });

  it.each([
    ['unauthorized', 'unauthorized'],
    ['rate_limited', 'rate_limited'],
    ['no_new_suggestions', 'no_new_suggestions'],
    ['timeout', 'timeout'],
    ['upstream_error', 'unknown'],
    ['invalid_request', 'unknown'],
  ])('maps %s to %s', async (server, app) => {
    const { service } = setupService({ data: null, error: httpError(422, { error: server }) });
    await expect(service.discover(request)).rejects.toEqual(new DiscoverError(app as never));
  });

  it('maps statuses, fetch errors and malformed answers', async () => {
    for (const [error, code] of [
      [httpError(401), 'unauthorized'],
      [httpError(429), 'rate_limited'],
      [new FunctionsFetchError(new TypeError('Network request failed')), 'network'],
    ] as const) {
      await expect(
        setupService({ data: null, error }).service.discover(request),
      ).rejects.toMatchObject({ code });
    }
    await expect(
      setupService({ data: { data: { title: 'T' } }, error: null }).service.discover(request),
    ).rejects.toEqual(new DiscoverError('unknown'));
  });

  it('aborts with the caller, and times out after 30 s as a timeout', async () => {
    let seen: AbortSignal | undefined;
    const { service } = setupService(
      (o) =>
        new Promise(() => {
          seen = o.signal;
        }),
    );
    const controller = new AbortController();
    const pending = service.discover(request, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen?.aborted).toBe(true);

    jest.useFakeTimers();
    try {
      const slow = setupService(() => new Promise(() => undefined)).service.discover(request);
      jest.advanceTimersByTime(30_000);
      await expect(slow).rejects.toEqual(new DiscoverError('timeout'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('the fake skips excluded samples and the factory uses it only when enabled', async () => {
    const fake = createFakeDiscoveryService({
      getConfig: () => ({ outcome: 'success', delayMs: 0 }),
    });
    const first = await fake.discover(request);
    const second = await fake.discover({
      ...request,
      excludeSuggestions: [{ title: first.title, author: first.author }],
    });
    expect(second.title).not.toBe(first.title);

    const real = { discover: jest.fn(async () => discovery(1)) };
    const service = createDiscoveryService({ dev: true, real });
    await service.discover(request);
    expect(real.discover).toHaveBeenCalledTimes(1);
    useFakeDiscoverStore.setState({ fakeEnabled: true, outcome: 'rate_limited', delayMs: 0 });
    await expect(service.discover(request)).rejects.toEqual(new DiscoverError('rate_limited'));
    await createDiscoveryService({ dev: false, real }).discover(request);
    expect(real.discover).toHaveBeenCalledTimes(2);
    useFakeDiscoverStore.setState({ fakeEnabled: false, outcome: 'success' });
  });
});

// ---------------------------------------------------------------------------
// Migration 6
// ---------------------------------------------------------------------------

describe('migration 6', () => {
  it('keeps existing recommendations as shelf rows and accepts discovery rows', async () => {
    const db = createMemoryDatabase();
    for (const migration of MIGRATIONS.filter((m) => m.version <= 5)) {
      for (const statement of migration.statements) await db.execAsync(statement);
    }
    await db.execAsync('PRAGMA user_version = 5');
    await db.runAsync(
      `INSERT INTO recommendations (id, user_id, book_id, rationale, request_context, disposition,
         created_at, sync_state, local_updated_at)
       VALUES ('old', ?, 'book-1', 'Motivo.', '{"context":null}', 'read_later',
         '2026-10-01T00:00:00.000Z', 'pending', '2026-10-02T00:00:00.000Z')`,
      [USER],
    );
    await db.runAsync(
      "INSERT INTO sync_queue (entity, entity_id, operation, created_at) VALUES ('recommendation', 'old', 'upsert', 'now')",
    );

    // Later migrations run too; what v6 added must survive them.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(6);
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await getLocalRecommendation(db, 'old')).toMatchObject({
      kind: 'shelf',
      book_id: 'book-1',
      rationale: 'Motivo.',
      disposition: 'read_later',
      sync_state: 'pending',
      local_updated_at: '2026-10-02T00:00:00.000Z',
      suggested_title: null,
    });
    expect(await listSyncQueue(db)).toHaveLength(1);

    await db.runAsync(
      `INSERT INTO recommendations (id, user_id, kind, book_id, suggested_title, rationale, created_at)
       VALUES ('new', ?, 'discovery', NULL, 'Libro nuevo', 'Motivo.', 'now')`,
      [USER],
    );
    // A discovery row needs a title; a shelf row needs a book.
    await expect(
      db.runAsync(
        "INSERT INTO recommendations (id, user_id, kind, rationale, created_at) VALUES ('bad', 'u', 'discovery', 'x', 'now')",
      ),
    ).rejects.toThrow();
    await expect(
      db.runAsync(
        "INSERT INTO recommendations (id, user_id, kind, rationale, created_at) VALUES ('bad2', 'u', 'shelf', 'x', 'now')",
      ),
    ).rejects.toThrow();

    // Idempotent: running migrate again on every start changes nothing.
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(await getLocalRecommendation(db, 'new')).toMatchObject({ kind: 'discovery' });
  });
});

// ---------------------------------------------------------------------------
// Local cache, sync and store
// ---------------------------------------------------------------------------

async function setup({ online = true } = {}) {
  const opener = createMemoryOpener();
  const session = createLibrarySession({ open: (u) => openUserDatabase(u, opener) });
  await session.start(USER);
  const db = (await session.current())!.db;
  const repository = createSqliteRecommendationRepository({ session, onWrite: jest.fn() });
  const server = fakeRecommendationServer();
  const engine = createSyncEngine({
    session,
    gateway: {
      upsertBook: jest.fn(),
      pullChangedSince: jest.fn(async () => ({ ok: true as const, data: [] })),
      pullPage: jest.fn(async () => ({ ok: true as const, data: [] })),
      refreshSession: jest.fn(async () => false),
    },
    profiles: {
      pullProfile: jest.fn(async () => ({ ok: true as const, data: null })),
      pushProfile: jest.fn(),
    },
    preferences: fakePreferencesServer(USER).gateway,
    recommendations: server.gateway,
    covers: { upload: jest.fn(), downloadToLocal: jest.fn(), remove: jest.fn() },
    avatars: fakeAvatars().service,
    readingEvents: fakeReadingEventServer().gateway,
    network: { isOnline: async () => true, subscribe: () => () => undefined },
    random: () => 0,
  });
  let n = 0;
  const discoveryService = {
    discover: jest.fn(async (req: DiscoverRequest) => {
      n += 1;
      if (req.excludeSuggestions.length >= 2) throw new DiscoverError('no_new_suggestions');
      return discovery(n);
    }),
  };
  const network = { isOnline: jest.fn(async () => online) };
  const make = () =>
    createRecommendationsStore({
      repository,
      service: { recommend: jest.fn() },
      discovery: discoveryService,
      network,
      syncFirst: jest.fn(async () => undefined),
      now: () => new Date(2026, 9, 13, 21, 30),
    });
  const store = make();
  await store.getState().load(USER);
  return { db, repository, server, engine, discoveryService, network, store, make };
}

describe('discovery cache and sync', () => {
  it('stores a suggestion (kind discovery, no book) with its confidence', async () => {
    const t = await setup();
    const saved = await t.repository.saveDiscovery(
      USER,
      discovery(1, { verified: false, confidence: 'low', pageCount: null }),
      { mode: 'discovery' },
    );
    expect(saved).toEqual({
      ok: true,
      data: {
        id: 'disc-1',
        kind: 'discovery',
        bookId: null,
        suggestion: {
          title: 'Libro nuevo 1',
          author: 'Autora',
          genre: 'Novela',
          pageCount: null,
          verified: false,
          confidence: 'low',
        },
        rationale: 'Motivo 1.',
        disposition: 'suggested',
        createdAt: discovery(1).createdAt,
        pending: false,
      },
    });
  });

  it('pulls discovery rows from the server, and old rows without the new columns as shelf', async () => {
    const t = await setup();
    t.server.put({
      id: 'srv-disc',
      user_id: USER,
      user_book_id: null,
      kind: 'discovery',
      suggested_title: 'Del servidor',
      suggested_author: null,
      suggested_genre: 'Ensayo',
      suggested_page_count: 210,
      suggestion_verified: true,
      rationale: 'Motivo.',
      request_context: { confidence: 'medium' },
      disposition: 'read_later',
      created_at: '2026-10-11T09:00:00.000Z',
    });
    // Before the 7.5 SQL: no kind column at all.
    t.server.put({
      id: 'srv-old',
      user_id: USER,
      user_book_id: 'book-9',
      rationale: 'Antiguo.',
      request_context: {},
      disposition: 'suggested',
      created_at: '2026-10-10T09:00:00.000Z',
    });
    // Malformed rows are skipped instead of breaking the pull.
    t.server.put({
      id: 'srv-bad',
      user_id: USER,
      user_book_id: null,
      kind: 'discovery',
      suggested_title: null,
      rationale: 'x',
      request_context: {},
      disposition: 'suggested',
      created_at: '2026-10-09T09:00:00.000Z',
    });
    await t.engine.syncNow();
    const history = await t.repository.listHistory(USER);
    expect(history.ok && history.data.map((r) => [r.id, r.kind])).toEqual([
      ['srv-disc', 'discovery'],
      ['srv-old', 'shelf'],
    ]);
    expect(history.ok && history.data[0].suggestion).toEqual({
      title: 'Del servidor',
      author: null,
      genre: 'Ensayo',
      pageCount: 210,
      verified: true,
      confidence: 'medium',
    });
  });

  it('pushes a discovery disposition like any other', async () => {
    const t = await setup();
    t.server.put({
      id: 'disc-1',
      user_id: USER,
      user_book_id: null,
      kind: 'discovery',
      suggested_title: 'Libro nuevo 1',
      rationale: 'Motivo 1.',
      request_context: {},
      disposition: 'suggested',
      created_at: discovery(1).createdAt,
    });
    await t.engine.syncNow();
    await t.repository.updateDisposition(USER, 'disc-1', 'read_later');
    await t.engine.syncNow();
    expect(t.server.row('disc-1')).toMatchObject({ disposition: 'read_later' });
    expect(await listSyncQueue(t.db)).toEqual([]);
  });
});

describe('store: Nuevas aventuras', () => {
  it('requestDiscovery sends the input and the session exclusions, and caches the result', async () => {
    const t = await setup();
    await expect(
      t.store.getState().requestDiscovery({ seedBookId: 'b1', mood: 'calm', context: ' algo ' }),
    ).resolves.toBe(true);
    expect(t.discoveryService.discover).toHaveBeenCalledWith(
      {
        seedBookId: 'b1',
        mood: 'calm',
        context: 'algo',
        excludeSuggestions: [],
        localWeekday: 2,
        localHour: 21,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(t.store.getState()).toMatchObject({
      discoveryStatus: 'ready',
      currentDiscovery: { id: 'disc-1', kind: 'discovery' },
      sessionDiscoveryExclusions: [{ title: 'Libro nuevo 1', author: 'Autora' }],
      // The shelf side is untouched.
      current: null,
      status: 'idle',
    });

    await t.store.getState().requestDiscovery();
    expect(t.discoveryService.discover.mock.calls[1][0].excludeSuggestions).toEqual([
      { title: 'Libro nuevo 1', author: 'Autora' },
    ]);
  });

  it('"Otra sugerencia" = a new request, then the old one is skipped; errors are typed', async () => {
    const t = await setup();
    await t.store.getState().requestDiscovery();
    await expect(t.store.getState().requestAnotherDiscovery()).resolves.toBe(true);
    expect(t.store.getState().history.map((r) => [r.id, r.disposition])).toEqual([
      ['disc-2', 'suggested'],
      ['disc-1', 'skipped'],
    ]);
    // A failed "Otra sugerencia" keeps the current one as it was (not skipped).
    await expect(t.store.getState().requestAnotherDiscovery()).resolves.toBe(false);
    expect(t.store.getState()).toMatchObject({
      discoveryStatus: 'error',
      discoveryError: 'no_new_suggestions',
      currentDiscovery: { id: 'disc-2', disposition: 'suggested' },
    });
  });

  it('saveIdea and markAdded keep it as read_later (saved locally and queued)', async () => {
    const t = await setup();
    await t.store.getState().requestDiscovery();
    await t.store.getState().saveIdea('disc-1');
    expect(t.store.getState().currentDiscovery?.disposition).toBe('read_later');
    expect(await t.store.getState().markAdded('disc-1')).toBe(true);
    expect(await listSyncQueue(t.db)).toMatchObject([
      { entity: 'recommendation', entity_id: 'disc-1' },
    ]);
  });

  it('offline: no request; the last suggestion stays from the cache after a restart', async () => {
    const t = await setup();
    await t.store.getState().requestDiscovery();
    t.network.isOnline.mockResolvedValue(false);
    const restarted = t.make();
    await restarted.getState().load(USER);
    expect(restarted.getState()).toMatchObject({
      currentDiscovery: { id: 'disc-1' },
      sessionDiscoveryExclusions: [],
    });
    await expect(restarted.getState().requestDiscovery()).resolves.toBe(false);
    expect(restarted.getState().discoveryError).toBe('offline');
    expect(t.discoveryService.discover).toHaveBeenCalledTimes(1);
  });

  it('cancelDiscovery aborts the request', async () => {
    const t = await setup();
    let signal: AbortSignal | undefined;
    t.discoveryService.discover.mockImplementationOnce(
      (_r, options?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          signal = options?.signal;
          signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }) as never,
    );
    const pending = t.store.getState().requestDiscovery();
    await new Promise((resolve) => setTimeout(resolve, 0));
    t.store.getState().cancelDiscovery();
    await expect(pending).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(t.store.getState()).toMatchObject({ discoveryStatus: 'idle', discoveryError: null });
  });
});

describe('add from a suggestion and session exclusions', () => {
  it('prefills the add form from the suggestion (editable values, pages only when valid)', () => {
    const rec = {
      id: 'disc-1',
      kind: 'discovery' as const,
      bookId: null,
      suggestion: {
        title: 'La hojarasca',
        author: 'G. G. Márquez',
        genre: 'Novela',
        pageCount: 144,
        verified: true,
        confidence: 'high' as const,
      },
      rationale: 'x',
      disposition: 'suggested' as const,
      createdAt: 'now',
      pending: false,
    };
    const params = suggestionToParams(rec)!;
    expect(params).toEqual({
      title: 'La hojarasca',
      author: 'G. G. Márquez',
      genre: 'Novela',
      pages: '144',
      suggestion: 'disc-1',
    });
    expect(formValuesFromParams(params)).toMatchObject({
      suggestionId: 'disc-1',
      values: {
        title: 'La hojarasca',
        author: 'G. G. Márquez',
        genre: 'Novela',
        pages: '144',
        readingStatus: 'to_read',
      },
    });
    expect(formValuesFromParams({ ...params, pages: '0' })?.values.pages).toBe('');
    expect(formValuesFromParams({ title: 'Sin id' })).toBeNull();
    expect(suggestionToParams({ ...rec, kind: 'shelf', suggestion: null })).toBeNull();
  });

  it('session exclusions: no duplicates (case and accents), at most 30', () => {
    const list = addDiscoveryExclusion([{ title: 'Rayuela', author: 'Cortázar' }], {
      title: 'RAYUELA',
      author: 'cortazar',
    });
    expect(list).toEqual([{ title: 'RAYUELA', author: 'cortazar' }]);
    let many: { title: string; author: string | null }[] = [];
    for (let i = 0; i < 35; i += 1)
      many = addDiscoveryExclusion(many, { title: `T${i}`, author: null });
    expect(many).toHaveLength(30);
    expect(many[0].title).toBe('T5');
  });
});
