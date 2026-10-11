import type { Book } from '@/types/book';

/** Reading progress as an integer 0-100. Unknown or invalid values give 0. */
export function computeProgressPercent(
  currentPage: number | null | undefined,
  pageCount: number | null | undefined,
): number {
  if (currentPage == null || pageCount == null) return 0;
  if (!Number.isFinite(currentPage) || !Number.isFinite(pageCount) || pageCount <= 0) return 0;
  const percent = Math.round((currentPage / pageCount) * 100);
  return Math.min(100, Math.max(0, percent));
}

export function isLent(book: Pick<Book, 'lentTo'>): boolean {
  return Boolean(book.lentTo?.trim());
}
