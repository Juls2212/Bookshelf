// Local SQLite row of a book: the remote columns plus local-only sync columns.
import type { Book } from '@/types/book';
import type { UserBookRow } from '@/types/database';

import { rowToBook } from './bookMapper';

export type SyncState = 'synced' | 'pending';

export type LocalBookRow = UserBookRow & {
  local_cover_uri: string | null;
  sync_state: SyncState;
  local_updated_at: string | null;
};

/** Columns shared with the remote table, in a fixed order. */
export const REMOTE_COLUMNS = [
  'id',
  'user_id',
  'title',
  'author',
  'genre',
  'page_count',
  'cover_path',
  'cover_source',
  'reading_status',
  'current_page',
  'rating',
  'notes',
  'lent_to',
  'lent_at',
  'status_changed_at',
  'created_at',
  'updated_at',
  'deleted_at',
] as const satisfies readonly (keyof UserBookRow)[];

export const LOCAL_COLUMNS = [
  ...REMOTE_COLUMNS,
  'local_cover_uri',
  'sync_state',
  'local_updated_at',
] as const satisfies readonly (keyof LocalBookRow)[];

export function localRowToBook(row: LocalBookRow): Book {
  return { ...rowToBook(row), localCoverUri: row.local_cover_uri ?? null };
}
