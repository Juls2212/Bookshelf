// Pure selectors over the library list.
import type { Book } from '@/types/book';

type Candidate = Pick<Book, 'id' | 'readingStatus' | 'statusChangedAt' | 'updatedAt' | 'createdAt'>;

/** Milliseconds of an ISO timestamp (server and client formats differ, so never compare strings). */
function time(value: string | null | undefined): number {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

/** Last reading activity: the latest of the status change and the last row update (page saves). */
export function lastReadingActivity(book: Candidate): number {
  return Math.max(time(book.statusChangedAt), time(book.updatedAt));
}

/**
 * "Continuar leyendo": among books being read, the one with the most recent activity.
 * Ties: the most recently added book, then the id, so the choice is always stable.
 */
export function pickCurrentlyReading<T extends Candidate>(books: readonly T[]): T | null {
  let best: T | null = null;
  for (const book of books) {
    if (book.readingStatus !== 'reading') continue;
    if (!best) {
      best = book;
      continue;
    }
    const diff = lastReadingActivity(book) - lastReadingActivity(best);
    const createdDiff = time(book.createdAt) - time(best.createdAt);
    if (diff > 0 || (diff === 0 && (createdDiff > 0 || (createdDiff === 0 && book.id < best.id)))) {
      best = book;
    }
  }
  return best;
}
