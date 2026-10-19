// Remote gateway for user_books. The app reads and writes the local SQLite database; only the
// initial pull and the sync engine use this gateway.
// RLS scopes every query to the signed-in user. Never logs row contents.
import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';
import type { UserBookRow } from '@/types/database';

import type { RemoteCause } from '@/features/sync/syncErrors';

import type { BookErrorCode, BookResult } from './bookRepository';

/** Maps PostgREST, Storage and fetch errors to internal codes. */
export function mapBookError(error: unknown): BookErrorCode {
  if (error === null || typeof error !== 'object') return 'unknown';
  const e = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const status = Number(e.status ?? e.statusCode);

  if (
    e.name === 'AbortError' ||
    message.includes('network request failed') ||
    message.includes('failed to fetch')
  ) {
    return 'network_error';
  }
  if (code === 'PGRST116') return 'not_found';
  // 42501: RLS/privileges; PGRST301/302: missing or expired JWT.
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST302') return 'unauthorized';
  if (status === 401 || status === 403) return 'unauthorized';
  // Check, not-null, invalid input and numeric range violations.
  if (['23514', '23502', '22P02', '22003'].includes(code)) return 'validation_failed';
  return 'unknown';
}

/** Every column, including user_id and deleted_at (soft-deleted rows are pulled too). */
const REMOTE_BOOK_COLUMNS =
  'id, user_id, title, author, genre, page_count, cover_path, cover_source, reading_status, current_page, rating, notes, lent_to, lent_at, status_changed_at, created_at, updated_at, deleted_at';

/** Row sent on push: every column except updated_at, which the server sets (trigger). */
export type RemoteBookUpsert = Omit<UserBookRow, 'updated_at'>;

/** Failure keeps only what classification needs (never logged as-is). */
export type RemoteResult<T> = { ok: true; data: T } | { ok: false; cause: RemoteCause };

export const REMOTE_TIMEOUT_MS = 20_000;

export interface BookRemoteGateway {
  /** One page of the user's rows in a stable order (created_at, id). */
  pullPage(offset: number, limit: number): Promise<BookResult<UserBookRow[]>>;
}

export interface BookSyncGateway {
  /** Insert or update by id (soft delete = the row with deleted_at). Returns the server row. */
  upsertBook(row: RemoteBookUpsert): Promise<RemoteResult<UserBookRow>>;
  /** Rows with updated_at > since (including soft-deleted), oldest first. */
  pullChangedSince(
    since: string,
    offset: number,
    limit: number,
  ): Promise<RemoteResult<UserBookRow[]>>;
  /** Refreshes an expired session once; true when a new token was obtained. */
  refreshSession(): Promise<boolean>;
}

export function toCause(error: unknown, status?: number): RemoteCause {
  if (error === null || typeof error !== 'object') return { status };
  const e = error as RemoteCause;
  return {
    name: e.name,
    code: e.code,
    message: e.message,
    status: status ?? e.status ?? e.statusCode,
  };
}

export async function withTimeout<T>(
  task: Promise<RemoteResult<T>>,
  ms: number,
): Promise<RemoteResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RemoteResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, cause: { name: 'TimeoutError' } }), ms);
  });
  return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
}

export function createSupabaseBookGateway(
  getClient: () => AppSupabaseClient = getSupabaseClient,
  timeoutMs = REMOTE_TIMEOUT_MS,
): BookRemoteGateway & BookSyncGateway {
  return {
    upsertBook(row) {
      return withTimeout(
        (async (): Promise<RemoteResult<UserBookRow>> => {
          try {
            const { data, error, status } = await getClient()
              .from('user_books')
              .upsert(row, { onConflict: 'id' })
              .select(REMOTE_BOOK_COLUMNS)
              .single();
            if (error || !data) return { ok: false, cause: toCause(error, status) };
            return { ok: true, data: data as UserBookRow };
          } catch (error) {
            return { ok: false, cause: toCause(error) };
          }
        })(),
        timeoutMs,
      );
    },

    pullChangedSince(since, offset, limit) {
      return withTimeout(
        (async (): Promise<RemoteResult<UserBookRow[]>> => {
          try {
            const { data, error, status } = await getClient()
              .from('user_books')
              .select(REMOTE_BOOK_COLUMNS)
              .gt('updated_at', since)
              .order('updated_at', { ascending: true })
              .order('id', { ascending: true })
              .range(offset, offset + limit - 1);
            if (error) return { ok: false, cause: toCause(error, status) };
            return { ok: true, data: (data ?? []) as UserBookRow[] };
          } catch (error) {
            return { ok: false, cause: toCause(error) };
          }
        })(),
        timeoutMs,
      );
    },

    async refreshSession() {
      try {
        const { data, error } = await getClient().auth.refreshSession();
        return !error && Boolean(data.session);
      } catch {
        return false;
      }
    },

    async pullPage(offset, limit) {
      try {
        const { data, error } = await getClient()
          .from('user_books')
          .select(REMOTE_BOOK_COLUMNS)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, offset + limit - 1);
        if (error) return { ok: false, error: mapBookError(error) };
        return { ok: true, data: (data ?? []) as UserBookRow[] };
      } catch (error) {
        return { ok: false, error: mapBookError(error) };
      }
    },
  };
}

export const supabaseBookGateway = createSupabaseBookGateway();
