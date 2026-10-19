import { act, fireEvent, render, screen } from '@testing-library/react-native';

import BookDetailScreen from '@/app/book/[id]';
import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import { editBook } from '@/features/library/editBook';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { format, t } from '@/i18n';
import type { Book } from '@/types/book';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
const mockParams = { id: 'b1' };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/features/library/coverService', () => ({ coverService: {} }));
jest.mock('@/features/library/useCoverUris', () => ({ useCoverUris: <T,>(books: T[]) => books }));

type MockState = {
  books: Book[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  load: jest.Mock;
  lend: jest.Mock;
  returnBook: jest.Mock;
  remove: jest.Mock;
  updateReadingStatus: jest.Mock;
  updateCurrentPage: jest.Mock;
  updateRating: jest.Mock;
  updateNotes: jest.Mock;
};
const mockLibrary: { state: MockState } = {
  state: {
    books: [],
    status: 'ready',
    load: jest.fn(),
    lend: jest.fn(),
    returnBook: jest.fn(),
    remove: jest.fn(),
    updateReadingStatus: jest.fn(),
    updateCurrentPage: jest.fn(),
    updateRating: jest.fn(),
    updateNotes: jest.fn(),
  },
};
jest.mock('@/stores/libraryStore', () => {
  const useLibraryStore = <T,>(selector: (s: MockState) => T) => selector(mockLibrary.state);
  useLibraryStore.getState = () => mockLibrary.state;
  return { useLibraryStore };
});

const book = (id: string, overrides: Partial<Book> = {}): Book => ({
  id,
  title: `Title ${id}`,
  author: 'Author',
  genre: 'Novel',
  pageCount: 312,
  coverPath: null,
  coverSource: null,
  readingStatus: 'reading',
  currentPage: 214,
  rating: 4,
  notes: 'A note',
  lentTo: null,
  lentAt: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-05T09:00:00.000Z',
  statusChangedAt: '2026-10-02T09:00:00.000Z',
  ...overrides,
});

function setLibrary(partial: Partial<MockState>) {
  mockLibrary.state = {
    books: [],
    status: 'ready',
    load: jest.fn(),
    lend: jest.fn(),
    returnBook: jest.fn(),
    remove: jest.fn(),
    updateReadingStatus: jest.fn(),
    updateCurrentPage: jest.fn(),
    updateRating: jest.fn(),
    updateNotes: jest.fn(),
    ...partial,
  };
}

const renderDetail = () =>
  render(
    <ThemeProvider>
      <ToastProvider>
        <BookDetailScreen />
      </ToastProvider>
    </ThemeProvider>,
  );

beforeEach(() => jest.clearAllMocks());

describe('book detail', () => {
  it('shows the not-found state when the book does not exist', async () => {
    setLibrary({ books: [book('other')] });
    await renderDetail();
    expect(screen.getByText(t.bookDetail.notFoundTitle)).toBeOnTheScreen();
  });

  it('loads the library when opened directly and shows a skeleton meanwhile', async () => {
    setLibrary({ status: 'idle' });
    await renderDetail();
    expect(mockLibrary.state.load).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(t.bookDetail.loading)).toBeOnTheScreen();
  });

  it('renders the read-only ficha with related books of the same genre', async () => {
    setLibrary({
      books: [
        book('b1'),
        book('b2', { title: 'Same genre' }),
        book('b3', { title: 'Other genre', genre: 'Poetry' }),
      ],
    });
    await renderDetail();
    expect(screen.getByRole('header', { name: 'Title b1' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: t.readingStatus.reading })).toBeChecked();
    expect(
      screen.getByRole('button', {
        name: format(t.book.tileA11y, { title: 'Same genre', author: 'Author' }),
      }),
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', {
        name: format(t.book.tileA11y, { title: 'Other genre', author: 'Author' }),
      }),
    ).toBeNull();

    await fireEvent.press(
      screen.getByRole('link', { name: format(t.bookDetail.seeGenre, { genre: 'novel' }) }),
    );
    expect(mockRouter.navigate).toHaveBeenCalledWith({
      pathname: '/library',
      params: { genre: 'Novel' },
    });
  });

  it('still renders a book saved before the page count was required', async () => {
    setLibrary({ books: [book('b1', { pageCount: null, currentPage: 40, genre: null })] });
    await renderDetail();
    expect(screen.getByRole('header', { name: 'Title b1' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: t.readingStatus.reading })).toBeChecked();
    expect(screen.queryByText(/null|NaN|undefined/)).toBeNull();
  });

  it('changes the status directly when the book is not finished', async () => {
    setLibrary({ books: [book('b1', { readingStatus: 'to_read', currentPage: 0 })] });
    mockLibrary.state.updateReadingStatus.mockResolvedValue({ ok: true, data: book('b1') });
    await renderDetail();
    await fireEvent.press(screen.getByRole('radio', { name: t.readingStatus.reading }));
    expect(mockLibrary.state.updateReadingStatus).toHaveBeenCalledWith('b1', 'reading');
    expect(
      await screen.findByText(format(t.reading.statusChanged, { status: t.readingStatus.reading })),
    ).toBeOnTheScreen();
  });

  it('asks for confirmation before leaving "finished" and shows errors in Spanish', async () => {
    setLibrary({ books: [book('b1', { readingStatus: 'finished', currentPage: 312 })] });
    mockLibrary.state.updateReadingStatus.mockResolvedValue({ ok: false, error: 'network_error' });
    await renderDetail();
    await fireEvent.press(screen.getByRole('radio', { name: t.readingStatus.to_read }));
    expect(mockLibrary.state.updateReadingStatus).not.toHaveBeenCalled();
    expect(screen.getByText(t.reading.leaveFinishedTitle)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: t.reading.leaveFinishedConfirm }));
    expect(mockLibrary.state.updateReadingStatus).toHaveBeenCalledWith('b1', 'to_read');
    expect(await screen.findByText(t.bookErrors.network_error)).toBeOnTheScreen();
  });

  it('validates the page sheet and saves a valid page', async () => {
    setLibrary({ books: [book('b1', { currentPage: 214, pageCount: 312 })] });
    mockLibrary.state.updateCurrentPage.mockResolvedValue({
      ok: true,
      data: book('b1', { currentPage: 250 }),
    });
    await renderDetail();
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.updatePage }));
    const field = screen.getByLabelText(t.reading.pageLabel);

    await fireEvent.changeText(field, '400');
    expect(screen.getByText(t.bookValidation.current_page_exceeds_total)).toBeOnTheScreen();

    await fireEvent.changeText(field, '');
    await fireEvent.press(screen.getByRole('button', { name: t.reading.pageSave }));
    expect(screen.getByText(t.bookValidation.current_page_required)).toBeOnTheScreen();
    expect(mockLibrary.state.updateCurrentPage).not.toHaveBeenCalled();

    await fireEvent.changeText(field, '250');
    expect(screen.getByText(format(t.reading.pagePreview, { percent: 80 }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: t.reading.pageSave }));
    expect(mockLibrary.state.updateCurrentPage).toHaveBeenCalledWith('b1', 250);
    expect(await screen.findByText(t.toast.pageUpdated)).toBeOnTheScreen();
  });

  it('celebrates when the last page finishes the book', async () => {
    setLibrary({ books: [book('b1', { currentPage: 214, pageCount: 312 })] });
    mockLibrary.state.updateCurrentPage.mockResolvedValue({
      ok: true,
      data: book('b1', { readingStatus: 'finished', currentPage: 312 }),
    });
    await renderDetail();
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.updatePage }));
    await fireEvent.changeText(screen.getByLabelText(t.reading.pageLabel), '312');
    await fireEvent.press(screen.getByRole('button', { name: t.reading.pageSave }));
    expect(await screen.findByText(t.reading.finishedToast)).toBeOnTheScreen();
  });

  it('sets the rating with a tap and clears it when tapping the current star', async () => {
    setLibrary({ books: [book('b1', { rating: 4, readingStatus: 'finished' })] });
    mockLibrary.state.updateRating.mockResolvedValue({ ok: true, data: book('b1') });
    await renderDetail();

    const four = screen.getByRole('radio', { name: format(t.rating.starMany, { value: 4 }) });
    expect(four.props.accessibilityHint).toBe(t.reading.ratingClearHint);
    await fireEvent.press(
      screen.getByRole('radio', { name: format(t.rating.starMany, { value: 2 }) }),
    );
    expect(mockLibrary.state.updateRating).toHaveBeenLastCalledWith('b1', 2);
    expect(await screen.findByText(t.reading.ratingSaved)).toBeOnTheScreen();

    await fireEvent.press(four);
    expect(mockLibrary.state.updateRating).toHaveBeenLastCalledWith('b1', null);
    expect(await screen.findByText(t.reading.ratingCleared)).toBeOnTheScreen();
  });

  it('shows a Spanish toast when the rating cannot be saved', async () => {
    setLibrary({ books: [book('b1', { rating: null, readingStatus: 'finished' })] });
    mockLibrary.state.updateRating.mockResolvedValue({ ok: false, error: 'network_error' });
    await renderDetail();
    await fireEvent.press(screen.getByRole('radio', { name: t.rating.starOne }));
    expect(await screen.findByText(t.bookErrors.network_error)).toBeOnTheScreen();
  });

  it('edits notes inline and keeps the draft when saving fails', async () => {
    setLibrary({ books: [book('b1', { notes: null })] });
    mockLibrary.state.updateNotes.mockResolvedValueOnce({ ok: false, error: 'network_error' });
    await renderDetail();

    await fireEvent.press(screen.getByRole('button', { name: t.reading.notesAdd }));
    const field = screen.getByLabelText(t.bookDetail.notesLabel);
    await fireEvent.changeText(field, '  Chapter 9 again  ');
    await fireEvent.press(screen.getByRole('button', { name: t.reading.notesSave }));

    expect(mockLibrary.state.updateNotes).toHaveBeenCalledWith('b1', '  Chapter 9 again  ');
    expect(await screen.findByText(t.bookErrors.network_error)).toBeOnTheScreen();
    expect(screen.getByDisplayValue('  Chapter 9 again  ')).toBeOnTheScreen();

    mockLibrary.state.updateNotes.mockResolvedValueOnce({
      ok: true,
      data: book('b1', { notes: 'Chapter 9 again' }),
    });
    await fireEvent.press(screen.getByRole('button', { name: t.reading.notesSave }));
    expect(await screen.findByText(t.reading.notesSaved)).toBeOnTheScreen();
    expect(screen.queryByLabelText(t.bookDetail.notesLabel)).toBeNull();
  });

  it('shows the character counter only near the limit and cancels without saving', async () => {
    setLibrary({ books: [book('b1', { notes: 'Short' })] });
    await renderDetail();
    await fireEvent.press(screen.getByRole('button', { name: t.reading.notesEdit }));
    expect(screen.queryByText(/de 2000 caracteres/)).toBeNull();

    await fireEvent.changeText(screen.getByLabelText(t.bookDetail.notesLabel), 'x'.repeat(1900));
    expect(
      screen.getByText(format(t.reading.notesCounter, { count: 1900, max: 2000 })),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: t.reading.cancel }));
    expect(mockLibrary.state.updateNotes).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(t.bookDetail.notesLabel)).toBeNull();
  });

  it('hides the rating while the book is not finished', async () => {
    setLibrary({ books: [book('b1', { readingStatus: 'reading', rating: 4 })] });
    await renderDetail();
    expect(screen.queryByText(t.bookDetail.ratingLabel)).toBeNull();
  });

  it('shows the rating for finished books', async () => {
    setLibrary({ books: [book('b1', { readingStatus: 'finished', currentPage: 312, rating: 4 })] });
    await renderDetail();
    expect(screen.getByText(t.bookDetail.ratingLabel)).toBeOnTheScreen();
  });

  it('warns that the rating will be removed when leaving finished', async () => {
    setLibrary({ books: [book('b1', { readingStatus: 'finished', currentPage: 312, rating: 4 })] });
    await renderDetail();
    await fireEvent.press(screen.getByRole('radio', { name: t.readingStatus.reading }));
    expect(
      screen.getByText(
        format(t.reading.leaveFinishedMessageWithRating, { status: t.readingStatus.reading }),
      ),
    ).toBeOnTheScreen();
  });

  it('dragging the bookmark to the end saves once and finishes the book', async () => {
    setLibrary({ books: [book('b1', { currentPage: 214, pageCount: 312 })] });
    mockLibrary.state.updateCurrentPage.mockResolvedValue({
      ok: true,
      data: book('b1', { readingStatus: 'finished', currentPage: 312 }),
    });
    await renderDetail();
    await fireEvent(screen.getByTestId('progress-slider'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 312, height: 44 } },
    });
    await act(async () => {
      fireGestureHandler(getByGestureTestId('progress-slider-pan'), [
        { state: State.BEGAN, x: 214 },
        { state: State.ACTIVE, x: 250 },
        { x: 300 },
        { state: State.END, x: 400 },
      ]);
    });
    expect(mockLibrary.state.updateCurrentPage).toHaveBeenCalledTimes(1);
    expect(mockLibrary.state.updateCurrentPage).toHaveBeenCalledWith('b1', 312);
    expect(await screen.findByText(t.reading.finishedToast)).toBeOnTheScreen();
  });

  it('hides "Más de tu estante" when there are no related books', async () => {
    setLibrary({ books: [book('b1')] });
    await renderDetail();
    expect(screen.queryByText(t.bookDetail.moreFromShelf)).toBeNull();
  });

  it('marks the book as lent with a required name', async () => {
    setLibrary({ books: [book('b1')] });
    mockLibrary.state.lend.mockResolvedValue({ ok: true, data: book('b1') });
    await renderDetail();

    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.more }));
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.markLent }));
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.loanSave }));
    expect(screen.getByText(t.bookValidation.lent_to_required)).toBeOnTheScreen();
    expect(mockLibrary.state.lend).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText(t.bookDetail.loanNameLabel), '  Laura ');
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.loanSave }));
    expect(mockLibrary.state.lend).toHaveBeenCalledWith('b1', '  Laura ');
    expect(await screen.findByText(format(t.toast.lentTo, { name: 'Laura' }))).toBeOnTheScreen();
  });

  it('shows the dashed loan card and returns the book', async () => {
    const lent = book('b1', { lentTo: 'Laura', lentAt: new Date().toISOString() });
    setLibrary({ books: [lent] });
    mockLibrary.state.returnBook.mockResolvedValue({ ok: true, data: book('b1') });
    await renderDetail();
    expect(
      screen.getByText(format(t.bookDetail.loanTo, { name: 'Laura', when: t.dates.today })),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.more }));
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.markReturned }));
    expect(mockLibrary.state.returnBook).toHaveBeenCalledWith('b1');
    expect(await screen.findByText(t.toast.markedReturned)).toBeOnTheScreen();
  });

  it('shows the loan error in Spanish', async () => {
    setLibrary({ books: [book('b1')] });
    mockLibrary.state.lend.mockResolvedValue({ ok: false, error: 'network_error' });
    await renderDetail();
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.more }));
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.markLent }));
    await fireEvent.changeText(screen.getByLabelText(t.bookDetail.loanNameLabel), 'Laura');
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.loanSave }));
    expect(await screen.findByText(t.bookErrors.network_error)).toBeOnTheScreen();
  });

  it('"Buscar parecidos" in the ⋯ menu opens Nuevas aventuras with this book', async () => {
    setLibrary({ books: [book('b1')] });
    await renderDetail();
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.more }));
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.findSimilar }));
    expect(mockRouter.navigate).toHaveBeenCalledWith({
      pathname: '/librarian',
      params: { mode: 'discovery', seed: 'b1' },
    });
  });

  it('deletes after confirmation and goes back', async () => {
    setLibrary({ books: [book('b1')] });
    mockLibrary.state.remove.mockResolvedValue({ ok: true, data: null });
    await renderDetail();
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.delete }));
    expect(mockLibrary.state.remove).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: t.bookDetail.deleteConfirm }));
    expect(mockLibrary.state.remove).toHaveBeenCalledWith('b1');
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('editBook', () => {
  const saved = book('b1');
  const cover = { uri: 'file:///new.jpg', width: 900, height: 1200 };

  function covers() {
    let version = 0;
    return {
      prepare: jest.fn(async () => ({
        ok: true as const,
        data: { uri: 'file:///prepared.jpg', width: 900, height: 1200 },
      })),
      saveLocal: jest.fn(async (userId: string, bookId: string) => ({
        ok: true as const,
        data: {
          // Every save is a new unique file (the real service stamps the name).
          localUri: `file:///documents/covers/${userId}/${bookId}_${(version += 1)}.jpg`,
          path: `${userId}/${bookId}.jpg`,
        },
      })),
      removeLocal: jest.fn(),
      forgetSignedUrl: jest.fn(),
    };
  }

  it('updates without touching the cover when none was picked', async () => {
    const update = jest.fn(async () => ({ ok: true as const, data: saved }));
    const c = covers();
    await editBook(
      { userId: 'u1', book: saved, patch: { title: 'New' }, cover: null },
      { update, covers: c },
    );
    expect(c.saveLocal).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('b1', { title: 'New' });
  });

  it('saves the new cover as a new local file and queues it through the update', async () => {
    const update = jest.fn(async () => ({ ok: true as const, data: saved }));
    const c = covers();
    await editBook({ userId: 'u1', book: saved, patch: {}, cover }, { update, covers: c });
    expect(c.saveLocal).toHaveBeenCalledWith('u1', 'b1', 'file:///prepared.jpg');
    expect(update).toHaveBeenCalledWith('b1', {
      coverPath: 'u1/b1.jpg',
      coverSource: 'gallery',
      localCoverUri: 'file:///documents/covers/u1/b1_1.jpg',
    });
  });

  it('a replaced cover gets a different file, and the old one goes only after the update', async () => {
    const old = 'file:///documents/covers/u1/b1_0.jpg';
    const withCover = { ...saved, coverPath: 'u1/b1.jpg', localCoverUri: old };
    const order: string[] = [];
    const update = jest.fn(async () => {
      order.push('update');
      return { ok: true as const, data: withCover };
    });
    const c = covers();
    c.removeLocal.mockImplementation(() => order.push('remove'));
    await editBook({ userId: 'u1', book: withCover, patch: {}, cover }, { update, covers: c });
    const patch = (update.mock.calls[0] as unknown[])[1] as { localCoverUri: string };
    expect(patch.localCoverUri).not.toBe(old);
    expect(c.removeLocal).toHaveBeenCalledWith(old);
    expect(order).toEqual(['update', 'remove']);
    // The cached signed URL of the previous remote image is dropped too.
    expect(c.forgetSignedUrl).toHaveBeenCalledWith('u1/b1.jpg');
  });

  it('removes the new local file if the update fails and keeps the previous one', async () => {
    const update = jest.fn(async () => ({ ok: false as const, error: 'unknown' as const }));
    const fresh = covers();
    await editBook({ userId: 'u1', book: saved, patch: {}, cover }, { update, covers: fresh });
    expect(fresh.removeLocal).toHaveBeenCalledWith('file:///documents/covers/u1/b1_1.jpg');

    const old = 'file:///documents/covers/u1/b1_0.jpg';
    const replaced = covers();
    const result = await editBook(
      { userId: 'u1', book: { ...saved, localCoverUri: old }, patch: {}, cover },
      { update, covers: replaced },
    );
    expect(replaced.removeLocal).toHaveBeenCalledTimes(1);
    expect(replaced.removeLocal).not.toHaveBeenCalledWith(old);
    expect(result).toEqual({ ok: false, error: 'unknown' });
  });
});
