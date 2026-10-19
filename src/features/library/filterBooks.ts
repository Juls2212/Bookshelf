// Pure library filtering helpers.
import { isLent } from '@/lib/book';
import type { Book } from '@/types/book';

type BookFilter = 'all' | 'reading' | 'to_read' | 'finished' | 'lent';

type BookQuery = {
  query?: string;
  filter?: BookFilter;
  /** Optional genre; compared ignoring case and accents. */
  genre?: string | null;
};

// U+0300-U+036F: combining diacritical marks left by NFD (an accented letter becomes base + mark).
const DIACRITICS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

/** Lowercase, accent-free, trimmed text for comparisons. */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(DIACRITICS, '').toLocaleLowerCase().trim();
}

function matchesFilter(book: Book, filter: BookFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'lent') return isLent(book);
  return book.readingStatus === filter;
}

/** Accent- and case-insensitive search on title and author, plus status/lent and genre. */
export function filterBooks(
  books: readonly Book[],
  { query, filter = 'all', genre }: BookQuery,
): Book[] {
  const q = normalizeText(query);
  const g = genre ? normalizeText(genre) : '';
  return books.filter((book) => {
    if (!matchesFilter(book, filter)) return false;
    if (g && normalizeText(book.genre) !== g) return false;
    if (!q) return true;
    return normalizeText(book.title).includes(q) || normalizeText(book.author).includes(q);
  });
}

/** Other books of the same genre (the "more from your shelf" row), in list order. */
export function relatedBooks(book: Book, books: readonly Book[], limit = 6): Book[] {
  const genre = normalizeText(book.genre);
  if (!genre || limit <= 0) return [];
  return books
    .filter((other) => other.id !== book.id && normalizeText(other.genre) === genre)
    .slice(0, limit);
}
