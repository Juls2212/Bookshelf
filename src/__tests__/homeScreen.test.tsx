import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeScreen from '@/app/(tabs)/index';
import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import { es } from '@/i18n/es';
import { format, t } from '@/i18n';
import { useRecommendationsStore } from '@/stores/recommendationsStore';
import { useSyncStore } from '@/stores/syncStore';
import type { Book } from '@/types/book';

// Node built-ins for the source checks below (the app tsconfig has no Node types).
type FsLike = {
  readFileSync(file: string, encoding: 'utf8'): string;
  readdirSync(
    dir: string,
    options: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean }[];
};
type PathLike = { join(...parts: string[]): string };
const fs = jest.requireActual<FsLike>('fs');
const path = jest.requireActual<PathLike>('path');
declare const __dirname: string;

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/features/library/coverService', () => ({ coverService: {} }));
jest.mock('@/features/library/useCoverUris', () => ({ useCoverUris: <T,>(books: T[]) => books }));
jest.mock('@/features/profile/displayName', () => ({
  firstNameOf: (name: string | null) => name,
  useDisplayName: () => null,
}));

type MockState = {
  books: Book[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  errorCode: string | null;
  load: jest.Mock;
  refresh: jest.Mock;
  updateCurrentPage: jest.Mock;
};
const mockLibrary: { state: MockState } = {
  state: {
    books: [],
    status: 'ready',
    errorCode: null,
    load: jest.fn(),
    refresh: jest.fn(),
    updateCurrentPage: jest.fn(),
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
  genre: null,
  pageCount: 312,
  coverPath: null,
  coverSource: null,
  readingStatus: 'to_read',
  currentPage: 0,
  rating: null,
  notes: null,
  lentTo: null,
  lentAt: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  statusChangedAt: '2026-10-01T09:00:00.000Z',
  ...overrides,
});

function setLibrary(partial: Partial<MockState>) {
  mockLibrary.state = {
    books: [],
    status: 'ready',
    errorCode: null,
    load: jest.fn(),
    refresh: jest.fn(),
    updateCurrentPage: jest.fn(),
    ...partial,
  };
}

const renderHome = () =>
  render(
    <ThemeProvider>
      <ToastProvider>
        <HomeScreen />
      </ToastProvider>
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  // The library was downloaded on this device before (first-run states are tested elsewhere).
  useSyncStore.setState({ initialPullDone: true });
});

describe('Inicio', () => {
  it('loads the library on first open', async () => {
    setLibrary({ status: 'idle' });
    await renderHome();
    expect(mockLibrary.state.load).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t.home.readingLabel)).toBeNull();
  });

  it('shows the empty library with a CTA to add a book', async () => {
    setLibrary({ books: [] });
    await renderHome();
    expect(screen.getByText(t.emptyLibrary.title)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: t.emptyLibrary.addManually }));
    expect(mockRouter.push).toHaveBeenCalledWith('/book/new');
  });

  it('invites to start a book when none is being read, and hides empty sections', async () => {
    setLibrary({ books: [book('a')] });
    await renderHome();
    expect(screen.getByText(t.home.noReadingTitle)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: t.home.noReadingAction }));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/library');
  });

  it('shows the error state with retry when nothing could be loaded', async () => {
    setLibrary({ status: 'error', errorCode: 'network_error' });
    await renderHome();
    expect(screen.getByText(t.library.errorOffline)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: t.library.retry }));
    expect(mockLibrary.state.load).toHaveBeenCalledTimes(1);
  });

  it('shows the most recent reading book with its progress and opens the ficha', async () => {
    setLibrary({
      books: [
        book('older', {
          readingStatus: 'reading',
          currentPage: 10,
          updatedAt: '2026-10-02T09:00:00Z',
        }),
        book('current', {
          readingStatus: 'reading',
          currentPage: 214,
          updatedAt: '2026-10-08T09:00:00Z',
        }),
        book('shelf'),
      ],
    });
    await renderHome();
    expect(screen.getAllByText('Title current').length).toBeGreaterThan(0);
    expect(screen.getByText(format(t.home.pageOf, { page: 214, total: 312 }))).toBeOnTheScreen();
    expect(screen.getByText(format(t.bookDetail.percent, { percent: 69 }))).toBeOnTheScreen();

    await fireEvent.press(
      screen.getByRole('button', { name: format(t.home.openBookA11y, { title: 'Title current' }) }),
    );
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/book/[id]',
      params: { id: 'current' },
    });
  });

  it('"Mi página" opens the shared update-page sheet and saves through the store', async () => {
    setLibrary({ books: [book('current', { readingStatus: 'reading', currentPage: 214 })] });
    mockLibrary.state.updateCurrentPage.mockResolvedValue({
      ok: true,
      data: book('current', { readingStatus: 'reading', currentPage: 250 }),
    });
    await renderHome();
    await fireEvent.press(screen.getByRole('button', { name: t.home.myPage }));
    expect(screen.getByText(t.reading.pageSheetTitle)).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText(t.reading.pageLabel), '250');
    await fireEvent.press(screen.getByRole('button', { name: t.reading.pageSave }));
    expect(mockLibrary.state.updateCurrentPage).toHaveBeenCalledWith('current', 250);
    expect(await screen.findByText(t.toast.pageUpdated)).toBeOnTheScreen();
  });
});

