// Library data contract. UI and stores depend on this interface only, so the Supabase
// implementation can be replaced by a local SQLite one (Phase 5) without touching screens.
import { t } from '@/i18n';
import type { Book, CoverSource, ReadingStatus } from '@/types/book';

import type { BookValidationCode } from './bookValidation';

export type BookErrorCode =
  'not_found' | 'network_error' | 'unauthorized' | 'validation_failed' | 'unknown';

export type BookResult<T> =
  { ok: true; data: T } | { ok: false; error: BookErrorCode; issues?: BookValidationCode[] };

/** Fields a client can set when creating a book. `id` is generated when missing. */
export type NewBook = {
  id?: string;
  title: string;
  author?: string | null;
  genre?: string | null;
  pageCount?: number | null;
  coverPath?: string | null;
  coverSource?: CoverSource | null;
  readingStatus?: ReadingStatus;
  currentPage?: number | null;
  rating?: number | null;
  notes?: string | null;
  /** Local cover file; setting it queues the upload of the cover. */
  localCoverUri?: string | null;
};

/** Partial update. Loans have dedicated methods (`setLoan` / `clearLoan`). */
export type BookPatch = Partial<Omit<NewBook, 'id'>>;

export interface BookRepository {
  /** Every non-deleted book of the signed-in user, most recently updated first. */
  list(): Promise<BookResult<Book[]>>;
  getById(id: string): Promise<BookResult<Book>>;
  create(input: NewBook): Promise<BookResult<Book>>;
  update(id: string, patch: BookPatch): Promise<BookResult<Book>>;
  /** Soft delete (sets deleted_at) so the deletion can sync to other devices. */
  softDelete(id: string): Promise<BookResult<null>>;
  setLoan(id: string, lentTo: string): Promise<BookResult<Book>>;
  clearLoan(id: string): Promise<BookResult<Book>>;
}

export function bookErrorMessage(code: BookErrorCode): string {
  return t.bookErrors[code];
}
