import { create, type StoreApi, type UseBoundStore } from 'zustand';

import type {
  BookErrorCode,
  BookPatch,
  BookRepository,
  BookResult,
  NewBook,
} from '@/features/library/bookRepository';
import { coverService } from '@/features/library/coverService';
import { validateNotes, validateRating } from '@/features/library/bookValidation';
import {
  applyPageUpdate,
  applyStatusChange,
  normalizeNotes,
  validateCurrentPage,
  validateRatingForStatus,
} from '@/features/library/readingRules';
import { librarySession } from '@/features/library/librarySession';
import { sqliteBookRepository } from '@/features/library/sqliteBookRepository';
import { notifyLocalWrite } from '@/features/sync/localWrites';
import type { Book, ReadingStatus } from '@/types/book';

import { useAuthStore } from './authStore';

type LibraryStatus = 'idle' | 'loading' | 'ready' | 'error';

type LibraryState = {
  books: Book[];
  status: LibraryStatus;
  errorCode: BookErrorCode | null;
  /** First load: shows the loading state. */
  load: () => Promise<void>;
  /** Reloads in the background, keeping the current books visible. */
  refresh: () => Promise<void>;
  create: (input: NewBook) => Promise<BookResult<Book>>;
  update: (id: string, patch: BookPatch) => Promise<BookResult<Book>>;
  remove: (id: string) => Promise<BookResult<null>>;
  lend: (id: string, lentTo: string) => Promise<BookResult<Book>>;
  returnBook: (id: string) => Promise<BookResult<Book>>;
  /** Applies the reading rules optimistically; rolls back if the server rejects it. */
  updateReadingStatus: (id: string, status: ReadingStatus) => Promise<BookResult<Book>>;
  /** Validates and applies the page (may finish the book); rolls back on failure. */
  updateCurrentPage: (id: string, page: number) => Promise<BookResult<Book>>;
  /** Sets (1-5) or clears (null) the rating optimistically; rolls back on failure. */
  updateRating: (id: string, rating: number | null) => Promise<BookResult<Book>>;
  /** Saves trimmed notes (empty -> null) optimistically; rolls back on failure. */
  updateNotes: (id: string, notes: string) => Promise<BookResult<Book>>;
  reset: () => void;
};

const initialState = { books: [] as Book[], status: 'idle' as LibraryStatus, errorCode: null };

type LibraryStore = UseBoundStore<StoreApi<LibraryState>>;

/** Repository decorator: notifies `onWrite` after each successful write. */
function notifyingWrites(repository: BookRepository, onWrite: () => void): BookRepository {
  const notify =
    <A extends unknown[], R extends { ok: boolean }>(write: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const result = await write(...args);
      if (result.ok) onWrite();
      return result;
    };
  return {
    list: () => repository.list(),
    getById: (id) => repository.getById(id),
    create: notify((input) => repository.create(input)),
    update: notify((id, patch) => repository.update(id, patch)),
    softDelete: notify((id) => repository.softDelete(id)),
    setLoan: notify((id, lentTo) => repository.setLoan(id, lentTo)),
    clearLoan: notify((id) => repository.clearLoan(id)),
  };
}

