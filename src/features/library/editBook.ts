// Edit flow: optional new cover first (same path, upsert replaces the old file), then the row.
import type { Book } from '@/types/book';

import type { BookPatch, BookResult } from './bookRepository';
import { coverService, type CoverService, type LocalImage } from './coverService';
import type { AddBookError } from './addBook';

export type EditBookResult = { ok: true; data: Book } | { ok: false; error: AddBookError };

type Deps = {
  update: (id: string, patch: BookPatch) => Promise<BookResult<Book>>;
  covers?: Pick<CoverService, 'prepare' | 'upload' | 'remove'>;
};

export async function editBook(
  {
    userId,
    book,
    patch,
    cover,
  }: { userId: string; book: Book; patch: BookPatch; cover: LocalImage | null },
  { update, covers = coverService }: Deps,
): Promise<EditBookResult> {
  let coverPatch: BookPatch = {};
  let uploadedNewPath: string | null = null;

  if (cover) {
    const prepared = await covers.prepare(cover);
    if (!prepared.ok) return { ok: false, error: 'cover_failed' };
    const uploaded = await covers.upload(userId, book.id, prepared.data.uri);
    if (!uploaded.ok) {
      return {
        ok: false,
        error: uploaded.error === 'network_error' ? 'network_error' : 'cover_failed',
      };
    }
    coverPatch = { coverPath: uploaded.data, coverSource: 'gallery' };
    // Only a brand-new file can be cleaned up; a replaced one has already been overwritten.
    if (!book.coverPath) uploadedNewPath = uploaded.data;
  }

  const result = await update(book.id, { ...patch, ...coverPatch });
  if (!result.ok) {
    if (uploadedNewPath) await covers.remove(uploadedNewPath).catch(() => undefined);
    return { ok: false, error: result.error };
  }
  return result;
}
