// Create flow: optional cover upload first (with the pre-generated book id), then the row.
// If the row cannot be created, the uploaded cover is removed best-effort.
import * as Crypto from 'expo-crypto';

import type { Book } from '@/types/book';

import type { BookErrorCode, BookResult, NewBook } from './bookRepository';
import { coverService, type CoverService, type LocalImage } from './coverService';

export type AddBookError = BookErrorCode | 'cover_failed';
export type AddBookResult = { ok: true; data: Book } | { ok: false; error: AddBookError };

type Deps = {
  create: (input: NewBook) => Promise<BookResult<Book>>;
  covers?: Pick<CoverService, 'prepare' | 'upload' | 'remove'>;
  newId?: () => string;
};

export async function addBook(
  { userId, input, cover }: { userId: string; input: NewBook; cover: LocalImage | null },
  { create, covers = coverService, newId = () => Crypto.randomUUID() }: Deps,
): Promise<AddBookResult> {
  const id = newId();
  let coverPath: string | null = null;

  if (cover) {
    const prepared = await covers.prepare(cover);
    if (!prepared.ok) return { ok: false, error: 'cover_failed' };
    const uploaded = await covers.upload(userId, id, prepared.data.uri);
    if (!uploaded.ok) {
      return {
        ok: false,
        error: uploaded.error === 'network_error' ? 'network_error' : 'cover_failed',
      };
    }
    coverPath = uploaded.data;
  }

  const result = await create({
    ...input,
    id,
    coverPath,
    coverSource: coverPath ? 'gallery' : null,
  });
  if (!result.ok) {
    if (coverPath) await covers.remove(coverPath).catch(() => undefined);
    return { ok: false, error: result.error };
  }
  return result;
}