describe('Inicio: "Tu lectura"', () => {
  it('shows the statistics card under the reading card when there are books', async () => {
    setLibrary({ books: [book('a', { readingStatus: 'reading', currentPage: 12 })] });
    await renderHome();
    expect(screen.getByText(t.home.stats.title)).toBeOnTheScreen();
    // Nothing logged today: the friendly zero state; the library itself is in Total.
    expect(screen.getByText(t.home.stats.todayEmpty)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: t.home.stats.periods.all }));
    expect(screen.getByLabelText(`12 ${t.home.stats.pages.all.many}`)).toBeOnTheScreen();
  });

  it('is not shown for an empty library', async () => {
    setLibrary({ books: [] });
    await renderHome();
    expect(screen.queryByTestId('reading-stats')).toBeNull();
  });
});

describe('Inicio: "Tu librero te espera"', () => {
  afterEach(() => useRecommendationsStore.setState({ current: null }));

  it('without a recommendation invites to visit the Librero', async () => {
    setLibrary({ books: [book('a')] });
    await renderHome();
    expect(screen.getByText(t.home.noRecommendationTitle)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: t.home.noRecommendationAction }));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/librarian');
  });

  it('shows the last recommendation (title and explanation) and goes to the Librero', async () => {
    setLibrary({ books: [book('a', { title: 'Mapa de sal' })] });
    useRecommendationsStore.setState({
      current: {
        id: 'r1',
        kind: 'shelf',
        suggestion: null,
        bookId: 'a',
        rationale: 'Es corta y encaja con tu ánimo.',
        disposition: 'suggested',
        createdAt: '2026-10-11T10:00:00.000Z',
        pending: false,
      },
    });
    await renderHome();
    expect(screen.getByText('Mapa de sal')).toBeOnTheScreen();
    expect(screen.getByText('Es corta y encaja con tu ánimo.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: t.home.recommendationAction }));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/librarian');
  });

  it('a recommendation whose book was deleted falls back to the invitation', async () => {
    setLibrary({ books: [book('a')] });
    useRecommendationsStore.setState({
      current: {
        id: 'r1',
        kind: 'shelf',
        suggestion: null,
        bookId: 'gone',
        rationale: 'x',
        disposition: 'suggested',
        createdAt: '2026-10-11T10:00:00.000Z',
        pending: false,
      },
    });
    await renderHome();
    expect(screen.getByText(t.home.noRecommendationTitle)).toBeOnTheScreen();
  });
});

describe('shared sheet and i18n cleanup', () => {
  const src = path.join(__dirname, '..');
  const read = (rel: string) => fs.readFileSync(path.join(src, rel), 'utf8');

  it('the ficha and Inicio reuse the same UpdatePageSheet (no local copy)', () => {
    for (const rel of ['app/book/[id].tsx', 'app/(tabs)/index.tsx']) {
      const code = read(rel);
      expect(code).toContain("from '@/features/library/UpdatePageSheet'");
      expect(code).not.toMatch(/function UpdatePageSheet/);
    }
  });

  const removed = [
    'toast.comingSoon',
    'toast.markedLent',
    'bookDetail.lentToast',
    'bookDetail.returnedToast',
    'bookDetail.deletedToast',
    'reading.pageSaved',
    'bookDetail.noNotes',
    'bookDetail.noRating',
    'bookDetail.updatePageTitle',
    'home.seeRecommendation',
  ];

  it('removed keys are gone from the dictionary', () => {
    for (const key of removed) {
      const [group, leaf] = key.split('.');
      expect(Object.keys(es[group as keyof typeof es])).not.toContain(leaf);
    }
  });

  it('removed keys are not referenced anywhere in src', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !full.endsWith('homeScreen.test.tsx'))
          files.push(full);
      }
    };
    walk(src);
    const code = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    for (const key of removed) expect(code).not.toContain(`t.${key}`);
  });
});
