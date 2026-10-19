// Remote gateway for the reading log (reading_events), used only by the sync engine. RLS scopes
// every query to the signed-in user. Insert-only: a repeated push of the same client id is
// ignored by the server (ON CONFLICT DO NOTHING), so retries are idempotent.
import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';
import type { ReadingEventInsert, ReadingEventRow } from '@/types/database';

import { REMOTE_TIMEOUT_MS, toCause, withTimeout, type RemoteResult } from './supabaseBookGateway';

const EVENT_COLUMNS = 'id, user_id, book_id, pages_delta, local_date, occurred_at, created_at';

export interface ReadingEventSyncGateway {
  /** Inserts the event; an event that already exists counts as done. */
  pushEvent(event: Omit<ReadingEventInsert, 'created_at'>): Promise<RemoteResult<null>>;
  /** One page of events inserted after `since` (server created_at), in a stable order. */
  pullEventsSince(
    since: string,
    offset: number,
    limit: number,
  ): Promise<RemoteResult<ReadingEventRow[]>>;
}

export function createSupabaseReadingEventGateway(
  getClient: () => AppSupabaseClient = getSupabaseClient,
  timeoutMs = REMOTE_TIMEOUT_MS,
): ReadingEventSyncGateway {
  return {
    pushEvent(event) {
      return withTimeout(
        (async (): Promise<RemoteResult<null>> => {
          try {
            const { error, status } = await getClient()
              .from('reading_events')
              .upsert(event, { onConflict: 'id', ignoreDuplicates: true });
            if (error) return { ok: false, cause: toCause(error, status) };
            return { ok: true, data: null };
          } catch (error) {
            return { ok: false, cause: toCause(error) };
          }
        })(),
        timeoutMs,
      );
    },

    pullEventsSince(since, offset, limit) {
      return withTimeout(
        (async (): Promise<RemoteResult<ReadingEventRow[]>> => {
          try {
            const { data, error, status } = await getClient()
              .from('reading_events')
              .select(EVENT_COLUMNS)
              .gt('created_at', since)
              .order('created_at', { ascending: true })
              .order('id', { ascending: true })
              .range(offset, offset + limit - 1);
            if (error) return { ok: false, cause: toCause(error, status) };
            return { ok: true, data: (data ?? []) as ReadingEventRow[] };
          } catch (error) {
            return { ok: false, cause: toCause(error) };
          }
        })(),
        timeoutMs,
      );
    },
  };
}

export const supabaseReadingEventGateway = createSupabaseReadingEventGateway();
