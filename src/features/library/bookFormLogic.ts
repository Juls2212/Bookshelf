// Pure logic of the add/edit book form: raw text values -> validation -> repository payload.
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { cleanLine, cleanMultiline, digitsInput } from '@/lib/inputSanitizers';
import type { Book, ReadingStatus } from '@/types/book';

import type { NewBook } from './bookRepository';
import {
  validateAuthor,
  validateGenre,
  validateNotes,
  validatePageCount,
  validateRating,
  validateTitle,
  type BookValidationCode,
} from './bookValidation';
import { pageForStatus, ratingForStatus, statusForPage, validateCurrentPage } from './readingRules';

export type BookFormValues = {
  title: string;
  author: string;
  genre: string;
  /** Digits only (the field strips anything else). Required to save. */
  pages: string;
  readingStatus: ReadingStatus;
  /** Only used while the status is "reading". */
  currentPage: string;
  rating: number | null;
  notes: string;
};

export type BookFormField =
  'title' | 'author' | 'genre' | 'pages' | 'currentPage' | 'rating' | 'notes';
export type BookFormErrors = Partial<Record<BookFormField, BookValidationCode>>;

export const emptyBookForm: BookFormValues = {
  title: '',
  author: '',
  genre: '',
  pages: '',
  readingStatus: 'to_read',
  currentPage: '',
  rating: null,
  notes: '',
};

/** Keeps digits only (at most five), so numeric fields never hold invalid text. */
export function digitsOnly(text: string): string {
  return digitsInput(text, INPUT_LIMITS.pageDigits);
}

function toInt(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : Number.parseInt(trimmed, 10);
}

export function validateBookForm(values: BookFormValues): BookFormErrors {
  const errors: BookFormErrors = {};
  const pageCount = toInt(values.pages);
  const title = validateTitle(values.title);
  if (title) errors.title = title;
  const author = validateAuthor(values.author);
  if (author) errors.author = author;
  const genre = validateGenre(values.genre);
  if (genre) errors.genre = genre;
  const notes = validateNotes(values.notes);
  if (notes) errors.notes = notes;
  const pages = validatePageCount(pageCount);
  if (pages) errors.pages = pages;
  if (values.readingStatus === 'reading') {
    const current = validateCurrentPage(toInt(values.currentPage), pages ? null : pageCount);
    if (current) errors.currentPage = current;
  }
  // Rating is only asked for (and validated) for finished books.
  if (values.readingStatus === 'finished') {
    const rating = validateRating(values.rating);
    if (rating) errors.rating = rating;
  }
  return errors;
}

/** Why the form cannot be saved right now, or null when it can. */
export type SaveBlocker = BookValidationCode | 'cover_pending';

/**
 * First reason that blocks saving: an invalid field (title and page count first), or a cover
 * still being downloaded or processed. The save button and the submit handler both use it.
 */
export function saveBlocker(
  values: BookFormValues,
  { coverPending }: { coverPending: boolean },
): SaveBlocker | null {
  const errors = validateBookForm(values);
  const field =
    errors.title ??
    errors.pages ??
    errors.currentPage ??
    errors.author ??
    errors.genre ??
    errors.notes ??
    errors.rating ??
    null;
  if (field) return field;
  return coverPending ? 'cover_pending' : null;
}

/**
 * Repository payload. Status and current page follow the reading rules: the page matches the
 * status, and a "reading" book typed at its last page is saved as finished.
 */
export function toNewBook(values: BookFormValues): NewBook {
  const pageCount = toInt(values.pages);
  const typedPage = values.readingStatus === 'reading' ? toInt(values.currentPage) : null;
  const currentPage = pageForStatus(values.readingStatus, typedPage, pageCount);
  const readingStatus =
    values.readingStatus === 'reading'
      ? statusForPage('reading', currentPage, pageCount)
      : values.readingStatus;
  return {
    title: cleanLine(values.title),
    author: cleanLine(values.author) || null,
    genre: cleanLine(values.genre) || null,
    pageCount,
    readingStatus,
    currentPage,
    rating: ratingForStatus(readingStatus, values.rating),
    notes: cleanMultiline(values.notes) || null,
  };
}

/** Prefills the form from a saved book (edit flow). */
export function bookToFormValues(book: Book): BookFormValues {
  return {
    title: book.title,
    author: book.author ?? '',
    genre: book.genre ?? '',
    pages: book.pageCount != null ? String(book.pageCount) : '',
    readingStatus: book.readingStatus,
    currentPage:
      book.readingStatus === 'reading' && book.currentPage ? String(book.currentPage) : '',
    rating: book.rating,
    notes: book.notes ?? '',
  };
}
