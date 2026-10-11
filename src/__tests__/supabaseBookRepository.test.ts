import {
  createSupabaseBookRepository,
  mapBookError,
} from '@/features/library/supabaseBookRepository';
import type { AppSupabaseClient } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'generated-uuid') }));

type Call = { method: string; args: unknown[] };
type Response = { data?: unknown; error?: unknown };

/**
 * Fake client: each `from()` starts a chainable query that records its calls and resolves
 * (on await, `single` or `maybeSingle`) with the next queued response.
 */
function fakeClient(responses: Response[]) {
  const queries: Call[][] = [];
  const client = {
    from: jest.fn((tableName: string) => {
      const calls: Call[] = [{ method: 'from', args: [tableName] }];
      queries.push(calls);
      const response = responses.shift() ?? {};
      const settle = () =>
        Promise.resolve({ data: response.data ?? null, error: response.error ?? null });
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'insert', 'update', 'eq', 'is', 'order']) {
        query[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return query;
        };
      }
      query.single = query.maybeSingle = () => settle();
      query.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        settle().then(resolve, reject);
      return query;
    }),
  };
  return { client: client as unknown as AppSupabaseClient, queries };
}

const NOW = new Date('2026-10-10T12:00:00.000Z');
const row = {
  id: 'b1',
  title: 'Los almendros',
  author: 'Marta',
  genre: 'Novela',
  page_count: 312,
  cover_path: null,
  cover_source: null,
  reading_status: 'reading',
  current_page: 214,
  rating: 4,
  notes: null,
  lent_to: null,
  lent_at: null,
  status_changed_at: '2026-10-02T09:00:00.000Z',
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-03T09:00:00.000Z',
};

function repoWith(responses: Response[]) {
  const { client, queries } = fakeClient(responses);
  const repo = createSupabaseBookRepository({ getClient: () => client, now: () => NOW });
  const find = (q: number, method: string) => queries[q].find((c) => c.method === method)?.args;
  return { repo, queries, find };
}

describe('supabaseBookRepository', () => {
  it('lists non-deleted books, most recent first', async () => {
    const { repo, find } = repoWith([{ data: [row] }]);
    const result = await repo.list();
    expect(result).toMatchObject({ ok: true, data: [{ id: 'b1', currentPage: 214 }] });
    expect(find(0, 'from')).toEqual(['user_books']);
    expect(find(0, 'is')).toEqual(['deleted_at', null]);
    expect(find(0, 'order')).toEqual(['updated_at', { ascending: false }]);
  });

  it('creates with a generated id and status_changed_at', async () => {
    const { repo, find } = repoWith([{ data: { ...row, id: 'generated-uuid' } }]);
    const result = await repo.create({ title: 'Los almendros', readingStatus: 'reading' });
    expect(result).toMatchObject({ ok: true, data: { id: 'generated-uuid' } });
    expect(find(0, 'insert')?.[0]).toMatchObject({
      id: 'generated-uuid',
      title: 'Los almendros',
      reading_status: 'reading',
      status_changed_at: NOW.toISOString(),
    });
  });

  it('keeps a client-provided id', async () => {
    const { repo, find } = repoWith([{ data: row }]);
    await repo.create({ id: 'client-id', title: 'X' });
    expect(find(0, 'insert')?.[0]).toMatchObject({ id: 'client-id' });
  });

  it('rejects invalid input before calling the server', async () => {
    const { repo, queries } = repoWith([]);
    await expect(repo.create({ title: ' ', rating: 9 })).resolves.toEqual({
      ok: false,
      error: 'validation_failed',
      issues: ['title_required', 'rating_invalid'],
    });
    expect(queries).toHaveLength(0);
  });

  it('updates and sets status_changed_at only when the status changes', async () => {
    const changed = repoWith([{ data: row }, { data: { ...row, reading_status: 'finished' } }]);
    await changed.repo.update('b1', { readingStatus: 'finished' });
    expect(changed.find(1, 'update')?.[0]).toEqual({
      reading_status: 'finished',
      status_changed_at: NOW.toISOString(),
    });
    expect(changed.find(1, 'eq')).toEqual(['id', 'b1']);

    const same = repoWith([{ data: row }, { data: row }]);
    await same.repo.update('b1', { readingStatus: 'reading', rating: 5 });
    expect(same.find(1, 'update')?.[0]).toEqual({ reading_status: 'reading', rating: 5 });
  });

  it('validates the merged book on update (current page vs stored page count)', async () => {
    const { repo, queries } = repoWith([{ data: row }]);
    await expect(repo.update('b1', { currentPage: 400 })).resolves.toEqual({
      ok: false,
      error: 'validation_failed',
      issues: ['current_page_exceeds_total'],
    });
    expect(queries).toHaveLength(1);
  });

  it('returns not_found when updating a missing book', async () => {
    const { repo } = repoWith([{ data: null }]);
    await expect(repo.update('nope', { rating: 3 })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('soft deletes by setting deleted_at', async () => {
    const { repo, find } = repoWith([{ data: { id: 'b1' } }]);
    await expect(repo.softDelete('b1')).resolves.toEqual({ ok: true, data: null });
    expect(find(0, 'update')?.[0]).toEqual({ deleted_at: NOW.toISOString() });
    expect(find(0, 'is')).toEqual(['deleted_at', null]);
  });

  it('sets and clears loans', async () => {
    const lend = repoWith([{ data: { ...row, lent_to: 'Laura', lent_at: NOW.toISOString() } }]);
    const lent = await lend.repo.setLoan('b1', '  Laura ');
    expect(lend.find(0, 'update')?.[0]).toEqual({ lent_to: 'Laura', lent_at: NOW.toISOString() });
    expect(lent).toMatchObject({ ok: true, data: { lentTo: 'Laura' } });

    const clear = repoWith([{ data: row }]);
    await clear.repo.clearLoan('b1');
    expect(clear.find(0, 'update')?.[0]).toEqual({ lent_to: null, lent_at: null });

    await expect(repoWith([]).repo.setLoan('b1', ' ')).resolves.toEqual({
      ok: false,
      error: 'validation_failed',
      issues: ['lent_to_required'],
    });
  });

  it('maps server and network errors', async () => {
    const rls = repoWith([
      { error: { code: '42501', message: 'new row violates row-level security' } },
    ]);
    await expect(rls.repo.list()).resolves.toEqual({ ok: false, error: 'unauthorized' });

    const throwing = createSupabaseBookRepository({
      getClient: () => {
        throw new TypeError('Network request failed');
      },
    });
    await expect(throwing.getById('b1')).resolves.toEqual({ ok: false, error: 'network_error' });
  });

  it.each([
    [{ message: 'TypeError: Network request failed' }, 'network_error'],
    [{ code: 'PGRST116' }, 'not_found'],
    [{ code: 'PGRST301' }, 'unauthorized'],
    [{ statusCode: '403', message: 'denied' }, 'unauthorized'],
    [{ code: '23514' }, 'validation_failed'],
    [{ code: '23505' }, 'unknown'],
    [null, 'unknown'],
  ] as const)('mapBookError(%p) -> %s', (error, expected) => {
    expect(mapBookError(error)).toBe(expected);
  });
});
