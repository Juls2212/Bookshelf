// Edit flow: a new cover is saved as a new unique local file and queues its upload (the old
// file is deleted only after the row was updated); a removed
// cover clears the cover fields (the repository queues the remote removal after the row);
// then the row is updated locally.
import type { Book } from '@/types/book';

import type { BookPatch, BookResult } from './bookRepository';
import { coverService, type CoverService, type LocalImage } from './coverService';
import type { AddBookError } from './addBook';

type EditBookResult = { ok: true; data: Book } | { ok: false; error: AddBookError };

type Deps = {
  update: (id: string, patch: BookPatch) => Promise<BookResult<Book>>;
  covers?: Pick<CoverService, 'prepare' | 'saveLocal' | 'removeLocal' | 'forgetSignedUrl'>;
};

export async function editBook(
  {
    userId,
    book,
    patch,
    cover,
    removeCover = false,
  }: {
    userId: string;
    book: Book;
    patch: BookPatch;
    /** A newly chosen image (it wins over `removeCover`). */
    cover: LocalImage | null;
    /** The user removed the saved cover ("Quitar portada"). */
    removeCover?: boolean;
  },
  { update, covers = coverService }: Deps,
): Promise<EditBookResult> {
  let coverPatch: BookPatch = {};
  let newLocalUri: string | null = null;
  const removing = !cover && removeCover && (book.coverPath !== null || !!book.localCoverUri);

  if (cover) {
    const prepared = await covers.prepare(cover);
    if (!prepared.ok) return { ok: false, error: 'cover_failed' };
    const saved = await covers.saveLocal(userId, book.id, prepared.data.uri);
    if (!saved.ok) return { ok: false, error: 'cover_failed' };
    coverPatch = {
      coverPath: saved.data.path,
      coverSource: cover.source ?? 'gallery',
      localCoverUri: saved.data.localUri,
    };
    newLocalUri = saved.data.localUri;
  } else if (removing) {
    coverPatch = { coverPath: null, coverSource: null, localCoverUri: null };
  }

  const result = await update(book.id, { ...patch, ...coverPatch });
  if (!result.ok) {
    // The row still points at the old file, which stays untouched.
    if (newLocalUri) covers.removeLocal(newLocalUri);
    return { ok: false, error: result.error };
  }
  if (newLocalUri) {
    // Replaced: the previous local file goes now that nothing points at it, and any cached
    // signed URL of the old image is dropped.
    if (book.localCoverUri && book.localCoverUri !== newLocalUri) {
      covers.removeLocal(book.localCoverUri);
    }
    if (book.coverPath) covers.forgetSignedUrl(book.coverPath);
  }
  if (removing) {
    // Local first: the copy on this device goes now; the sync engine deletes the remote image.
    if (book.localCoverUri) covers.removeLocal(book.localCoverUri);
    if (book.coverPath) covers.forgetSignedUrl(book.coverPath);
  }
  return result;
}
