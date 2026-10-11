// Supabase implementation of BookRepository. RLS scopes every query to the signed-in user.
// Never logs row contents.
import * as Crypto from 'expo-crypto';

import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';
import type { Book } from '@/types/book';
import type { UserBookUpdate } from '@/types/database';

import {
  BOOK_COLUMNS,
  newBookToInsert,
  patchToUpdate,
  rowToBook,
  type BookRowSelection,
} from './bookMapper';
import type { BookErrorCode, BookRepository, BookResult } from './bookRepository';
import { validateBook, validateLentTo } from './bookValidation';

/** Maps PostgREST, Storage and fetch errors to internal codes. */
export function mapBookError(error: unknown): BookErrorCode {
  if (error === null || typeof error !== 'object') return 'unknown';
  const e = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const status = Number(e.status ?? e.statusCode);

  if (
    e.name === 'AbortError' ||
    message.includes('network request failed') ||
    message.includes('failed to fetch')
  ) {
    return 'network_error';
  }
  if (code === 'PGRST116') return 'not_found';
  // 42501: RLS/privileges; PGRST301/302: missing or expired JWT.
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST302') return 'unauthorized';
  if (status === 401 || status === 403) return 'unauthorized';
  // Check, not-null, invalid input and numeric range violations.
  if (['23514', '23502', '22P02', '22003'].includes(code)) return 'validation_failed';
  return 'unknown';
}

const fail = <T>(error: unknown): BookResult<T> => ({ ok: false, error: mapBookError(error) });

type Deps = {
  getClient?: () => AppSupabaseClient;
  now?: () => Date;
  newId?: () => string;
};

export function createSupabaseBookRepository({
  getClient = getSupabaseClient,
  now = () => new Date(),
  newId = () => Crypto.randomUUID(),
}: Deps = {}): BookRepository {
  const table = () => getClient().from('user_books');

  /** Updates a non-deleted row and returns it; zero rows means not_found. */
  async function updateRow(id: string, values: UserBookUpdate): Promise<BookResult<Book>> {
    const { data, error } = await table()
      .update(values)
      .eq('id', id)
      .is('deleted_at', null)
      .select(BOOK_COLUMNS)
      .maybeSingle();
    if (error) return fail(error);
    if (!data) return { ok: false, error: 'not_found' };
    return { ok: true, data: rowToBook(data as BookRowSelection) };
  }

  async function getById(id: string): Promise<BookResult<Book>> {
    try {
      const { data, error } = await table()
        .select(BOOK_COLUMNS)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) return fail(error);
      if (!data) return { ok: false, error: 'not_found' };
      return { ok: true, data: rowToBook(data as BookRowSelection) };
    } catch (error) {
      return fail(error);
    }
  }

  return {
    async list() {
      try {
        const { data, error } = await table()
          .select(BOOK_COLUMNS)
          .is('deleted_at', null)
          .order('updated_at', { ascending: false });
        if (error) return fail(error);
        return { ok: true, data: (data as BookRowSelection[]).map(rowToBook) };
      } catch (error) {
        return fail(error);
      }
    },

    getById,

    async create(input) {
      const issues = validateBook(input);
      if (issues.length > 0) return { ok: false, error: 'validation_failed', issues };
      try {
        const row = newBookToInsert({ ...input, id: input.id ?? newId() }, now().toISOString());
        const { data, error } = await table().insert(row).select(BOOK_COLUMNS).single();
        if (error) return fail(error);
        return { ok: true, data: rowToBook(data as BookRowSelection) };
      } catch (error) {
        return fail(error);
      }
    },

    async update(id, patch) {
      try {
        // Read the current row to validate the merged result and detect status changes.
        const current = await getById(id);
        if (!current.ok) return current;
        const merged = {
          title: patch.title ?? current.data.title,
          pageCount: patch.pageCount !== undefined ? patch.pageCount : current.data.pageCount,
          currentPage:
            patch.currentPage !== undefined ? patch.currentPage : current.data.currentPage,
          rating: patch.rating !== undefined ? patch.rating : current.data.rating,
        };
        const issues = validateBook(merged);
        if (issues.length > 0) return { ok: false, error: 'validation_failed', issues };

        const values = patchToUpdate(patch);
        if (
          patch.readingStatus !== undefined &&
          patch.readingStatus !== current.data.readingStatus
        ) {
          values.status_changed_at = now().toISOString();
        }
        return await updateRow(id, values);
      } catch (error) {
        return fail(error);
      }
    },

    async softDelete(id) {
      try {
        const { data, error } = await table()
          .update({ deleted_at: now().toISOString() })
          .eq('id', id)
          .is('deleted_at', null)
          .select('id')
          .maybeSingle();
        if (error) return fail(error);
        if (!data) return { ok: false, error: 'not_found' };
        return { ok: true, data: null };
      } catch (error) {
        return fail(error);
      }
    },

    async setLoan(id, lentTo) {
      const issue = validateLentTo(lentTo);
      if (issue) return { ok: false, error: 'validation_failed', issues: [issue] };
      try {
        return await updateRow(id, { lent_to: lentTo.trim(), lent_at: now().toISOString() });
      } catch (error) {
        return fail(error);
      }
    },

    async clearLoan(id) {
      try {
        return await updateRow(id, { lent_to: null, lent_at: null });
      } catch (error) {
        return fail(error);
      }
    },
  };
}

export const supabaseBookRepository: BookRepository = createSupabaseBookRepository();
