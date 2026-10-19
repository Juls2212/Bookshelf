// Reading rules: the single pure source of truth for status and page transitions.
// Used by the add/edit form, the library store and the book detail screen.
import { computeProgressPercent } from '@/lib/book';
import { cleanMultiline } from '@/lib/inputSanitizers';
import type { Book, ReadingStatus } from '@/types/book';

import type { BookValidationCode } from './bookValidation';

export type ReadingFields = Pick<
  Book,
  'readingStatus' | 'currentPage' | 'pageCount' | 'statusChangedAt'
> & { rating?: number | null };

const knownTotal = (pageCount: number | null | undefined): number | null =>
  pageCount != null && Number.isInteger(pageCount) && pageCount > 0 ? pageCount : null;

/**
 * Current page validation: integer, >= 0 and <= page_count when known.
 * `required` makes an empty value an error (page sheet); the form treats empty as 0.
 */
export function validateCurrentPage(
  value: number | null | undefined,
  pageCount: number | null | undefined,
  { required = false }: { required?: boolean } = {},
): BookValidationCode | null {
  if (value == null || Number.isNaN(value)) return required ? 'current_page_required' : null;
  if (!Number.isInteger(value) || value < 0) return 'current_page_invalid';
  const total = knownTotal(pageCount);
  if (total !== null && value > total) return 'current_page_exceeds_total';
  return null;
}

/**
 * Page that matches a status: to_read -> 0; reading -> keeps the page (at least 1 when the
 * total is known); finished -> the last page when known, otherwise the current one.
 */
export function pageForStatus(
  status: ReadingStatus,
  currentPage: number | null | undefined,
  pageCount: number | null | undefined,
): number {
  const current = currentPage ?? 0;
  const total = knownTotal(pageCount);
  if (status === 'to_read') return 0;
  if (status === 'finished') return total ?? current;
  return total !== null && current === 0 ? 1 : current;
}

/**
 * Status after moving to `page`: page 0 keeps the status; reaching the last page finishes the
 * book; starting a book to read marks it as reading; going back from the end of a finished
 * book (total known) marks it as reading again.
 */
export function statusForPage(
  status: ReadingStatus,
  page: number,
  pageCount: number | null | undefined,
): ReadingStatus {
  if (page === 0) return status;
  const total = knownTotal(pageCount);
  if (total !== null && page >= total) return 'finished';
  if (status === 'to_read') return 'reading';
  if (status === 'finished' && total !== null) return 'reading';
  return status;
}

/** A rating only exists for finished books; any other status has no rating. */
export function ratingForStatus(
  status: ReadingStatus,
  rating: number | null | undefined,
): number | null {
  return status === 'finished' ? (rating ?? null) : null;
}

/** A rating on a book that is not finished is invalid. */
export function validateRatingForStatus(
  status: ReadingStatus,
  rating: number | null | undefined,
): BookValidationCode | null {
  return rating != null && status !== 'finished' ? 'rating_requires_finished' : null;
}

/** Keeps the rating only when the resulting status allows it (no key added if absent). */
function withStatusRating<T extends ReadingFields>(book: T, status: ReadingStatus) {
  return book.rating === undefined ? {} : { rating: ratingForStatus(status, book.rating) };
}

/**
 * The user picked a new status. Always stamps status_changed_at. Leaving "finished" clears the
 * rating.
 */
export function applyStatusChange<T extends ReadingFields>(
  book: T,
  newStatus: ReadingStatus,
  now: Date = new Date(),
): T {
  return {
    ...book,
    readingStatus: newStatus,
    currentPage: pageForStatus(newStatus, book.currentPage, book.pageCount),
    statusChangedAt: now.toISOString(),
    ...withStatusRating(book, newStatus),
  };
}

/** The user updated the current page (already validated). Stamps the date only on a status change. */
export function applyPageUpdate<T extends ReadingFields>(
  book: T,
  page: number,
  now: Date = new Date(),
): T {
  const total = knownTotal(book.pageCount);
  const nextStatus = statusForPage(book.readingStatus, page, book.pageCount);
  const statusChanged = nextStatus !== book.readingStatus;
  return {
    ...book,
    readingStatus: nextStatus,
    currentPage: total !== null ? Math.min(page, total) : page,
    statusChangedAt: statusChanged ? now.toISOString() : book.statusChangedAt,
    ...withStatusRating(book, nextStatus),
  };
}

/** Tapping a star sets that rating; tapping the current rating clears it (null). */
export function toggleRating(current: number | null | undefined, tapped: number): number | null {
  return current === tapped ? null : tapped;
}

/** Notes are saved trimmed; an empty note is stored as null. */
export function normalizeNotes(notes: string | null | undefined): string | null {
  const cleaned = cleanMultiline(notes ?? '');
  return cleaned === '' ? null : cleaned;
}

/** Progress 0-100, or null when the page count is unknown (no percentage is shown). */
export function getProgressPercent(book: Pick<Book, 'currentPage' | 'pageCount'>): number | null {
  return knownTotal(book.pageCount) === null
    ? null
    : computeProgressPercent(book.currentPage, book.pageCount);
}
