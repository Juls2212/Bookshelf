// Remote gateway for the recommendations table, used only by the sync engine. RLS scopes every
// query to the signed-in user. Rows are created by the Edge Function; the app only reads the
// latest ones and updates their disposition.
import {
  REMOTE_TIMEOUT_MS,
  toCause,
  withTimeout,
  type RemoteResult,
} from '@/features/library/supabaseBookGateway';
import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';
import type { RecommendationDisposition } from '@/types/database';

import type { RemoteRecommendation } from './localRecommendations';

/**
 * All columns: the discovery ones (7.5) only exist once its SQL ran, and `*` keeps the pull
 * working before that (rows then read as shelf recommendations).
 */
const RECOMMENDATION_COLUMNS = '*';

export interface RecommendationSyncGateway {
  /** The user's newest recommendations (newest first). */
  pullRecent(limit: number): Promise<RemoteResult<RemoteRecommendation[]>>;
  /** Updates the disposition; null when the row no longer exists on the server. */
  pushDisposition(
    id: string,
    disposition: RecommendationDisposition,
  ): Promise<RemoteResult<RemoteRecommendation | null>>;
}

function createSupabaseRecommendationGateway(
  getClient: () => AppSupabaseClient = getSupabaseClient,
  timeoutMs = REMOTE_TIMEOUT_MS,
): RecommendationSyncGateway {
  return {
    pullRecent(limit) {
      return withTimeout(
        (async (): Promise<RemoteResult<RemoteRecommendation[]>> => {
          try {
            const { data, error, status } = await getClient()
              .from('recommendations')
              .select(RECOMMENDATION_COLUMNS)
              .order('created_at', { ascending: false })
              .limit(limit);
            if (error) return { ok: false, cause: toCause(error, status) };
            return { ok: true, data: (data ?? []) as RemoteRecommendation[] };
          } catch (error) {
            return { ok: false, cause: toCause(error) };
          }
        })(),
        timeoutMs,
      );
    },

    pushDisposition(id, disposition) {
      return withTimeout(
        (async (): Promise<RemoteResult<RemoteRecommendation | null>> => {
          try {
            const { data, error, status } = await getClient()
              .from('recommendations')
              .update({ disposition })
              .eq('id', id)
              .select(RECOMMENDATION_COLUMNS)
              .maybeSingle();
            if (error) return { ok: false, cause: toCause(error, status) };
            return { ok: true, data: (data as RemoteRecommendation | null) ?? null };
          } catch (error) {
            return { ok: false, cause: toCause(error) };
          }
        })(),
        timeoutMs,
      );
    },
  };
}

export const supabaseRecommendationGateway = createSupabaseRecommendationGateway();
