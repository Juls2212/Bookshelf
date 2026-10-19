import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import LibraryScreen from '@/app/(tabs)/library';
import { COVER_ASPECT } from '@/components/BookCover';
import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import { BookForm } from '@/features/library/BookForm';
import { emptyBookForm } from '@/features/library/bookFormLogic';
import type { LocalImage } from '@/features/library/coverService';
import { format, t } from '@/i18n';
import { useSyncStore } from '@/stores/syncStore';
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
const mockCovers = {
  pickFromGallery: jest.fn(),
  getSignedUrls: jest.fn(),
  renderPreview: jest.fn(async () => ({
    ok: true,
    data: { uri: 'file:///cache/preview.jpg', width: 340, height: 480 },
  })),
  measure: jest.fn(async () => ({ ok: true, data: { width: 1200, height: 900 } })),
  removeLocal: jest.fn(),
};
// Getter: the mock object is created after the hoisted jest.mock call.
jest.mock('@/features/library/coverService', () => ({
  get coverService() {
    return mockCovers;
  },
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

/** Accessible name of a required field. */
const required = (label: string) => format(t.common.requiredA11y, { label });

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
  // The library was downloaded on this device before (first-run states are tested elsewhere).
  useSyncStore.setState({ initialPullDone: true });
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
  it('blocks saving without a title, with the reason shown, and never submits', async () => {
    const onSubmit = jest.fn();
    await renderUi(<BookForm onSubmit={onSubmit} onCancel={jest.fn()} />);
    expect(screen.getByTestId('save-blocker')).toHaveTextContent(t.bookValidation.title_required);
    const save = screen.getByRole('button', { name: t.bookForm.save });
    expect(save).toBeDisabled();
    await fireEvent.press(save);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks saving while the page count is missing or outside 1-10000', async () => {
    const onSubmit = jest.fn(async () => ({ ok: true as const }));
    await renderUi(<BookForm onSubmit={onSubmit} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.titleLabel)), 'Rayuela');
    const save = () => screen.getByRole('button', { name: t.bookForm.save });
    expect(save()).toBeDisabled();
    expect(screen.getByTestId('save-blocker')).toHaveTextContent(
      t.bookValidation.page_count_required,
    );
    for (const pages of ['0', '10001']) {
      await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.pagesLabel)), pages);
      expect(save()).toBeDisabled();
      expect(screen.getByTestId('save-blocker')).toHaveTextContent(
        t.bookValidation.page_count_invalid,
      );
    }
    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.pagesLabel)), '10000');
    expect(save()).toBeEnabled();
    expect(screen.queryByTestId('save-blocker')).toBeNull();
    await fireEvent.press(save());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows the current page only while reading and submits the values', async () => {
    const onSubmit = jest.fn(async () => ({ ok: true as const }));
    await renderUi(<BookForm onSubmit={onSubmit} onCancel={jest.fn()} />);
    await fireEvent.changeText(
      screen.getByLabelText(required(t.bookForm.titleLabel)),
      'Los almendros',
    );
    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.pagesLabel)), '312 pages');
    expect(screen.queryByLabelText(t.bookForm.currentPageLabel)).toBeNull();

    await fireEvent.press(screen.getByRole('radio', { name: t.readingStatus.reading }));
    await fireEvent.changeText(screen.getByLabelText(t.bookForm.currentPageLabel), '214');
    expect(screen.getByText(format(t.bookForm.ofPages, { pages: '312' }))).toBeOnTheScreen();

    // Rating is not asked for while reading.
    expect(screen.queryByText(t.bookForm.ratingLabel)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));

    expect(onSubmit).toHaveBeenCalledWith(
      {
        ...emptyBookForm,
        title: 'Los almendros',
        pages: '312',
        readingStatus: 'reading',
        currentPage: '214',
        rating: null,
      },
      null,
    );
  });

  it('requires the page count (1 to 10000) and marks the field as required', async () => {
    const onSubmit = jest.fn(async () => ({ ok: true as const }));
    await renderUi(<BookForm onSubmit={onSubmit} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.titleLabel)), 'Herbario');
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(screen.getByText(t.bookValidation.page_count_required)).toBeOnTheScreen();
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.pagesLabel)), '10001');
    expect(screen.getByText(t.bookValidation.page_count_invalid)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.pagesLabel)), '96');
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ pages: '96' }), null);
  });

  it('editing a book saved without a page count asks for it', async () => {
    const onSubmit = jest.fn(async () => ({ ok: true as const }));
    await renderUi(
      <BookForm
        initialValues={{ ...emptyBookForm, title: 'Antiguo' }}
        existingCover={{ uri: 'file:///doc/covers/u/b.jpg' }}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />,
    );
    // A saved cover is never re-cropped.
    expect(screen.queryByRole('button', { name: t.bookForm.adjustCrop })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(screen.getByText(t.bookValidation.page_count_required)).toBeOnTheScreen();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a newly picked image is kept whole by default and can be cropped', async () => {
    const picked = { uri: 'file:///picked.jpg', width: 1200, height: 900 };
    mockCovers.pickFromGallery.mockResolvedValue({ ok: true, data: picked });
    const onSubmit = jest.fn(async () => ({ ok: true as const }));
    await renderUi(
      <BookForm
        initialValues={{ ...emptyBookForm, title: 'Herbario', pages: '96' }}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: t.bookForm.adjustCrop })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.addCover }));
    // The add form asks where the image comes from.
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.coverFromGallery }));
    // No crop yet: the picked image itself is the preview.
    expect(mockCovers.renderPreview).not.toHaveBeenCalled();
    expect(screen.getByTestId('book-cover-image').props.source).toEqual([
      expect.objectContaining({ uri: picked.uri }),
    ]);

    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.adjustCrop }));
    expect(mockCovers.measure).toHaveBeenCalledWith(picked.uri);
    await fireEvent(screen.getByTestId('crop-area'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 344, height: 544 } },
    });
    await screen.findByTestId('crop-frame');
    await fireEvent.press(screen.getByRole('button', { name: t.cropEditor.apply }));
    expect(mockCovers.renderPreview).toHaveBeenCalledWith(
      expect.objectContaining({ uri: picked.uri, crop: expect.any(Object) }),
    );

    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    const [, cover] = onSubmit.mock.calls[0] as unknown as [unknown, LocalImage];
    expect(cover.uri).toBe(picked.uri);
    // The largest frame with the cover proportions inside a landscape photo: full height.
    expect(cover.crop!.height).toBeCloseTo(1);
    expect((cover.crop!.width * 1200) / (cover.crop!.height * 900)).toBeCloseTo(
      1 / COVER_ASPECT,
      3,
    );
  });

  it('cancelling the crop editor keeps the image as it was', async () => {
    const picked = { uri: 'file:///picked.jpg', width: 1200, height: 900 };
    mockCovers.pickFromGallery.mockResolvedValue({ ok: true, data: picked });
    const onSubmit = jest.fn(async () => ({ ok: true as const }));
    await renderUi(
      <BookForm
        initialValues={{ ...emptyBookForm, title: 'Herbario', pages: '96' }}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.addCover }));
    // The add form asks where the image comes from.
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.coverFromGallery }));
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.adjustCrop }));
    // The form has its own Cancelar; the editor (rendered with the cover row) comes first.
    const cancels = screen.getAllByRole('button', { name: t.cropEditor.cancel });
    await fireEvent.press(cancels[0]);
    expect(screen.queryByText(t.cropEditor.hint)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), picked);
  });

  it('asks for a rating only when the status is Leído, and drops it otherwise', async () => {
    const onSubmit = jest.fn(async () => ({ ok: true as const }));
    await renderUi(<BookForm onSubmit={onSubmit} onCancel={jest.fn()} />);
    expect(screen.queryByText(t.bookForm.ratingLabel)).toBeNull();

    await fireEvent.press(screen.getByRole('radio', { name: t.readingStatus.finished }));
    expect(screen.getByText(t.bookForm.ratingLabel)).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole('radio', { name: format(t.rating.starMany, { value: 5 }) }),
    );

    await fireEvent.press(screen.getByRole('radio', { name: t.readingStatus.to_read }));
    expect(screen.queryByText(t.bookForm.ratingLabel)).toBeNull();
  });

  it('keeps the entered data and shows the error when saving fails', async () => {
    const onSubmit = jest.fn(async () => ({ ok: false as const, message: 'server says no' }));
    await renderUi(<BookForm onSubmit={onSubmit} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.titleLabel)), 'Herbario');
    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.pagesLabel)), '120');
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(await screen.findByText('server says no')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Herbario')).toBeOnTheScreen();
  });
});
