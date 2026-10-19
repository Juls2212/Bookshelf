// Local-first BookRepository over the signed-in user's SQLite database.
// Every write runs in one transaction together with its sync queue entry and marks the row
// as pending; the sync engine (Phase 5.2) pushes it later. No server calls here.
// A change of current_page also appends one reading event (Phase 9.2) in that transaction.
import * as Crypto from 'expo-crypto';

import type { SqlExecutor, SqlValue } from '@/db/sql';
import { enqueueBookOperation, enqueueReadingEvent, type SyncOperation } from '@/db/syncQueue';
import { localDateKey } from '@/lib/dates';
import { cleanLine } from '@/lib/inputSanitizers';

import { newBookToInsert, patchToUpdate } from './bookMapper';
import type { BookRepository, BookResult } from './bookRepository';
import {
  validateBook,
  validateLentTo,
  validateNotes,
  type BookValidationCode,
} from './bookValidation';
import { LOCAL_COLUMNS, localRowToBook, type LocalBookRow } from './localBookRow';
import { insertLocalEvent } from './localReadingEvents';
import { librarySession, type LibrarySession } from './librarySession';
import { eventForPageChange } from './readingLog';

const COLUMN_LIST = LOCAL_COLUMNS.join(', ');
const INSERT_SQL = `INSERT INTO books (${COLUMN_LIST}) VALUES (${LOCAL_COLUMNS.map(() => '?').join(', ')})`;
const UPDATE_SQL = `UPDATE books SET ${LOCAL_COLUMNS.filter((c) => c !== 'id')
  .map((c) => `${c} = ?`)
  .join(', ')} WHERE id = ?`;

const insertParams = (row: LocalBookRow): SqlValue[] =>
  LOCAL_COLUMNS.map((c) => (row[c] ?? null) as SqlValue);
const updateParams = (row: LocalBookRow): SqlValue[] => [
  ...LOCAL_COLUMNS.filter((c) => c !== 'id').map((c) => (row[c] ?? null) as SqlValue),
  row.id,
];

class NoSessionError extends Error {}

type Deps = {
  session?: LibrarySession;
  now?: () => Date;
  newId?: () => string;
};

