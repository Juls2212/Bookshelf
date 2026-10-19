// Local recommendations rows (SQLite table `recommendations`, schema v6) and their mapping.
// 'shelf' rows point to a book; 'discovery' rows carry a suggested book outside the shelf.
import type { SqlExecutor } from '@/db/sql';
import type { RecommendationKind } from '@/types/database';

import type {
  Confidence,
  Disposition,
  Recommendation,
  SuggestedBookInfo,
} from './recommendationRules';

type LocalRecommendationRow = {
  id: string;
  user_id: string;
  kind: RecommendationKind;
  /** Null for discovery rows. */
  book_id: string | null;
  suggested_title: string | null;
  suggested_author: string | null;
  suggested_genre: string | null;
  suggested_page_count: number | null;
  /** 1 = found in an open catalog, 0 = not found, null = not checked. */
  suggestion_verified: number | null;
  rationale: string;
  /** JSON object. */
  request_context: string;
  disposition: Disposition;
  created_at: string;
  sync_state: 'synced' | 'pending';
  local_updated_at: string | null;
};

/** How many recommendations the cache keeps (and the pull fetches). */
export const HISTORY_LIMIT = 50;

const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'];

/** The model's confidence is kept in request_context (there is no column for it). */
function confidenceIn(requestContext: string): Confidence | null {
  try {
    const value = (JSON.parse(requestContext) as { confidence?: unknown }).confidence;
    return CONFIDENCES.includes(value as Confidence) ? (value as Confidence) : null;
  } catch {
    return null;
  }
}

function suggestionOf(row: LocalRecommendationRow): SuggestedBookInfo | null {
  if (row.kind !== 'discovery' || !row.suggested_title) return null;
  return {
    title: row.suggested_title,
    author: row.suggested_author,
    genre: row.suggested_genre,
    pageCount: row.suggested_page_count,
    verified: row.suggestion_verified === null ? null : row.suggestion_verified === 1,
    confidence: confidenceIn(row.request_context),
  };
}

export function localRowToRecommendation(row: LocalRecommendationRow): Recommendation {
  return {
    id: row.id,
    kind: row.kind,
    bookId: row.kind === 'shelf' ? row.book_id : null,
    suggestion: suggestionOf(row),
    rationale: row.rationale,
    disposition: row.disposition,
    createdAt: row.created_at,
    pending: row.sync_state === 'pending',
  };
}

/**
 * The remote row as the local cache stores it. The discovery columns are optional: before the
 * 7.5 SQL runs on the server they do not exist, and the row is a shelf one.
 */
export type RemoteRecommendation = {
  id: string;
  user_id: string;
  user_book_id: string | null;
  rationale: string;
  request_context: unknown;
  disposition: Disposition;
  created_at: string;
  kind?: RecommendationKind | null;
  suggested_title?: string | null;
  suggested_author?: string | null;
  suggested_genre?: string | null;
  suggested_page_count?: number | null;
  suggestion_verified?: boolean | null;
};

/** A row the local table can hold (shelf rows need a book, discovery rows a title). */
function isStorableRecommendation(row: RemoteRecommendation): boolean {
  return (row.kind ?? 'shelf') === 'discovery'
    ? typeof row.suggested_title === 'string' && row.suggested_title.trim() !== ''
    : typeof row.user_book_id === 'string';
}

const contextJson = (value: unknown) =>
  JSON.stringify(typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {});

export function getLocalRecommendation(
  db: SqlExecutor,
  id: string,
): Promise<LocalRecommendationRow | null> {
  return db.getFirstAsync<LocalRecommendationRow>('SELECT * FROM recommendations WHERE id = ?', [
    id,
  ]);
}

/** Newest first. */
export function listLocalRecommendations(
  db: SqlExecutor,
  userId: string,
  limit = HISTORY_LIMIT,
): Promise<LocalRecommendationRow[]> {
  return db.getAllAsync<LocalRecommendationRow>(
    'SELECT * FROM recommendations WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    [userId, limit],
  );
}

/**
 * Stores a server row: new rows are inserted; known rows take the server disposition unless the
 * local copy has an unsynced change (local edits win until pushed). Returns rows written.
 */
export async function upsertRemoteRecommendation(
  tx: SqlExecutor,
  row: RemoteRecommendation,
): Promise<number> {
  if (!isStorableRecommendation(row)) return 0;
  const kind: RecommendationKind = row.kind === 'discovery' ? 'discovery' : 'shelf';
  const verified =
    typeof row.suggestion_verified === 'boolean' ? (row.suggestion_verified ? 1 : 0) : null;
  const result = await tx.runAsync(
    `INSERT INTO recommendations (id, user_id, kind, book_id, suggested_title, suggested_author,
       suggested_genre, suggested_page_count, suggestion_verified, rationale, request_context,
       disposition, created_at, sync_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
     ON CONFLICT (id) DO UPDATE SET disposition = excluded.disposition, sync_state = 'synced'
     WHERE recommendations.sync_state <> 'pending'
       AND recommendations.disposition <> excluded.disposition`,
    [
      row.id,
      row.user_id,
      kind,
      kind === 'shelf' ? row.user_book_id : null,
      kind === 'discovery' ? (row.suggested_title ?? null) : null,
      kind === 'discovery' ? (row.suggested_author ?? null) : null,
      kind === 'discovery' ? (row.suggested_genre ?? null) : null,
      kind === 'discovery' ? (row.suggested_page_count ?? null) : null,
      kind === 'discovery' ? verified : null,
      row.rationale,
      contextJson(row.request_context),
      row.disposition,
      row.created_at,
    ],
  );
  return result.changes;
}

/** A local disposition change: the row becomes pending. */
export async function setLocalDisposition(
  tx: SqlExecutor,
  id: string,
  disposition: Disposition,
  nowIso: string,
): Promise<number> {
  const result = await tx.runAsync(
    `UPDATE recommendations SET disposition = ?, sync_state = 'pending', local_updated_at = ?
     WHERE id = ?`,
    [disposition, nowIso, id],
  );
  return result.changes;
}

/** Keeps the newest HISTORY_LIMIT rows of the user (pending ones are never dropped). */
export async function trimLocalRecommendations(tx: SqlExecutor, userId: string): Promise<void> {
  await tx.runAsync(
    `DELETE FROM recommendations WHERE user_id = ? AND sync_state <> 'pending' AND id NOT IN (
       SELECT id FROM recommendations WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
     )`,
    [userId, userId, HISTORY_LIMIT],
  );
}
