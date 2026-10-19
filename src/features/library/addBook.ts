// Create flow: the prepared cover is saved on the device first (with the pre-generated book
// id), then the row is created locally with the planned remote path and the local URI; the
// upload is queued. If the row cannot be created, the local copy is removed best-effort.
import * as Crypto from 'expo-crypto';

import type { Book } from '@/types/book';

import type { BookErrorCode, BookResult, NewBook } from './bookRepository';
import { coverService, type CoverService, type LocalImage } from './coverService';

export type AddBookError = BookErrorCode | 'cover_failed';
type AddBookResult = { ok: true; data: Book } | { ok: false; error: AddBookError };

type Deps = {
  create: (input: NewBook) => Promise<BookResult<Book>>;
  covers?: Pick<CoverService, 'prepare' | 'saveLocal' | 'removeLocal'>;
  newId?: () => string;
};

export async function addBook(
  { userId, input, cover }: { userId: string; input: NewBook; cover: LocalImage | null },
  { create, covers = coverService, newId = () => Crypto.randomUUID() }: Deps,
): Promise<AddBookResult> {
  const id = newId();
  let coverFields: Partial<NewBook> = { coverPath: null, coverSource: null };

  if (cover) {
    const prepared = await covers.prepare(cover);
    if (!prepared.ok) return { ok: false, error: 'cover_failed' };
    const saved = await covers.saveLocal(userId, id, prepared.data.uri);
    if (!saved.ok) return { ok: false, error: 'cover_failed' };
    coverFields = {
      coverPath: saved.data.path,
      coverSource: cover.source ?? 'gallery',
      localCoverUri: saved.data.localUri,
    };
  }

  const result = await create({ ...input, id, ...coverFields });
  if (!result.ok) {
    if (coverFields.localCoverUri) covers.removeLocal(coverFields.localCoverUri);
    return { ok: false, error: result.error };
  }
  return result;
}
