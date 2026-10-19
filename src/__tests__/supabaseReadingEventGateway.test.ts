import { createSupabaseReadingEventGateway } from '@/features/library/supabaseReadingEventGateway';
import type { AppSupabaseClient } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const event = {
  id: 'e1',
  user_id: 'user-1',
  book_id: 'b1',
  pages_delta: 12,
  local_date: '2026-10-14',
  occurred_at: '2026-10-14T09:00:00.000Z',
};

/** Chainable PostgREST query mock: builder methods return itself; it resolves when awaited. */
function gatewayWith(result: { data?: unknown; error?: unknown; status?: number }) {
  const resolved = {
    data: result.data ?? null,
    error: result.error ?? null,
    status: result.status ?? 200,
  };
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'upsert', 'gt', 'order', 'range']) {
    query[method] = jest.fn(() => query);
  }
  // Awaiting the builder runs the request.
  Object.assign(query, {
    then: (onFulfilled: (value: typeof resolved) => unknown) =>
      Promise.resolve(resolved).then(onFulfilled),
  });
  const client = { from: jest.fn(() => query) } as unknown as AppSupabaseClient;
  return { gateway: createSupabaseReadingEventGateway(() => client), client, query };
}

describe('supabaseReadingEventGateway', () => {
  it('inserts with the client id and ignores a duplicate (idempotent retries)', async () => {
    const { gateway, client, query } = gatewayWith({});
    await expect(gateway.pushEvent(event)).resolves.toEqual({ ok: true, data: null });
    expect(client.from).toHaveBeenCalledWith('reading_events');
    expect(query.upsert).toHaveBeenCalledWith(event, { onConflict: 'id', ignoreDuplicates: true });
  });

  it('pulls a page after the cursor in a stable order', async () => {
    const { gateway, query } = gatewayWith({ data: [{ ...event, created_at: 'x' }] });
    await expect(gateway.pullEventsSince('2026-10-14T00:00:00.000Z', 200, 200)).resolves.toEqual({
      ok: true,
      data: [{ ...event, created_at: 'x' }],
    });
    expect(query.gt).toHaveBeenCalledWith('created_at', '2026-10-14T00:00:00.000Z');
    expect(query.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: true });
    expect(query.order).toHaveBeenNthCalledWith(2, 'id', { ascending: true });
    expect(query.range).toHaveBeenCalledWith(200, 399);
  });

  it('returns a classifiable cause instead of throwing', async () => {
    const { gateway } = gatewayWith({ error: { code: '23503', message: 'fk' }, status: 409 });
    await expect(gateway.pushEvent(event)).resolves.toMatchObject({
      ok: false,
      cause: { code: '23503', status: 409 },
    });
  });
});
