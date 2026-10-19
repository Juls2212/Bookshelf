// In-memory stand-in for the recommendations table, for sync tests.
import type { RemoteRecommendation } from '@/features/recommendations/localRecommendations';
import type { RecommendationSyncGateway } from '@/features/recommendations/supabaseRecommendationGateway';
import type { RecommendationDisposition } from '@/types/database';

export function fakeRecommendationServer(rows: RemoteRecommendation[] = []) {
  const table = new Map(rows.map((row) => [row.id, { ...row }]));
  const gateway = {
    pullRecent: jest.fn<
      ReturnType<RecommendationSyncGateway['pullRecent']>,
      Parameters<RecommendationSyncGateway['pullRecent']>
    >(async (limit) => ({
      ok: true,
      data: [...table.values()]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map((row) => ({ ...row })),
    })),
    pushDisposition: jest.fn<
      ReturnType<RecommendationSyncGateway['pushDisposition']>,
      [string, RecommendationDisposition]
    >(async (id, disposition) => {
      const row = table.get(id);
      if (!row) return { ok: true, data: null };
      row.disposition = disposition;
      return { ok: true, data: { ...row } };
    }),
  };
  return {
    gateway,
    row: (id: string) => table.get(id) ?? null,
    /** A row created by the Edge Function, or changed elsewhere. */
    put(row: RemoteRecommendation) {
      table.set(row.id, { ...row });
    },
  };
}
