import {
  createSupabaseProfileRepository,
  mapProfileError,
} from '@/features/profile/profileRepository';
import type { AppSupabaseClient } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const row = {
  id: 'user-1',
  display_name: 'Ana',
  theme: 'dark',
  created_at: '2026-10-01T12:00:00.000Z',
  updated_at: '2026-10-01T12:00:00.000Z',
};

/** Chainable PostgREST query mock: every builder method returns itself; awaiting resolves. */
function queryMock(result: { data?: unknown; error?: unknown }) {
  const query: Record<string, jest.Mock> & { then?: unknown } = {};
  for (const method of ['select', 'update', 'eq']) query[method] = jest.fn(() => query);
  query.maybeSingle = jest.fn(async () => ({
    data: result.data ?? null,
    error: result.error ?? null,
  }));
  query.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve);
  return query;
}

function repoWith(result: { data?: unknown; error?: unknown }) {
  const query = queryMock(result);
  const client = { from: jest.fn(() => query) } as unknown as AppSupabaseClient;
  return { repo: createSupabaseProfileRepository(() => client), client, query };
}

describe('profileRepository', () => {
  it('gets the profile of the given user', async () => {
    const { repo, client, query } = repoWith({ data: row });
    await expect(repo.getProfile('user-1')).resolves.toEqual({
      ok: true,
      data: { id: 'user-1', displayName: 'Ana', theme: 'dark', createdAt: row.created_at },
    });
    expect(client.from).toHaveBeenCalledWith('profiles');
    expect(query.eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('returns not_found when RLS hides the row or it does not exist', async () => {
    const { repo } = repoWith({ data: null });
    await expect(repo.getProfile('user-1')).resolves.toEqual({ ok: false, error: 'not_found' });
  });

  it('updates the trimmed display name and returns the new profile', async () => {
    const { repo, query } = repoWith({ data: { ...row, display_name: 'Ana María' } });
    const result = await repo.updateDisplayName('user-1', '  Ana María ');
    expect(query.update).toHaveBeenCalledWith({ display_name: 'Ana María' });
    expect(result).toMatchObject({ ok: true, data: { displayName: 'Ana María' } });
  });

  it('updates the theme', async () => {
    const { repo, query } = repoWith({});
    await expect(repo.updateTheme('user-1', 'light')).resolves.toEqual({ ok: true, data: null });
    expect(query.update).toHaveBeenCalledWith({ theme: 'light' });
    expect(query.eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('maps errors instead of throwing', async () => {
    const network = { message: 'TypeError: Network request failed', code: '' };
    await expect(repoWith({ error: network }).repo.updateTheme('u', 'dark')).resolves.toEqual({
      ok: false,
      error: 'network_error',
    });
    const throwing = createSupabaseProfileRepository(() => {
      throw new Error('boom');
    });
    await expect(throwing.getProfile('u')).resolves.toEqual({ ok: false, error: 'unknown' });
  });

  it('maps PostgREST codes', () => {
    expect(mapProfileError({ code: 'PGRST116', message: 'no rows' })).toBe('not_found');
    expect(mapProfileError({ code: '42501', message: 'permission denied' })).toBe('unknown');
    expect(mapProfileError(null)).toBe('unknown');
  });
});
