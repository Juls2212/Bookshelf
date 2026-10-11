// snake_case rows <-> camelCase `Book`. Null-safe and free of I/O.
import type { Book } from '@/types/book';
import type { UserBookInsert, UserBookRow, UserBookUpdate } from '@/types/database';

import type { BookPatch, NewBook } from './bookRepository';

/** Columns read by the app (excludes user_id and deleted_at). */
export const BOOK_COLUMNS =
  'id, title, author, genre, page_count, cover_path, cover_source, reading_status, current_page, rating, notes, lent_to, lent_at, status_changed_at, created_at, updated_at';

export type BookRowSelection = Omit<UserBookRow, 'user_id' | 'deleted_at'>;

/** Trims optional text; blank becomes null. */
function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function rowToBook(row: BookRowSelection): Book {
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? null,
    genre: row.genre ?? null,
    pageCount: row.page_count ?? null,
    coverPath: row.cover_path ?? null,
    coverSource: row.cover_source ?? null,
    readingStatus: row.reading_status,
    currentPage: row.current_page ?? 0,
    rating: row.rating ?? null,
    notes: row.notes ?? null,
    lentTo: row.lent_to ?? null,
    lentAt: row.lent_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    statusChangedAt: row.status_changed_at ?? null,
  };
}

/** Insert payload. `user_id` is left to the database default (auth.uid()). */
export function newBookToInsert(input: NewBook & { id: string }, nowIso: string): UserBookInsert {
  return {
    id: input.id,
    title: input.title.trim(),
    author: cleanText(input.author),
    genre: cleanText(input.genre),
    page_count: input.pageCount ?? null,
    cover_path: input.coverPath ?? null,
    cover_source: input.coverSource ?? null,
    reading_status: input.readingStatus ?? 'to_read',
    current_page: input.currentPage ?? 0,
    rating: input.rating ?? null,
    notes: cleanText(input.notes),
    status_changed_at: nowIso,
  };
}

/** Update payload with only the keys present in the patch. */
export function patchToUpdate(patch: BookPatch): UserBookUpdate {
  const update: UserBookUpdate = {};
  if (patch.title !== undefined) update.title = patch.title.trim();
  if (patch.author !== undefined) update.author = cleanText(patch.author);
  if (patch.genre !== undefined) update.genre = cleanText(patch.genre);
  if (patch.pageCount !== undefined) update.page_count = patch.pageCount;
  if (patch.coverPath !== undefined) update.cover_path = patch.coverPath;
  if (patch.coverSource !== undefined) update.cover_source = patch.coverSource;
  if (patch.readingStatus !== undefined) update.reading_status = patch.readingStatus;
  if (patch.currentPage !== undefined) update.current_page = patch.currentPage ?? 0;
  if (patch.rating !== undefined) update.rating = patch.rating;
  if (patch.notes !== undefined) update.notes = cleanText(patch.notes);
  return update;
}
