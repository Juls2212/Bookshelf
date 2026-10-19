import { createSupabaseProfileGateway } from '@/features/profile/supabaseProfileGateway';
import type { AppSupabaseClient } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const row = {
  id: 'user-1',
  display_name: 'Ana',
  theme: 'dark',
  avatar_path: null,
  avatar_updated_at: null,
  created_at: '2026-10-01T12:00:00.000Z',
  updated_at: '2026-10-02T12:00:00.000Z',
};

/** Chainable PostgREST query mock: builder methods return itself; terminals resolve. */
function gatewayWith(result: { data?: unknown; error?: unknown; status?: number }) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'update', 'eq']) query[method] = jest.fn(() => query);
  const resolved = async () => ({
    data: result.data ?? null,
    error: result.error ?? null,
    status: result.status ?? 200,
  });
  query.maybeSingle = jest.fn(resolved);
  query.single = jest.fn(resolved);
  const client = { from: jest.fn(() => query) } as unknown as AppSupabaseClient;
  return { gateway: createSupabaseProfileGateway(() => client), client, query };
}

describe('supabaseProfileGateway', () => {
  it('pulls the profile of the given user', async () => {
    const { gateway, client, query } = gatewayWith({ data: row });
    await expect(gateway.pullProfile('user-1')).resolves.toEqual({ ok: true, data: row });
    expect(client.from).toHaveBeenCalledWith('profiles');
    expect(query.eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('returns null when the row does not exist or RLS hides it', async () => {
    const { gateway } = gatewayWith({ data: null });
    await expect(gateway.pullProfile('user-1')).resolves.toEqual({ ok: true, data: null });
  });

  it('pushes name, theme and photo columns (never updated_at) and returns the server row', async () => {
    const { gateway, query } = gatewayWith({ data: row });
    await expect(
      gateway.pushProfile('user-1', {
        display_name: 'Ana',
        theme: 'dark',
        avatar_path: 'user-1/avatar.jpg',
        avatar_updated_at: '2026-10-02T11:00:00.000Z',
      }),
    ).resolves.toEqual({ ok: true, data: row });
    expect(query.update).toHaveBeenCalledWith({
      display_name: 'Ana',
      theme: 'dark',
      avatar_path: 'user-1/avatar.jpg',
      avatar_updated_at: '2026-10-02T11:00:00.000Z',
    });
    expect(query.eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('returns a classifiable cause instead of throwing', async () => {
    const { gateway, query } = gatewayWith({
      error: { code: '42501', message: 'denied' },
      status: 403,
    });
    await expect(
      gateway.pushProfile('user-1', {
        display_name: 'A',
        theme: 'light',
        avatar_path: null,
        avatar_updated_at: null,
      }),
    ).resolves.toMatchObject({ ok: false, cause: { code: '42501', status: 403 } });
    query.maybeSingle.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(gateway.pullProfile('user-1')).resolves.toMatchObject({
      ok: false,
      cause: { message: 'Network request failed' },
    });
  });
});
