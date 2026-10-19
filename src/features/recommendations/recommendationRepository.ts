// Recommendations data access contract (local cache and history). The store uses it, never
// Supabase or SQLite. New recommendations come from the Edge Function (recommendationService);
// the sync engine pushes disposition changes and pulls the latest ones.
import type { NewDiscovery } from './discoveryService';
import type { Disposition, Recommendation } from './recommendationRules';

type RecommendationErrorCode = 'not_found' | 'unknown';

export type RecommendationResult<T> =
  { ok: true; data: T } | { ok: false; error: RecommendationErrorCode };

/** What the Edge Function returned. */
export type NewRecommendation = {
  recommendationId: string;
  bookId: string;
  rationale: string;
  createdAt: string;
};

export interface RecommendationRepository {
  /** Stores a recommendation just returned by the server (already synced). */
  saveNew(
    userId: string,
    recommendation: NewRecommendation,
    requestContext: Record<string, unknown>,
  ): Promise<RecommendationResult<Recommendation>>;
  /** Stores a "Nuevas aventuras" suggestion just returned by the server (already synced). */
  saveDiscovery(
    userId: string,
    discovery: NewDiscovery,
    requestContext: Record<string, unknown>,
  ): Promise<RecommendationResult<Recommendation>>;
  /** Newest first, from the local cache (works offline). */
  listHistory(userId: string, limit?: number): Promise<RecommendationResult<Recommendation[]>>;
  /** Applies the disposition rules; saves locally and queues the change when it changes. */
  updateDisposition(
    userId: string,
    recommendationId: string,
    disposition: Disposition,
  ): Promise<RecommendationResult<Recommendation>>;
}
