import { format, t } from '@/i18n';
import type { Book } from '@/types/book';

/** Count line for Biblioteca: empty, singular or plural copy from i18n. */
export function libraryCountLabel(count: number): string {
  if (count <= 0) return t.library.countEmpty;
  if (count === 1) return t.library.countOne;
  return format(t.library.countMany, { count });
}

/** Most recently added books (newest first). */
export function recentBooks(books: readonly Book[], limit: number, excludeId?: string): Book[] {
  return [...books]
    .filter((b) => b.id !== excludeId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, limit);
}
