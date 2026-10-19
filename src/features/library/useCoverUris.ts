import { useEffect, useState } from 'react';

import type { Book } from '@/types/book';

import { coverService } from './coverService';

type CoverFields = Pick<Book, 'coverPath' | 'updatedAt'> & { localCoverUri?: string | null };

export type WithCover<T> = T & { coverUri?: string | null; coverCacheKey?: string | null };

/** Stable image cache key: changes only when the cover (or the book) changes. */
function coverCacheKeyFor(book: CoverFields): string | null {
  if (book.localCoverUri) return `${book.localCoverUri}@${book.updatedAt}`;
  return book.coverPath ? `${book.coverPath}@${book.updatedAt}` : null;
}

/**
 * Cover URIs for the books on screen: the local copy when this device has one, otherwise a
 * signed URL (one batch request) for covers that only exist on the server. Books without a
 * cover keep the typographic fallback.
 */
export function useCoverUris<T extends CoverFields>(books: readonly T[]): WithCover<T>[] {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const pathsKey = [
    ...new Set(books.filter((b) => !b.localCoverUri && b.coverPath).map((b) => b.coverPath)),
  ]
    .sort()
    .join('\n');

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

  return books.map((book) => {
    if (book.localCoverUri) {
      return { ...book, coverUri: book.localCoverUri, coverCacheKey: coverCacheKeyFor(book) };
    }
    if (book.coverPath) {
      return {
        ...book,
        coverUri: urls[book.coverPath] ?? null,
        coverCacheKey: coverCacheKeyFor(book),
      };
    }
    return book;
  });
}
