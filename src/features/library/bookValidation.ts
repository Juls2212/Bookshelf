// Pure book validators. They return English codes; Spanish messages live in i18n.
import { t } from '@/i18n';

export type BookValidationCode =
  | 'title_required'
  | 'page_count_invalid'
  | 'current_page_invalid'
  | 'current_page_exceeds_total'
  | 'rating_invalid'
  | 'lent_to_required'
  | 'lent_to_too_long';

export const LENT_TO_MAX_LENGTH = 80;

export type BookFields = {
  title: string;
  pageCount?: number | null;
  currentPage?: number | null;
  rating?: number | null;
};

const isPositiveInt = (n: number) => Number.isInteger(n) && n > 0;

export function validateTitle(title: string): BookValidationCode | null {
  return title.trim().length === 0 ? 'title_required' : null;
}

export function validatePageCount(pageCount: number | null | undefined): BookValidationCode | null {
  if (pageCount == null) return null;
  return isPositiveInt(pageCount) ? null : 'page_count_invalid';
}

export function validateCurrentPage(
  currentPage: number | null | undefined,
  pageCount: number | null | undefined,
): BookValidationCode | null {
  if (currentPage == null) return null;
  if (!Number.isInteger(currentPage) || currentPage < 0) return 'current_page_invalid';
  if (pageCount != null && isPositiveInt(pageCount) && currentPage > pageCount) {
    return 'current_page_exceeds_total';
  }
  return null;
}

export function validateRating(rating: number | null | undefined): BookValidationCode | null {
  if (rating == null) return null;
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? null : 'rating_invalid';
}

export function validateLentTo(name: string): BookValidationCode | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'lent_to_required';
  if (Array.from(trimmed).length > LENT_TO_MAX_LENGTH) return 'lent_to_too_long';
  return null;
}

/** All issues of a complete set of fields (empty array when valid). */
export function validateBook(fields: BookFields): BookValidationCode[] {
  return [
    validateTitle(fields.title),
    validatePageCount(fields.pageCount),
    validateCurrentPage(fields.currentPage, fields.pageCount),
    validateRating(fields.rating),
  ].filter((code): code is BookValidationCode => code !== null);
}

export function bookValidationMessage(code: BookValidationCode): string {
  return t.bookValidation[code];
}
