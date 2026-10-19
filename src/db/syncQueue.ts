// Local sync queue (consumed by the sync engine) and sync metadata.
import type { SqlExecutor } from './sql';

export type SyncOperation =
  'upsert' | 'delete' | 'cover_upload' | 'cover_remove' | 'avatar_upload' | 'avatar_remove';

export type SyncEntity = 'book' | 'profile' | 'preferences' | 'recommendation' | 'reading_event';

export type SyncQueueEntry = {
  id: number;
  entity: SyncEntity;
  entity_id: string;
  operation: SyncOperation;
  attempts: number;
  last_error_code: string | null;
  next_attempt_at: string | null;
  created_at: string;
  /** 1 when the last error was permanent (no more automatic retries). */
  failed: number;
};

/**
 * Adds an operation for a book, coalesced per (entity_id, operation): repeating it only
 * resets the retry state. A delete supersedes a pending upsert (the delete pushes the final
 * row, including deleted_at); an upsert after a delete keeps the delete. A new cover and a
 * cover removal supersede each other (only the latest choice reaches the server).
 */
export async function enqueueBookOperation(
  tx: SqlExecutor,
  bookId: string,
  operation: SyncOperation,
  nowIso: string,
): Promise<void> {
  if (operation === 'upsert') {
    const deleted = await tx.getFirstAsync<{ id: number }>(
      "SELECT id FROM sync_queue WHERE entity = 'book' AND entity_id = ? AND operation = 'delete'",
      [bookId],
    );
    if (deleted) return;
  }
  if (operation === 'delete') {
    await tx.runAsync(
      "DELETE FROM sync_queue WHERE entity = 'book' AND entity_id = ? AND operation = 'upsert'",
      [bookId],
    );
  }
  if (operation === 'cover_upload' || operation === 'cover_remove') {
    await tx.runAsync(
      "DELETE FROM sync_queue WHERE entity = 'book' AND entity_id = ? AND operation = ?",
      [bookId, operation === 'cover_upload' ? 'cover_remove' : 'cover_upload'],
    );
  }
  await tx.runAsync(
    `INSERT INTO sync_queue (entity, entity_id, operation, attempts, created_at)
     VALUES ('book', ?, ?, 0, ?)
     ON CONFLICT (entity, entity_id, operation)
     DO UPDATE SET attempts = 0, last_error_code = NULL, next_attempt_at = NULL, failed = 0`,
    [bookId, operation, nowIso],
  );
}

/** Queues the user's profile for push (one coalesced entry; repeating it resets retries). */
export async function enqueueProfileUpsert(
  tx: SqlExecutor,
  userId: string,
  nowIso: string,
): Promise<void> {
  await tx.runAsync(
    `INSERT INTO sync_queue (entity, entity_id, operation, attempts, created_at)
     VALUES ('profile', ?, 'upsert', 0, ?)
     ON CONFLICT (entity, entity_id, operation)
     DO UPDATE SET attempts = 0, last_error_code = NULL, next_attempt_at = NULL, failed = 0`,
    [userId, nowIso],
  );
}

/**
 * Queues the profile photo change plus the profile row that carries its path. Upload and
 * removal supersede each other: only the latest choice is sent.
 */
export async function enqueueAvatarChange(
  tx: SqlExecutor,
  userId: string,
  operation: 'avatar_upload' | 'avatar_remove',
  nowIso: string,
): Promise<void> {
  const opposite = operation === 'avatar_upload' ? 'avatar_remove' : 'avatar_upload';
  await tx.runAsync(
    "DELETE FROM sync_queue WHERE entity = 'profile' AND entity_id = ? AND operation = ?",
    [userId, opposite],
  );
  await tx.runAsync(
    `INSERT INTO sync_queue (entity, entity_id, operation, attempts, created_at)
     VALUES ('profile', ?, ?, 0, ?)
     ON CONFLICT (entity, entity_id, operation)
     DO UPDATE SET attempts = 0, last_error_code = NULL, next_attempt_at = NULL, failed = 0`,
    [userId, operation, nowIso],
  );
  await enqueueProfileUpsert(tx, userId, nowIso);
}

/** Queues the user's reading preferences (one coalesced entry; repeating it resets retries). */
export async function enqueuePreferencesUpsert(
  tx: SqlExecutor,
  userId: string,
  nowIso: string,
): Promise<void> {
  await tx.runAsync(
    `INSERT INTO sync_queue (entity, entity_id, operation, attempts, created_at)
     VALUES ('preferences', ?, 'upsert', 0, ?)
     ON CONFLICT (entity, entity_id, operation)
     DO UPDATE SET attempts = 0, last_error_code = NULL, next_attempt_at = NULL, failed = 0`,
    [userId, nowIso],
  );
}

/** Queues a recommendation's disposition (one coalesced entry per recommendation). */
export async function enqueueRecommendationUpdate(
  tx: SqlExecutor,
  recommendationId: string,
  nowIso: string,
): Promise<void> {
  await tx.runAsync(
    `INSERT INTO sync_queue (entity, entity_id, operation, attempts, created_at)
     VALUES ('recommendation', ?, 'upsert', 0, ?)
     ON CONFLICT (entity, entity_id, operation)
     DO UPDATE SET attempts = 0, last_error_code = NULL, next_attempt_at = NULL, failed = 0`,
    [recommendationId, nowIso],
  );
}

/** Queues a new reading event (insert-only on the server; idempotent by its client id). */
export async function enqueueReadingEvent(
  tx: SqlExecutor,
  eventId: string,
  nowIso: string,
): Promise<void> {
  await tx.runAsync(
    `INSERT INTO sync_queue (entity, entity_id, operation, attempts, created_at)
     VALUES ('reading_event', ?, 'upsert', 0, ?)
     ON CONFLICT (entity, entity_id, operation) DO NOTHING`,
    [eventId, nowIso],
  );
}

/** Entries not yet pushed (pending and failed). */
export async function countSyncQueue(db: SqlExecutor): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_queue');
  return row?.n ?? 0;
}

export function listSyncQueue(db: SqlExecutor): Promise<SyncQueueEntry[]> {
  return db.getAllAsync<SyncQueueEntry>('SELECT * FROM sync_queue ORDER BY created_at, id');
}

type SyncMetaKey = 'last_pull_at' | 'initial_pull_done' | 'last_sync_at' | 'last_events_pull_at';

export async function getMeta(db: SqlExecutor, key: SyncMetaKey): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM sync_meta WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export async function setMeta(db: SqlExecutor, key: SyncMetaKey, value: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}
