// Pure book validators. They return English codes; Spanish messages live in i18n.
import { t } from '@/i18n';
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { charCount, cleanLine, cleanMultiline } from '@/lib/inputSanitizers';

import type { ReadingStatus } from '@/types/book';

import { validateCurrentPage, validateRatingForStatus } from './readingRules';

export type BookValidationCode =
  | 'title_required'
  | 'title_too_long'
  | 'author_too_long'
  | 'genre_too_long'
  | 'page_count_required'
  | 'page_count_invalid'
  | 'current_page_required'
  | 'current_page_invalid'
  | 'current_page_exceeds_total'
  | 'rating_invalid'
  | 'rating_requires_finished'
  | 'lent_to_required'
  | 'lent_to_too_long'
  | 'notes_too_long';

/** Page count range for new and edited books. */
export const PAGE_COUNT_MIN = INPUT_LIMITS.pageCountMin;
export const PAGE_COUNT_MAX = INPUT_LIMITS.pageCountMax;
export const TITLE_MAX_LENGTH = INPUT_LIMITS.title;
export const AUTHOR_MAX_LENGTH = INPUT_LIMITS.author;
export const GENRE_MAX_LENGTH = INPUT_LIMITS.genre;
export const LENT_TO_MAX_LENGTH = INPUT_LIMITS.lentTo;
/** Notes are a single text column; counted in characters (code points). */
export const NOTES_MAX_LENGTH = INPUT_LIMITS.notes;

type BookFields = {
  title: string;
  author?: string | null;
  genre?: string | null;
  pageCount?: number | null;
  currentPage?: number | null;
  rating?: number | null;
  /** When given, a rating is only valid for finished books. */
  readingStatus?: ReadingStatus;
  /**
   * Default true. False only for updates that do not touch the page count (e.g. reading
   * progress), so books saved before it was required keep working.
   */
  requirePageCount?: boolean;
};

export function validateTitle(title: string): BookValidationCode | null {
  const cleaned = cleanLine(title);
  if (cleaned.length === 0) return 'title_required';
  return charCount(cleaned) > TITLE_MAX_LENGTH ? 'title_too_long' : null;
}

/** Author is optional; empty is valid. */
export function validateAuthor(author: string | null | undefined): BookValidationCode | null {
  return charCount(cleanLine(author ?? '')) > AUTHOR_MAX_LENGTH ? 'author_too_long' : null;
}

/** Genre is optional; empty is valid. */
export function validateGenre(genre: string | null | undefined): BookValidationCode | null {
  return charCount(cleanLine(genre ?? '')) > GENRE_MAX_LENGTH ? 'genre_too_long' : null;
}

/** Page count: required by default, an integer from 1 to 10000. */
export function validatePageCount(
  pageCount: number | null | undefined,
  { required = true }: { required?: boolean } = {},
): BookValidationCode | null {
  if (pageCount == null || Number.isNaN(pageCount)) return required ? 'page_count_required' : null;
  return Number.isInteger(pageCount) && pageCount >= PAGE_COUNT_MIN && pageCount <= PAGE_COUNT_MAX
    ? null
    : 'page_count_invalid';
}

/** Re-exported from the reading rules (single source of truth). */
export { validateCurrentPage };

export function validateRating(rating: number | null | undefined): BookValidationCode | null {
  if (rating == null) return null;
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? null : 'rating_invalid';
}

export function validateLentTo(name: string): BookValidationCode | null {
  const cleaned = cleanLine(name);
  if (cleaned.length === 0) return 'lent_to_required';
  if (charCount(cleaned) > LENT_TO_MAX_LENGTH) return 'lent_to_too_long';
  return null;
}

/** Notes length after cleaning (what is actually saved). */
export function validateNotes(notes: string | null | undefined): BookValidationCode | null {
  return charCount(cleanMultiline(notes ?? '')) > NOTES_MAX_LENGTH ? 'notes_too_long' : null;
}

/** All issues of a complete set of fields (empty array when valid). */
export function validateBook(fields: BookFields): BookValidationCode[] {
  return [
    validateTitle(fields.title),
    validateAuthor(fields.author),
    validateGenre(fields.genre),
    validatePageCount(fields.pageCount, { required: fields.requirePageCount ?? true }),
    validateCurrentPage(fields.currentPage, fields.pageCount),
    validateRating(fields.rating),
    fields.readingStatus ? validateRatingForStatus(fields.readingStatus, fields.rating) : null,
  ].filter((code): code is BookValidationCode => code !== null);
}

export function bookValidationMessage(code: BookValidationCode): string {
  return t.bookValidation[code];
}
