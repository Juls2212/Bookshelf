// Local reading log (SQLite table `reading_events`, schema v8): writes, remote merge and the
// per-day sums the "Tu lectura" card needs.
import type { SqlExecutor } from '@/db/sql';
import type { ReadingEventRow } from '@/types/database';

export type LocalReadingEventRow = Omit<ReadingEventRow, 'created_at'> & {
  created_at: string | null;
  sync_state: 'synced' | 'pending';
  local_updated_at: string | null;
};

/** A new local event, pending until pushed. */
export async function insertLocalEvent(
  tx: SqlExecutor,
  event: Omit<ReadingEventRow, 'created_at'>,
): Promise<void> {
  await tx.runAsync(
    `INSERT INTO reading_events (id, user_id, book_id, pages_delta, local_date, occurred_at,
       created_at, sync_state, local_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 'pending', ?)`,
    [
      event.id,
      event.user_id,
      event.book_id,
      event.pages_delta,
      event.local_date,
      event.occurred_at,
      event.occurred_at,
    ],
  );
}

export function getLocalEvent(db: SqlExecutor, id: string): Promise<LocalReadingEventRow | null> {
  return db.getFirstAsync<LocalReadingEventRow>('SELECT * FROM reading_events WHERE id = ?', [id]);
}

/**
 * Merges a pulled event by id: inserted when new; an own pushed copy only gets the server's
 * created_at. Events never change otherwise (append-only). Returns the number of rows written.
 */
export async function upsertRemoteEvent(tx: SqlExecutor, row: ReadingEventRow): Promise<number> {
  const result = await tx.runAsync(
    `INSERT INTO reading_events (id, user_id, book_id, pages_delta, local_date, occurred_at,
       created_at, sync_state, local_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', ?)
     ON CONFLICT (id) DO UPDATE SET created_at = excluded.created_at
     WHERE reading_events.created_at IS NULL`,
    [
      row.id,
      row.user_id,
      row.book_id,
      row.pages_delta,
      row.local_date,
      row.occurred_at,
      row.created_at,
      row.occurred_at,
    ],
  );
  return result.changes;
}

/** Signed sum of pages_delta per local date ("YYYY-MM-DD" -> pages) for the user. */
export async function dailyPageTotals(
  db: SqlExecutor,
  userId: string,
): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ local_date: string; pages: number }>(
    `SELECT local_date, SUM(pages_delta) AS pages FROM reading_events
     WHERE user_id = ? GROUP BY local_date`,
    [userId],
  );
  return Object.fromEntries(rows.map((row) => [row.local_date, Number(row.pages) || 0]));
}
