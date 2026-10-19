// Basic reading statistics for Inicio ("Tu lectura"), computed locally from the library and the
// reading log. Pure functions: no dates are read here except the `now` passed in.
import { localDateKey, localDateKeyOf, localWeekKeys } from '@/lib/dates';
import type { Book } from '@/types/book';

import { pagesReadBetween } from './readingLog';

/** Hoy | Esta semana (Monday to Sunday) | Este año | Total, in the device's local time. */
export type StatsPeriod = 'today' | 'week' | 'year' | 'all';

type ReadingStats = {
  /** Finished books in the chosen period. */
  finished: number;
  /** Pages read in the chosen period (see pagesForPeriod). */
  pagesRead: number;
  reading: number;
  toRead: number;
  /** Average of the rated books (1 decimal), or null when none is rated. */
  averageRating: number | null;
  /** Most frequent genre among finished books (ties: alphabetical), or null. */
  favoriteGenre: string | null;
};

type StatsBook = Pick<
  Book,
  'readingStatus' | 'pageCount' | 'currentPage' | 'rating' | 'genre' | 'statusChangedAt'
>;

/** First and last local date keys of a period (inclusive); null bounds for "Total". */
export function periodRange(
  period: StatsPeriod,
  now: Date,
): { from: string | null; to: string | null } {
  if (period === 'today') {
    const today = localDateKey(now);
    return { from: today, to: today };
  }
  if (period === 'week') return localWeekKeys(now);
  if (period === 'year') {
    const year = now.getFullYear();
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  return { from: null, to: null };
}

/**
 * Finished in the period: status_changed_at is the moment the book was marked as read (it
 * changes whenever the reading status changes), compared by the DEVICE's local date. Books
 * without it (legacy data) only count in "Total".
 */
export function finishedInPeriod(book: StatsBook, period: StatsPeriod, now: Date): boolean {
  if (book.readingStatus !== 'finished') return false;
  if (period === 'all') return true;
  const day = localDateKeyOf(book.statusChangedAt);
  if (day === null) return false;
  const { from, to } = periodRange(period, now);
  return (from === null || day >= from) && (to === null || day <= to);
}

/** "This year" (kept for callers that only need the year). */
export function finishedInYear(book: StatsBook, now: Date): boolean {
  return finishedInPeriod(book, 'year', now);
}

const validPages = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/**
 * Pages a book counts for: a finished book its page_count (or, for older books without one,
 * the page it was left at); a book being read its current page; anything else 0.
 */
export function pagesReadOf(book: StatsBook): number {
  if (book.readingStatus === 'finished') {
    return validPages(book.pageCount) || validPages(book.currentPage);
  }
  if (book.readingStatus === 'reading') return validPages(book.currentPage);
  return 0;
}

/**
 * Pages read in the period from the reading log (per day, clamped at zero). The log has no
 * backfill, so "Total" also uses the library itself (pages of finished books plus current
 * pages) and shows the larger of the two: reading from before the log still counts there.
 */
export function pagesForPeriod(
  books: readonly StatsBook[],
  dailyPages: Readonly<Record<string, number>>,
  period: StatsPeriod,
  now: Date,
): number {
  const { from, to } = periodRange(period, now);
  const logged = pagesReadBetween(dailyPages, from, to);
  if (period !== 'all') return logged;
  return Math.max(
    logged,
    books.reduce((sum, book) => sum + pagesReadOf(book), 0),
  );
}

export function averageRatingOf(books: readonly StatsBook[]): number | null {
  const ratings = books
    .map((book) => book.rating)
    .filter((r): r is number => typeof r === 'number' && r >= 1 && r <= 5);
  if (ratings.length === 0) return null;
  const average = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
  return Math.round(average * 10) / 10;
}

/** Genre labels are free text: grouped ignoring case and spaces; the first spelling is shown. */
export function favoriteGenreOf(books: readonly StatsBook[]): string | null {
  const counts = new Map<string, { label: string; count: number }>();
  for (const book of books) {
    if (book.readingStatus !== 'finished') continue;
    const label = book.genre?.trim().replace(/\s+/g, ' ');
    if (!label) continue;
    const key = label.toLocaleLowerCase('es');
    const entry = counts.get(key) ?? { label, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  const ranked = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }),
  );
  return ranked[0]?.label ?? null;
}

export function readingStats(
  books: readonly StatsBook[],
  {
    period,
    now,
    dailyPages = {},
  }: { period: StatsPeriod; now: Date; dailyPages?: Readonly<Record<string, number>> },
): ReadingStats {
  return {
    finished: books.filter((book) => finishedInPeriod(book, period, now)).length,
    pagesRead: pagesForPeriod(books, dailyPages, period, now),
    reading: books.filter((book) => book.readingStatus === 'reading').length,
    toRead: books.filter((book) => book.readingStatus === 'to_read').length,
    averageRating: averageRatingOf(books),
    favoriteGenre: favoriteGenreOf(books),
  };
}

/** "1.250": Spanish thousands separator. */
export function formatCount(value: number): string {
  return String(Math.max(0, Math.floor(value))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "4,3" (Spanish decimal comma). */
export function formatRating(value: number): string {
  return value.toFixed(1).replace('.', ',');
}