/** Store factory with an injected repository (SQLite in the app, fakes in tests). */
export function createLibraryStore(
  source: BookRepository,
  onWrite: () => void = notifyLocalWrite,
): LibraryStore {
  const repository = notifyingWrites(source, onWrite);
  return create<LibraryState>()((set, get) => {
    const replace = (book: Book) =>
      set({ books: get().books.map((b) => (b.id === book.id ? book : b)) });

    /**
     * Shows `after` immediately and persists `patch`. On failure it restores `before`,
     * unless something newer already replaced the optimistic copy.
     */
    const optimistic = async (
      before: Book,
      after: Book,
      patch: BookPatch,
    ): Promise<BookResult<Book>> => {
      replace(after);
      const result = await repository.update(before.id, patch);
      if (result.ok) {
        replace(result.data);
      } else if (get().books.find((b) => b.id === before.id) === after) {
        replace(before);
      }
      return result;
    };

    /** Reading fields to persist, plus the rating when the rules cleared it. */
    const readingPatch = (before: Book, after: Book): BookPatch => ({
      readingStatus: after.readingStatus,
      currentPage: after.currentPage,
      ...(after.rating !== before.rating ? { rating: after.rating } : {}),
    });

    const fetchAll = async (showLoading: boolean) => {
      if (showLoading) set({ status: 'loading', errorCode: null });
      const result = await repository.list();
      if (result.ok) set({ books: result.data, status: 'ready', errorCode: null });
      else set({ status: 'error', errorCode: result.error });
    };

    return {
      ...initialState,

      load: () => fetchAll(true),
      refresh: () => fetchAll(get().books.length === 0),

      create: async (input) => {
        const result = await repository.create(input);
        if (result.ok)
          set({ books: [result.data, ...get().books.filter((b) => b.id !== result.data.id)] });
        return result;
      },

      update: async (id, patch) => {
        const result = await repository.update(id, patch);
        if (result.ok) replace(result.data);
        return result;
      },

      remove: async (id) => {
        const result = await repository.softDelete(id);
        if (result.ok) set({ books: get().books.filter((b) => b.id !== id) });
        return result;
      },

      lend: async (id, lentTo) => {
        const result = await repository.setLoan(id, lentTo);
        if (result.ok) replace(result.data);
        return result;
      },

      returnBook: async (id) => {
        const result = await repository.clearLoan(id);
        if (result.ok) replace(result.data);
        return result;
      },

      updateReadingStatus: async (id, status) => {
        const before = get().books.find((b) => b.id === id);
        if (!before) return { ok: false, error: 'not_found' };
        const after = applyStatusChange(before, status);
        return optimistic(before, after, readingPatch(before, after));
      },

      updateCurrentPage: async (id, page) => {
        const before = get().books.find((b) => b.id === id);
        if (!before) return { ok: false, error: 'not_found' };
        const issue = validateCurrentPage(page, before.pageCount, { required: true });
        if (issue) return { ok: false, error: 'validation_failed', issues: [issue] };
        const after = applyPageUpdate(before, page);
        return optimistic(before, after, readingPatch(before, after));
      },

      updateRating: async (id, rating) => {
        const before = get().books.find((b) => b.id === id);
        if (!before) return { ok: false, error: 'not_found' };
        const issue =
          validateRating(rating) ?? validateRatingForStatus(before.readingStatus, rating);
        if (issue) return { ok: false, error: 'validation_failed', issues: [issue] };
        return optimistic(before, { ...before, rating }, { rating });
      },

      updateNotes: async (id, notes) => {
        const before = get().books.find((b) => b.id === id);
        if (!before) return { ok: false, error: 'not_found' };
        const issue = validateNotes(notes);
        if (issue) return { ok: false, error: 'validation_failed', issues: [issue] };
        const normalized = normalizeNotes(notes);
        return optimistic(before, { ...before, notes: normalized }, { notes: normalized });
      },

      reset: () => set({ ...initialState }),
    };
  });
}

/** Local-first: reads and writes go to the signed-in user's SQLite database. */
export const useLibraryStore = createLibraryStore(sqliteBookRepository);

/** Clears library data (and cached cover URLs) whenever the user signs out. */
export function bindLibraryToAuth(
  store: LibraryStore,
  onSignedOut: () => void = () => {},
): () => void {
  return useAuthStore.subscribe((state, previous) => {
    if (state.status === 'signedOut' && previous.status !== 'signedOut') {
      store.getState().reset();
      onSignedOut();
    }
  });
}

/**
 * Opens the signed-in user's database (one file per user) and closes it on sign-out, so two
 * accounts on the same device never see each other's books. Files are kept on sign-out.
 */
function bindLibrarySessionToAuth(): () => void {
  const sync = (userId: string | null) => {
    if (userId) void librarySession.start(userId).catch(() => undefined);
  };
  sync(useAuthStore.getState().user?.id ?? null);
  return useAuthStore.subscribe((state, previous) => {
    const userId = state.user?.id ?? null;
    if (userId && userId !== (previous.user?.id ?? null)) sync(userId);
  });
}

bindLibrarySessionToAuth();
bindLibraryToAuth(useLibraryStore, () => {
  coverService.clearCache();
  void librarySession.stop();
});
