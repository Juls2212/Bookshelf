// snake_case rows <-> camelCase `Book`. Null-safe and free of I/O.
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { cleanLine, cleanMultiline, truncateChars } from '@/lib/inputSanitizers';
import type { Book } from '@/types/book';
import type { UserBookInsert, UserBookRow, UserBookUpdate } from '@/types/database';

import type { BookPatch, NewBook } from './bookRepository';

export type BookRowSelection = Omit<UserBookRow, 'user_id' | 'deleted_at'>;

/** Single-line optional text, cleaned as saved; blank becomes null. */
function cleanText(value: string | null | undefined): string | null {
  const cleaned = cleanLine(value ?? '');
  return cleaned ? cleaned : null;
}

/** Notes keep their line breaks; blank becomes null. */
function cleanNotes(value: string | null | undefined): string | null {
  const cleaned = cleanMultiline(value ?? '');
  return cleaned ? cleaned : null;
}

/** Display copy of stored text: rows over the limits (legacy or pulled) never reach the UI. */
const shown = (value: string | null | undefined, max: number): string | null =>
  value == null ? null : truncateChars(value, max);

export function rowToBook(row: BookRowSelection): Book {
  return {
    id: row.id,
    title: truncateChars(row.title, INPUT_LIMITS.title),
    author: shown(row.author, INPUT_LIMITS.author),
    genre: shown(row.genre, INPUT_LIMITS.genre),
    pageCount: row.page_count ?? null,
    coverPath: row.cover_path ?? null,
    coverSource: row.cover_source ?? null,
    readingStatus: row.reading_status,
    currentPage: row.current_page ?? 0,
    rating: row.rating ?? null,
    notes: shown(row.notes, INPUT_LIMITS.notes),
    lentTo: shown(row.lent_to, INPUT_LIMITS.lentTo),
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
    title: cleanLine(input.title),
    author: cleanText(input.author),
    genre: cleanText(input.genre),
    page_count: input.pageCount ?? null,
    cover_path: input.coverPath ?? null,
    cover_source: input.coverSource ?? null,
    reading_status: input.readingStatus ?? 'to_read',
    current_page: input.currentPage ?? 0,
    rating: input.rating ?? null,
    notes: cleanNotes(input.notes),
    status_changed_at: nowIso,
  };
}

/** Update payload with only the keys present in the patch. */
export function patchToUpdate(patch: BookPatch): UserBookUpdate {
  const update: UserBookUpdate = {};
  if (patch.title !== undefined) update.title = cleanLine(patch.title);
  if (patch.author !== undefined) update.author = cleanText(patch.author);
  if (patch.genre !== undefined) update.genre = cleanText(patch.genre);
  if (patch.pageCount !== undefined) update.page_count = patch.pageCount;
  if (patch.coverPath !== undefined) update.cover_path = patch.coverPath;
  if (patch.coverSource !== undefined) update.cover_source = patch.coverSource;
  if (patch.readingStatus !== undefined) update.reading_status = patch.readingStatus;
  if (patch.currentPage !== undefined) update.current_page = patch.currentPage ?? 0;
  if (patch.rating !== undefined) update.rating = patch.rating;
  if (patch.notes !== undefined) update.notes = cleanNotes(patch.notes);
  return update;
}
