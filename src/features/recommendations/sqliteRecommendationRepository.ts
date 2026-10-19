// Local-first recommendations: cached in the user's SQLite database. Disposition changes are
// saved there, marked pending and queued (entity 'recommendation') for the sync engine.
import { enqueueRecommendationUpdate } from '@/db/syncQueue';
import { librarySession, type LibrarySession } from '@/features/library/librarySession';
import { notifyLocalWrite } from '@/features/sync/localWrites';

import {
  getLocalRecommendation,
  HISTORY_LIMIT,
  listLocalRecommendations,
  localRowToRecommendation,
  setLocalDisposition,
  trimLocalRecommendations,
  upsertRemoteRecommendation,
} from './localRecommendations';
import type { RecommendationRepository } from './recommendationRepository';
import { changesDisposition, nextDisposition } from './recommendationRules';

type Deps = {
  session?: Pick<LibrarySession, 'current'>;
  now?: () => Date;
  /** Called after each queued local change (the sync engine schedules a push). */
  onWrite?: () => void;
};

export function createSqliteRecommendationRepository({
  session = librarySession,
  now = () => new Date(),
  onWrite = notifyLocalWrite,
}: Deps = {}): RecommendationRepository {
  /** The open database of `userId`, or null if another user (or nobody) is signed in. */
  const dbFor = async (userId: string) => {
    try {
      const active = await session.current();
      return active?.userId === userId ? active.db : null;
    } catch {
      return null;
    }
  };

  return {
    async saveNew(userId, recommendation, requestContext) {
      const db = await dbFor(userId);
      if (!db) return { ok: false, error: 'not_found' };
      try {
        const row = await db.transaction(async (tx) => {
          await upsertRemoteRecommendation(tx, {
            id: recommendation.recommendationId,
            user_id: userId,
            kind: 'shelf',
            user_book_id: recommendation.bookId,
            rationale: recommendation.rationale,
            request_context: requestContext,
            disposition: 'suggested',
            created_at: recommendation.createdAt,
          });
          await trimLocalRecommendations(tx, userId);
          return getLocalRecommendation(tx, recommendation.recommendationId);
        });
        return row
          ? { ok: true, data: localRowToRecommendation(row) }
          : { ok: false, error: 'unknown' };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },

    async saveDiscovery(userId, discovery, requestContext) {
      const db = await dbFor(userId);
      if (!db) return { ok: false, error: 'not_found' };
      try {
        const row = await db.transaction(async (tx) => {
          await upsertRemoteRecommendation(tx, {
            id: discovery.recommendationId,
            user_id: userId,
            kind: 'discovery',
            user_book_id: null,
            suggested_title: discovery.title,
            suggested_author: discovery.author,
            suggested_genre: discovery.genre,
            suggested_page_count: discovery.pageCount,
            suggestion_verified: discovery.verified,
            rationale: discovery.rationale,
            // The confidence has no column: it travels in the request context, as on the server.
            request_context: { ...requestContext, confidence: discovery.confidence },
            disposition: 'suggested',
            created_at: discovery.createdAt,
          });
          await trimLocalRecommendations(tx, userId);
          return getLocalRecommendation(tx, discovery.recommendationId);
        });
        return row
          ? { ok: true, data: localRowToRecommendation(row) }
          : { ok: false, error: 'unknown' };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },

    async listHistory(userId, limit = HISTORY_LIMIT) {
      const db = await dbFor(userId);
      if (!db) return { ok: false, error: 'not_found' };
      try {
        const rows = await listLocalRecommendations(db, userId, limit);
        return { ok: true, data: rows.map(localRowToRecommendation) };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },

    async updateDisposition(userId, recommendationId, disposition) {
      const db = await dbFor(userId);
      if (!db) return { ok: false, error: 'not_found' };
      try {
        const nowIso = now().toISOString();
        const outcome = await db.transaction(async (tx) => {
          const current = await getLocalRecommendation(tx, recommendationId);
          if (!current || current.user_id !== userId) return null;
          if (!changesDisposition(current.disposition, disposition)) {
            return { row: current, queued: false };
          }
          await setLocalDisposition(
            tx,
            recommendationId,
            nextDisposition(current.disposition, disposition),
            nowIso,
          );
          await enqueueRecommendationUpdate(tx, recommendationId, nowIso);
          return { row: await getLocalRecommendation(tx, recommendationId), queued: true };
        });
        if (!outcome?.row) return { ok: false, error: 'not_found' };
        if (outcome.queued) onWrite();
        return { ok: true, data: localRowToRecommendation(outcome.row) };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },
  };
}

export const sqliteRecommendationRepository: RecommendationRepository =
  createSqliteRecommendationRepository();
