import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import LibraryScreen from '@/app/(tabs)/library';
import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import { BookForm } from '@/features/library/BookForm';
import { emptyBookForm } from '@/features/library/bookFormLogic';
import { format, t } from '@/i18n';
import type { Book } from '@/types/book';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
const mockPush = jest.fn();
const mockSetParams = jest.fn();
const mockSearchParams: { genre?: string; added?: string } = {};
const mockRouterApi = { push: mockPush, back: jest.fn(), setParams: mockSetParams };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouterApi,
  useLocalSearchParams: () => mockSearchParams,
}));
jest.mock('@/features/library/coverService', () => ({
  coverService: { pickFromGallery: jest.fn(), getSignedUrls: jest.fn() },
}));
jest.mock('@/components/ShelfMotion', () => ({
  ShelfMotion: ({ children }: { children: unknown }) => children,
}));
jest.mock('@/features/library/useCoverUris', () => ({ useCoverUris: <T,>(books: T[]) => books }));

// Minimal Zustand-like store: selector hook + getState.
type MockLibraryState = {
  books: Book[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  errorCode: string | null;
  load: jest.Mock;
  refresh: jest.Mock;
};
const mockLibrary: { state: MockLibraryState } = {
  state: { books: [], status: 'idle', errorCode: null, load: jest.fn(), refresh: jest.fn() },
};
jest.mock('@/stores/libraryStore', () => {
  const useLibraryStore = <T,>(selector: (s: MockLibraryState) => T) => selector(mockLibrary.state);
  useLibraryStore.getState = () => mockLibrary.state;
  return { useLibraryStore };
});

function renderUi(ui: ReactElement) {
  return render(
    <ThemeProvider>
      <ToastProvider>{ui}</ToastProvider>
    </ThemeProvider>,
  );
}

const book = (id: string, title: string, overrides: Partial<Book> = {}): Book => ({
  id,
  title,
  author: 'Author',
  genre: null,
  pageCount: null,
  coverPath: null,
  coverSource: null,
  readingStatus: 'to_read',
  currentPage: 0,
  rating: null,
  notes: null,
  lentTo: null,
  lentAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  statusChangedAt: null,
  ...overrides,
});

function setLibrary(partial: Partial<MockLibraryState>) {
  mockLibrary.state = {
    books: [],
    status: 'ready',
    errorCode: null,
    load: jest.fn(),
    refresh: jest.fn(),
    ...partial,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete mockSearchParams.genre;
  delete mockSearchParams.added;
});

describe('Biblioteca states', () => {
  it('loads on mount and shows skeletons on the first load', async () => {
    setLibrary({ status: 'idle' });
    await renderUi(<LibraryScreen />);
    expect(mockLibrary.state.load).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t.library.title)).toBeOnTheScreen();
    expect(screen.queryByText(t.emptyLibrary.title)).toBeNull();
  });

  it('shows the empty state and opens the manual form', async () => {
    setLibrary({ books: [] });
    await renderUi(<LibraryScreen />);
    expect(mockLibrary.state.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t.emptyLibrary.title)).toBeOnTheScreen();
    expect(screen.getByText(t.library.countEmpty)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: t.emptyLibrary.addManually }));
    expect(mockPush).toHaveBeenCalledWith('/book/new');
  });

  it('shows an offline-aware error with retry when nothing could be loaded', async () => {
    setLibrary({ status: 'error', errorCode: 'network_error' });
    await renderUi(<LibraryScreen />);
    expect(screen.getByText(t.library.errorTitle)).toBeOnTheScreen();
    expect(screen.getByText(t.library.errorOffline)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: t.library.retry }));
    expect(mockLibrary.state.load).toHaveBeenCalledTimes(1);
  });

  it('shows the generic error message for other failures', async () => {
    setLibrary({ status: 'error', errorCode: 'unknown' });
    await renderUi(<LibraryScreen />);
    expect(screen.getByText(t.library.errorGeneric)).toBeOnTheScreen();
  });

  it('shows the count, filters by search and shows no results', async () => {
    setLibrary({ books: [book('1', 'Mapa de sal'), book('2', 'Ceniza y miel')] });
    await renderUi(<LibraryScreen />);
    expect(screen.getByText('2 libros en tus estantes')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText(t.search.label), 'rayuela');
    expect(
      screen.getByText(format(t.library.noResultsQuery, { query: 'rayuela' })),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: t.library.add }));
    expect(mockPush).toHaveBeenCalledWith('/book/new');
  });

  it('applies the temporary genre filter from the ficha and lets the user dismiss it', async () => {
    mockSearchParams.genre = 'Novela';
    setLibrary({ books: [book('1', 'Mapa de sal', { genre: 'Novela' })] });
    await renderUi(<LibraryScreen />);
    const chip = screen.getByRole('button', {
      name: format(t.library.genreChip, { genre: 'Novela' }),
    });
    await fireEvent.press(chip);
    expect(mockSetParams).toHaveBeenCalledWith({ genre: undefined });
  });

  it('uses the singular for one book', async () => {
    setLibrary({ books: [book('1', 'Mapa de sal')] });
    await renderUi(<LibraryScreen />);
    expect(screen.getByText('1 libro en tu estante')).toBeOnTheScreen();
  });
});

describe('BookForm', () => {
  it('shows inline validation and does not submit an empty title', async () => {
    const onSubmit = jest.fn();
    await renderUi(<BookForm onSubmit={onSubmit} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(screen.getByText(t.bookValidation.title_required)).toBeOnTheScreen();
    expect(screen.getByText(t.bookForm.fixErrors)).toBeOnTheScreen();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the current page only while reading and submits the values', async () => {
    const onSubmit = jest.fn(async () => ({ ok: true as const }));
    await renderUi(<BookForm onSubmit={onSubmit} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText(t.bookForm.titleLabel), 'Los almendros');
    await fireEvent.changeText(screen.getByLabelText(t.bookForm.pagesLabel), '312 pages');
    expect(screen.queryByLabelText(t.bookForm.currentPageLabel)).toBeNull();

    await fireEvent.press(screen.getByRole('radio', { name: t.readingStatus.reading }));
    await fireEvent.changeText(screen.getByLabelText(t.bookForm.currentPageLabel), '214');
    expect(screen.getByText(format(t.bookForm.ofPages, { pages: '312' }))).toBeOnTheScreen();

    await fireEvent.press(
      screen.getByRole('radio', { name: format(t.rating.starMany, { value: 4 }) }),
    );
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));

    expect(onSubmit).toHaveBeenCalledWith(
      {
        ...emptyBookForm,
        title: 'Los almendros',
        pages: '312',
        readingStatus: 'reading',
        currentPage: '214',
        rating: 4,
      },
      null,
    );
  });

  it('keeps the entered data and shows the error when saving fails', async () => {
    const onSubmit = jest.fn(async () => ({ ok: false as const, message: 'server says no' }));
    await renderUi(<BookForm onSubmit={onSubmit} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText(t.bookForm.titleLabel), 'Herbario');
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(await screen.findByText('server says no')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Herbario')).toBeOnTheScreen();
  });
});