export function createSqliteBookRepository({
  session = librarySession,
  now = () => new Date(),
  newId = () => Crypto.randomUUID(),
}: Deps = {}): BookRepository {
  const current = async () => {
    const active = await session.current();
    if (!active) throw new NoSessionError();
    return active;
  };

  const fail = <T>(error: unknown): BookResult<T> => ({
    ok: false,
    error: error instanceof NoSessionError ? 'unauthorized' : 'unknown',
  });

  const readRow = async (db: SqlExecutor, id: string) =>
    db.getFirstAsync<LocalBookRow>('SELECT * FROM books WHERE id = ? AND deleted_at IS NULL', [id]);

  /**
   * Writes the row and its queue entries atomically. With `readingFrom` (the page before an
   * update), a page change also logs its reading event in the same transaction.
   */
  const persist = async (
    row: LocalBookRow,
    operations: SyncOperation[],
    mode: 'insert' | 'update',
    readingFrom?: { page: number; at: Date },
  ): Promise<void> => {
    const { db, userId } = await current();
    const event = readingFrom
      ? eventForPageChange(readingFrom.page, row.current_page, localDateKey(readingFrom.at))
      : null;
    await db.transaction(async (tx) => {
      if (mode === 'insert') await tx.runAsync(INSERT_SQL, insertParams(row));
      else await tx.runAsync(UPDATE_SQL, updateParams(row));
      const stamp = row.local_updated_at ?? row.updated_at;
      for (const operation of operations) {
        await enqueueBookOperation(tx, row.id, operation, stamp);
      }
      if (event && readingFrom) {
        const id = newId();
        await insertLocalEvent(tx, {
          id,
          user_id: userId,
          book_id: row.id,
          pages_delta: event.pagesDelta,
          local_date: event.localDate,
          occurred_at: readingFrom.at.toISOString(),
        });
        await enqueueReadingEvent(tx, id, stamp);
      }
    });
  };

  /** Local change: pending sync, stamped now (updated_at is replaced by the server on push). */
  const touch = (row: LocalBookRow, nowIso: string): LocalBookRow => ({
    ...row,
    updated_at: nowIso,
    local_updated_at: nowIso,
    sync_state: 'pending',
  });

  return {
    async list() {
      try {
        const { db } = await current();
        const rows = await db.getAllAsync<LocalBookRow>(
          'SELECT * FROM books WHERE deleted_at IS NULL ORDER BY updated_at DESC, id ASC',
        );
        return { ok: true, data: rows.map(localRowToBook) };
      } catch (error) {
        return fail(error);
      }
    },

    async getById(id) {
      try {
        const { db } = await current();
        const row = await readRow(db, id);
        return row ? { ok: true, data: localRowToBook(row) } : { ok: false, error: 'not_found' };
      } catch (error) {
        return fail(error);
      }
    },

    async create(input) {
      const issues = [
        ...validateBook({ ...input, readingStatus: input.readingStatus ?? 'to_read' }),
        validateNotes(input.notes),
      ].filter((code): code is BookValidationCode => code !== null);
      if (issues.length > 0) return { ok: false, error: 'validation_failed', issues };
      try {
        const { userId } = await current();
        const nowIso = now().toISOString();
        const id = input.id ?? newId();
        const base = newBookToInsert({ ...input, id }, nowIso);
        const row: LocalBookRow = {
          id,
          user_id: userId,
          title: base.title,
          author: base.author ?? null,
          genre: base.genre ?? null,
          page_count: base.page_count ?? null,
          cover_path: base.cover_path ?? null,
          cover_source: base.cover_source ?? null,
          reading_status: base.reading_status ?? 'to_read',
          current_page: base.current_page ?? 0,
          rating: base.rating ?? null,
          notes: base.notes ?? null,
          lent_to: null,
          lent_at: null,
          status_changed_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
          deleted_at: null,
          local_cover_uri: input.localCoverUri ?? null,
          sync_state: 'pending',
          local_updated_at: nowIso,
        };
        const operations: SyncOperation[] = ['upsert'];
        if (row.local_cover_uri) operations.push('cover_upload');
        await persist(row, operations, 'insert');
        return { ok: true, data: localRowToBook(row) };
      } catch (error) {
        return fail(error);
      }
    },

    async update(id, patch) {
      try {
        const { db } = await current();
        const before = await readRow(db, id);
        if (!before) return { ok: false, error: 'not_found' };
        const at = now();
        const nowIso = at.toISOString();
        let next: LocalBookRow = { ...before, ...patchToUpdate(patch) };
        if (patch.localCoverUri !== undefined) next.local_cover_uri = patch.localCoverUri;
        if (next.reading_status !== before.reading_status) next.status_changed_at = nowIso;
        // A book that is not finished keeps no rating: a stale one is cleared on this save.
        if (
          next.reading_status !== 'finished' &&
          next.rating != null &&
          patch.rating === undefined
        ) {
          next.rating = null;
        }
        const issues = validateBook({
          title: next.title,
          author: next.author,
          genre: next.genre,
          pageCount: next.page_count,
          currentPage: next.current_page,
          rating: next.rating,
          readingStatus: next.reading_status,
          // Form edits always send the page count; reading or rating updates of an older book
          // without one stay valid.
          requirePageCount: patch.pageCount !== undefined,
        });
        const notesIssue = patch.notes !== undefined ? validateNotes(patch.notes) : null;
        if (notesIssue) issues.push(notesIssue);
        // Length limits only apply to the text this save changes, so a book saved before the
        // limits existed can still have its progress or rating updated.
        const touched: Partial<Record<BookValidationCode, unknown>> = {
          title_too_long: patch.title,
          author_too_long: patch.author,
          genre_too_long: patch.genre,
        };
        const blocking = issues.filter((code) => !(code in touched) || touched[code] !== undefined);
        if (blocking.length > 0) {
          return { ok: false, error: 'validation_failed', issues: blocking };
        }

        next = touch(next, nowIso);
        const operations: SyncOperation[] = ['upsert'];
        if (patch.localCoverUri) operations.push('cover_upload');
        // Cover removed: the row (cover_path null) is pushed first, then the image is deleted.
        const hadCover = before.cover_path !== null || before.local_cover_uri !== null;
        if (hadCover && next.cover_path === null && next.local_cover_uri === null) {
          operations.push('cover_remove');
        }
        await persist(next, operations, 'update', { page: before.current_page, at });
        return { ok: true, data: localRowToBook(next) };
      } catch (error) {
        return fail(error);
      }
    },

    async softDelete(id) {
      try {
        const { db } = await current();
        const before = await readRow(db, id);
        if (!before) return { ok: false, error: 'not_found' };
        const nowIso = now().toISOString();
        await persist(touch({ ...before, deleted_at: nowIso }, nowIso), ['delete'], 'update');
        return { ok: true, data: null };
      } catch (error) {
        return fail(error);
      }
    },

    async setLoan(id, lentTo) {
      const issue = validateLentTo(lentTo);
      if (issue) return { ok: false, error: 'validation_failed', issues: [issue] };
      try {
        const { db } = await current();
        const before = await readRow(db, id);
        if (!before) return { ok: false, error: 'not_found' };
        const nowIso = now().toISOString();
        const next = touch({ ...before, lent_to: cleanLine(lentTo), lent_at: nowIso }, nowIso);
        await persist(next, ['upsert'], 'update');
        return { ok: true, data: localRowToBook(next) };
      } catch (error) {
        return fail(error);
      }
    },

    async clearLoan(id) {
      try {
        const { db } = await current();
        const before = await readRow(db, id);
        if (!before) return { ok: false, error: 'not_found' };
        const nowIso = now().toISOString();
        const next = touch({ ...before, lent_to: null, lent_at: null }, nowIso);
        await persist(next, ['upsert'], 'update');
        return { ok: true, data: localRowToBook(next) };
      } catch (error) {
        return fail(error);
      }
    },
  };
}

export const sqliteBookRepository: BookRepository = createSqliteBookRepository();
