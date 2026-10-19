// Saving a new book from a form (manual entry and the scan review): local-first addBook, then a
// toast and the library with the new cover dropping onto the shelf.
import { useRouter } from 'expo-router';

import { useToast } from '@/components/Toast';
import { t } from '@/i18n';
import { useAuthStore } from '@/stores/authStore';
import { useLibraryStore } from '@/stores/libraryStore';

import { addBook } from './addBook';
import type { BookFormSubmitResult } from './BookForm';
import { toNewBook, type BookFormValues } from './bookFormLogic';
import { bookErrorMessage } from './bookRepository';
import type { LocalImage } from './coverService';

/** `onSaved`: runs after the book is saved (e.g. to mark the suggestion it came from). */
export function useCreateBook({ onSaved }: { onSaved?: (bookId: string) => void } = {}) {
  const router = useRouter();
  const toast = useToast();
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return async (
    values: BookFormValues,
    cover: LocalImage | null,
  ): Promise<BookFormSubmitResult> => {
    if (!userId) return { ok: false, message: bookErrorMessage('unauthorized') };
    const result = await addBook(
      { userId, input: toNewBook(values), cover },
      { create: useLibraryStore.getState().create },
    );
    if (!result.ok) {
      return {
        ok: false,
        message:
          result.error === 'cover_failed' ? t.bookForm.coverFailed : bookErrorMessage(result.error),
      };
    }
    onSaved?.(result.data.id);
    toast.show(t.bookForm.saved, 'success');
    router.navigate({ pathname: '/library', params: { added: result.data.id } });
    return { ok: true };
  };
}
