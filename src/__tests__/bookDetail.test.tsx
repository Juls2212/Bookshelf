import { fireEvent, render, screen } from '@testing-library/react-native';

import BookDetailScreen from '@/app/book/[id]';
import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import { editBook } from '@/features/library/editBook';
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
};
const mockLibrary: { state: MockState } = {
  state: {
    books: [],
    status: 'ready',
    load: jest.fn(),
    lend: jest.fn(),
    returnBook: jest.fn(),
    remove: jest.fn(),
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
    expect(screen.getByText(t.readingStatus.reading)).toBeOnTheScreen();
    // No page-update action in this phase.
    expect(screen.queryByText(t.bookDetail.updatePage)).toBeNull();
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
    expect(
      await screen.findByText(format(t.bookDetail.lentToast, { name: 'Laura' })),
    ).toBeOnTheScreen();
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
    expect(await screen.findByText(t.bookDetail.returnedToast)).toBeOnTheScreen();
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
  const covers = () => ({
    prepare: jest.fn(async () => ({
      ok: true as const,
      data: { uri: 'file:///p.jpg', width: 1, height: 1 },
    })),
    upload: jest.fn(async () => ({ ok: true as const, data: 'u1/b1.jpg' })),
    remove: jest.fn(async () => ({ ok: true as const, data: null })),
  });
  const cover = { uri: 'file:///new.jpg', width: 900, height: 1200 };

  it('updates without touching the cover when none was picked', async () => {
    const update = jest.fn(async () => ({ ok: true as const, data: saved }));
    const c = covers();
    await editBook(
      { userId: 'u1', book: saved, patch: { title: 'New' }, cover: null },
      { update, covers: c },
    );
    expect(c.upload).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('b1', { title: 'New' });
  });

  it('replaces the cover on the same path and saves it', async () => {
    const update = jest.fn(async () => ({ ok: true as const, data: saved }));
    const c = covers();
    await editBook(
      { userId: 'u1', book: { ...saved, coverPath: 'u1/b1.jpg' }, patch: {}, cover },
      { update, covers: c },
    );
    expect(c.upload).toHaveBeenCalledWith('u1', 'b1', 'file:///p.jpg');
    expect(update).toHaveBeenCalledWith('b1', { coverPath: 'u1/b1.jpg', coverSource: 'gallery' });
  });

  it('removes a brand-new cover if the update fails, but never a replaced one', async () => {
    const update = jest.fn(async () => ({ ok: false as const, error: 'network_error' as const }));
    const fresh = covers();
    await editBook({ userId: 'u1', book: saved, patch: {}, cover }, { update, covers: fresh });
    expect(fresh.remove).toHaveBeenCalledWith('u1/b1.jpg');

    const replaced = covers();
    const result = await editBook(
      { userId: 'u1', book: { ...saved, coverPath: 'u1/b1.jpg' }, patch: {}, cover },
      { update, covers: replaced },
    );
    expect(replaced.remove).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'network_error' });
  });
});
