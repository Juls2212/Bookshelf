// Pure logic of the add/edit book form: raw text values -> validation -> repository payload.
import type { Book, ReadingStatus } from '@/types/book';

import type { NewBook } from './bookRepository';
import {
  validateCurrentPage,
  validatePageCount,
  validateRating,
  validateTitle,
  type BookValidationCode,
} from './bookValidation';

export type BookFormValues = {
  title: string;
  author: string;
  genre: string;
  /** Digits only (the field strips anything else). Empty = unknown. */
  pages: string;
  readingStatus: ReadingStatus;
  /** Only used while the status is "reading". */
  currentPage: string;
  rating: number | null;
  notes: string;
};

export type BookFormField = 'title' | 'pages' | 'currentPage' | 'rating';
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

/** Keeps digits only, so numeric fields never hold invalid text. */
export function digitsOnly(text: string): string {
  return text.replace(/[^0-9]/g, '');
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
  const pages = validatePageCount(pageCount);
  if (pages) errors.pages = pages;
  if (values.readingStatus === 'reading') {
    const current = validateCurrentPage(toInt(values.currentPage), pages ? null : pageCount);
    if (current) errors.currentPage = current;
  }
  const rating = validateRating(values.rating);
  if (rating) errors.rating = rating;
  return errors;
}

/**
 * Repository payload. The current page follows the status: 0 when not started,
 * the typed page while reading, and the last page when finished (if known).
 */
export function toNewBook(values: BookFormValues): NewBook {
  const pageCount = toInt(values.pages);
  const currentPage =
    values.readingStatus === 'reading'
      ? (toInt(values.currentPage) ?? 0)
      : values.readingStatus === 'finished'
        ? (pageCount ?? 0)
        : 0;
  return {
    title: values.title.trim(),
    author: values.author.trim() || null,
    genre: values.genre.trim() || null,
    pageCount,
    readingStatus: values.readingStatus,
    currentPage,
    rating: values.rating,
    notes: values.notes.trim() || null,
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
