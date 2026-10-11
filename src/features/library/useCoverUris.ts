import { useEffect, useState } from 'react';

import type { Book } from '@/types/book';

import { coverService } from './coverService';

type CoverFields = Pick<Book, 'coverPath' | 'updatedAt'>;

export type WithCover<T> = T & { coverUri?: string | null; coverCacheKey?: string | null };

/** Stable image cache key: changes only when the cover (or the book) changes. */
export function coverCacheKeyFor(book: CoverFields): string | null {
  return book.coverPath ? `${book.coverPath}@${book.updatedAt}` : null;
}

/**
 * Resolves signed cover URLs for the books currently shown, in one batch request.
 * Books without a cover are returned unchanged (typographic fallback).
 */
export function useCoverUris<T extends CoverFields>(books: readonly T[]): WithCover<T>[] {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const pathsKey = [...new Set(books.map((b) => b.coverPath).filter(Boolean))].sort().join('\n');

  useEffect(() => {
    if (!pathsKey) return;
    let active = true;
    coverService.getSignedUrls(pathsKey.split('\n')).then((result) => {
      if (active && result.ok) setUrls((current) => ({ ...current, ...result.data }));
    });
    return () => {
      active = false;
    };
  }, [pathsKey]);

  return books.map((book) =>
    book.coverPath
      ? { ...book, coverUri: urls[book.coverPath] ?? null, coverCacheKey: coverCacheKeyFor(book) }
      : book,
  );
}
