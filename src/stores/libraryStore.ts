import { create, type StoreApi, type UseBoundStore } from 'zustand';

import type {
  BookErrorCode,
  BookPatch,
  BookRepository,
  BookResult,
  NewBook,
} from '@/features/library/bookRepository';
import { coverService } from '@/features/library/coverService';
import { supabaseBookRepository } from '@/features/library/supabaseBookRepository';
import type { Book } from '@/types/book';

import { useAuthStore } from './authStore';

export type LibraryStatus = 'idle' | 'loading' | 'ready' | 'error';

export type LibraryState = {
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
  reset: () => void;
};

const initialState = { books: [] as Book[], status: 'idle' as LibraryStatus, errorCode: null };

export type LibraryStore = UseBoundStore<StoreApi<LibraryState>>;

/** Store factory with an injected repository (Supabase today, SQLite in Phase 5, fakes in tests). */
export function createLibraryStore(repository: BookRepository): LibraryStore {
  return create<LibraryState>()((set, get) => {
    const replace = (book: Book) =>
      set({ books: get().books.map((b) => (b.id === book.id ? book : b)) });

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

      reset: () => set({ ...initialState }),
    };
  });
}

export const useLibraryStore = createLibraryStore(supabaseBookRepository);

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

bindLibraryToAuth(useLibraryStore, () => coverService.clearCache());
