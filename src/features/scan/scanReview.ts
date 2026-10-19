// Pure helpers of the scan flow: identified book -> editable form values, and what
// "Intentar de nuevo" does for each failure.
import { emptyBookForm, type BookFormValues } from '@/features/library/bookFormLogic';
import { PAGE_COUNT_MAX } from '@/features/library/bookValidation';

import type { IdentifiedBook } from './bookIdentifier';
import type { ScanFailure } from './identifyBook';

/**
 * Prefills the review form. Reading status, page, rating and notes start as for a new book. A
 * proposed page count stays editable; without one the user has to type it.
 */
export function identifiedToFormValues(book: IdentifiedBook): BookFormValues {
  const pages = book.pageCount;
  return {
    ...emptyBookForm,
    title: book.title,
    author: book.author ?? '',
    genre: book.genre ?? '',
    pages: pages != null && pages <= PAGE_COUNT_MAX ? String(pages) : '',
  };
}

/**
 * `retake`: the photo itself was the problem, so the user takes a new one.
 * `identify`: the same photo is sent again (connection or service problems).
 */
export function retryActionFor(error: ScanFailure): 'retake' | 'identify' {
  return error === 'not_a_book' || error === 'low_confidence' ? 'retake' : 'identify';
}
