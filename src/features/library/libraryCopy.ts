import { format, t } from '@/i18n';
import type { Book } from '@/types/book';

/** Count line for Biblioteca: empty, singular or plural copy from i18n. */
export function libraryCountLabel(count: number): string {
  if (count <= 0) return t.library.countEmpty;
  if (count === 1) return t.library.countOne;
  return format(t.library.countMany, { count });
}

/** The book being read that was touched most recently, if any. */
export function currentReading(books: readonly Book[]): Book | null {
  let best: Book | null = null;
  for (const book of books) {
    if (book.readingStatus !== 'reading') continue;
    if (!best || book.updatedAt > best.updatedAt) best = book;
  }
  return best;
}

/** Most recently added books (newest first). */
export function recentBooks(books: readonly Book[], limit: number, excludeId?: string): Book[] {
  return [...books]
    .filter((b) => b.id !== excludeId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, limit);
}
