import { useToast } from '@/components/Toast';
import { t } from '@/i18n';
import { useLibraryStore } from '@/stores/libraryStore';
import type { Book } from '@/types/book';

import { bookErrorMessage, type BookResult } from './bookRepository';

/**
 * Saves the current page through the store (reading rules applied there) and shows the
 * Spanish toast. Shared by the numeric sheet and the draggable bookmark.
 */
export function useSaveCurrentPage(): (book: Book, page: number) => Promise<BookResult<Book>> {
  const toast = useToast();
  return async (book, page) => {
    const result = await useLibraryStore.getState().updateCurrentPage(book.id, page);
    if (!result.ok) {
      toast.show(bookErrorMessage(result.error), 'error');
      return result;
    }
    const finished = book.readingStatus !== 'finished' && result.data.readingStatus === 'finished';
    toast.show(finished ? t.reading.finishedToast : t.toast.pageUpdated, 'success');
    return result;
  };
}
