// First download of the user's books into SQLite (runs once per user and device).
// Offline or failed: nothing is marked done, so it is retried on the next app start.
import type { SqlDatabase, SqlExecutor, SqlValue } from '@/db/sql';
import { getMeta, setMeta } from '@/db/syncQueue';
import type { UserBookRow } from '@/types/database';

import { REMOTE_COLUMNS } from './localBookRow';
import type { BookRemoteGateway } from './supabaseBookGateway';

const PULL_PAGE_SIZE = 200;
/** A hanging network must not keep the app waiting on the first screen. */
const PULL_PAGE_TIMEOUT_MS = 15000;

type PullOutcome = 'done' | 'skipped' | 'failed';

const UPSERT_REMOTE_SQL = `INSERT INTO books (${REMOTE_COLUMNS.join(', ')}, local_cover_uri, sync_state, local_updated_at)
  VALUES (${REMOTE_COLUMNS.map(() => '?').join(', ')}, NULL, 'synced', NULL)
  ON CONFLICT (id) DO UPDATE SET ${REMOTE_COLUMNS.filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')},
    local_cover_uri = CASE WHEN excluded.cover_path IS NULL THEN NULL ELSE books.local_cover_uri END,
    sync_state = 'synced'
  WHERE books.sync_state <> 'pending'`;

/**
 * Stores a server row unless the local copy has unsynced changes (local edits win).
 * Returns the number of rows written (0 when a pending local row was kept).
 */
export async function upsertRemoteRow(tx: SqlExecutor, row: UserBookRow): Promise<number> {
  const result = await tx.runAsync(
    UPSERT_REMOTE_SQL,
    REMOTE_COLUMNS.map((c) => (row[c] ?? null) as SqlValue),
  );
  return result.changes;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function runInitialPull(
  db: SqlDatabase,
  gateway: BookRemoteGateway,
  {
    now = () => new Date(),
    pageSize = PULL_PAGE_SIZE,
    pageTimeoutMs = PULL_PAGE_TIMEOUT_MS,
  }: { now?: () => Date; pageSize?: number; pageTimeoutMs?: number } = {},
): Promise<PullOutcome> {
  if ((await getMeta(db, 'initial_pull_done')) === 'true') return 'skipped';
  // The incremental sync continues from the newest server updated_at seen (server clock, so
  // device clock skew does not matter); with no rows, from the moment the pull started.
  const startedAt = now().toISOString();
  let cursor: number | null = null;

  for (let offset = 0; ; offset += pageSize) {
    const page = await withTimeout(gateway.pullPage(offset, pageSize), pageTimeoutMs, {
      ok: false as const,
      error: 'network_error' as const,
    });
    if (!page.ok) return 'failed';
    // One transaction per page.
    await db.transaction(async (tx) => {
      for (const row of page.data) {
        await upsertRemoteRow(tx, row);
        cursor = Math.max(cursor ?? 0, Date.parse(row.updated_at));
      }
    });
    if (page.data.length < pageSize) break;
  }

  await db.transaction(async (tx) => {
    await setMeta(tx, 'initial_pull_done', 'true');
    await setMeta(tx, 'last_pull_at', cursor !== null ? new Date(cursor).toISOString() : startedAt);
  });
  return 'done';
}
