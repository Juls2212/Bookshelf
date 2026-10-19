// The real Librero: every state, every action, the history, and no mock data left anywhere.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import LibrarianScreen from '@/app/(tabs)/librarian';
import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import { filterHistory, librarianView } from '@/features/librarian/librarianView';
import { defaultPreferences } from '@/features/preferences/preferencesRules';
import type { Recommendation } from '@/features/recommendations/recommendationRules';
import { format, t } from '@/i18n';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useRecommendationsStore, type RecommendFailure } from '@/stores/recommendationsStore';
import { useSyncStore } from '@/stores/syncStore';
import type { Book } from '@/types/book';

// Node built-ins for the source checks below (the app tsconfig has no Node types).
type FsLike = {
  readFileSync(file: string, encoding: 'utf8'): string;
  existsSync(file: string): boolean;
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
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn() };
const mockParams: { mode?: string; seed?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/features/library/coverService', () => ({ coverService: {} }));
jest.mock('@/features/library/useCoverUris', () => ({ useCoverUris: <T,>(books: T[]) => books }));

const l = t.librarian;

const book = (id: string, overrides: Partial<Book> = {}): Book => ({
  id,
  title: `Libro ${id}`,
  author: 'Inés Carvajal',
  genre: 'Novela',
  pageCount: 212,
  coverPath: null,
  coverSource: null,
  readingStatus: 'to_read',
  currentPage: 0,
  rating: null,
  notes: null,
  lentTo: null,
  lentAt: null,
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:00:00.000Z',
  statusChangedAt: '2026-03-01T09:00:00.000Z',
  ...overrides,
});

const rec = (
  id: string,
  bookId: string,
  overrides: Partial<Recommendation> = {},
): Recommendation => ({
  id,
  kind: 'shelf',
  bookId,
  suggestion: null,
  rationale: `Motivo de ${bookId}.`,
  disposition: 'suggested',
  createdAt: new Date().toISOString(),
  pending: false,
  ...overrides,
});

const actions = () => ({
  requestRecommendation: jest.fn(async () => true),
  requestAnother: jest.fn(async () => true),
  markViewed: jest.fn(async () => true),
  saveForLater: jest.fn(async () => true),
  skip: jest.fn(async () => true),
  cancel: jest.fn(),
  startOver: jest.fn(async () => true),
  loadHistory: jest.fn(async () => undefined),
});

let store: ReturnType<typeof actions>;
let updateReadingStatus: jest.Mock;

function setup({
  books = [book('b1')],
  current = null as Recommendation | null,
  history = [] as Recommendation[],
  status = 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  error = null as RecommendFailure | null,
  offline = false,
  considerMood = true,
  favoriteGenres = ['novel', 'poetry'] as const,
} = {}) {
  store = actions();
  updateReadingStatus = jest.fn(async () => ({ ok: true }));
  useLibraryStore.setState({
    books,
    status: 'ready',
    load: jest.fn(),
    updateReadingStatus,
  } as never);
  useRecommendationsStore.setState({
    userId: 'u1',
    current,
    history,
    status,
    error,
    sessionSuggestedBookIds: [],
    ...store,
  });
  usePreferencesStore.setState({
    preferences: { ...defaultPreferences(), considerMood, favoriteGenres: [...favoriteGenres] },
  });
  useSyncStore.setState({ status: offline ? 'offline' : 'idle' });
}

const renderLibrarian = () =>
  render(
    <ThemeProvider>
      <ToastProvider>
        <LibrarianScreen />
      </ToastProvider>
    </ThemeProvider>,
  );

beforeEach(() => jest.clearAllMocks());

describe('view rules', () => {
  it('maps the store state to the screen state', () => {
    const current = rec('r1', 'b1');
    const base = { status: 'idle' as const, error: null, current: null, offline: false };
    expect(librarianView(base)).toEqual({ kind: 'invite', offline: false });
    expect(librarianView({ ...base, status: 'loading' })).toEqual({ kind: 'loading' });
    expect(librarianView({ ...base, current, status: 'ready' })).toEqual({
      kind: 'result',
      recommendation: current,
      offline: false,
    });
    expect(librarianView({ ...base, current, status: 'error', error: 'offline' })).toEqual({
      kind: 'result',
      recommendation: current,
      offline: true,
    });
    expect(librarianView({ ...base, status: 'error', error: 'rate_limited' })).toEqual({
      kind: 'error',
      error: 'rate_limited',
    });
    expect(librarianView({ ...base, status: 'error', error: 'exhausted' }).kind).toBe('exhausted');
  });

  it('filters the history', () => {
    const list = [rec('a', 'b1'), rec('b', 'b2', { disposition: 'read_later' })];
    expect(filterHistory(list, 'all')).toHaveLength(2);
    expect(filterHistory(list, 'read_later').map((r) => r.id)).toEqual(['b']);
  });
});

describe('initial state', () => {
  it('shows the intro, the preferences summary and the mood field; asks with the context', async () => {
    setup();
    await renderLibrarian();
    expect(screen.getByText(l.intro)).toBeOnTheScreen();
    expect(
      screen.getByText(
        format(l.prefsGenres, { genres: `${t.profile.genres.novel}, ${t.profile.genres.poetry}` }),
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('librarian-invite')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(l.contextLabel), 'algo corto');
    await fireEvent.press(screen.getByRole('button', { name: l.request }));
    expect(store.requestRecommendation).toHaveBeenCalledWith('algo corto', {
      availableTime: null,
      mood: null,
    });
    await fireEvent.press(screen.getByRole('link', { name: l.changePrefs }));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/profile');
  });

  it('without "consider mood" there is no mood field and no context is sent', async () => {
    setup({ considerMood: false, favoriteGenres: [] as never });
    await renderLibrarian();
    expect(screen.queryByLabelText(l.contextLabel)).toBeNull();
    expect(screen.getByText(l.titleNoMood)).toBeOnTheScreen();
    expect(screen.getByText(l.prefsNoGenres)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: l.request }));
    expect(store.requestRecommendation).toHaveBeenCalledWith('', {
      availableTime: null,
      mood: null,
    });
  });
});

describe('time and mood chips', () => {
  it('select one option per group, tap again to clear, and are sent with the request', async () => {
    setup();
    await renderLibrarian();
    const hour = () => screen.getByRole('button', { name: l.time.about_1_hour });
    await fireEvent.press(hour());
    expect(hour()).toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: l.time.no_rush }));
    expect(hour()).not.toBeSelected();
    expect(screen.getByRole('button', { name: l.time.no_rush })).toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: l.mood.calm }));
    await fireEvent.press(screen.getByRole('button', { name: l.request }));
    expect(store.requestRecommendation).toHaveBeenLastCalledWith('', {
      availableTime: 'no_rush',
      mood: 'calm',
    });

    // Tapping the selected chip clears it.
    await fireEvent.press(screen.getByRole('button', { name: l.time.no_rush }));
    await fireEvent.press(screen.getByRole('button', { name: l.mood.calm }));
    expect(screen.getByRole('button', { name: l.mood.calm })).not.toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: l.request }));
    expect(store.requestRecommendation).toHaveBeenLastCalledWith('', {
      availableTime: null,
      mood: null,
    });
  });

  it('the choices are kept for "Otra recomendación" and "Empezar de nuevo"', async () => {
    setup({ current: rec('r1', 'b1'), status: 'ready' });
    await renderLibrarian();
    await fireEvent.press(screen.getByRole('button', { name: l.time.under_30_min }));
    await fireEvent.press(screen.getByRole('link', { name: l.another }));
    expect(store.requestAnother).toHaveBeenCalledWith('', {
      availableTime: 'under_30_min',
      mood: null,
    });
  });

  it('without "consider mood" the mood chips are hidden and no mood is sent', async () => {
    setup();
    await renderLibrarian();
    await fireEvent.press(screen.getByRole('button', { name: l.mood.exciting }));
    await act(async () =>
      usePreferencesStore.setState({
        preferences: { ...defaultPreferences(), considerMood: false },
      }),
    );
    expect(screen.queryByText(l.moodLabel)).toBeNull();
    expect(screen.queryByRole('button', { name: l.mood.exciting })).toBeNull();
    expect(screen.getByText(l.timeLabel)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: l.time.two_hours_plus }));
    await fireEvent.press(screen.getByRole('button', { name: l.request }));
    expect(store.requestRecommendation).toHaveBeenCalledWith('', {
      availableTime: 'two_hours_plus',
      mood: null,
    });
  });
});

describe('loading', () => {
  it('shows the loading state; Cancelar really cancels', async () => {
    setup({ status: 'loading' });
    await renderLibrarian();
    expect(screen.getByTestId('librarian-loading')).toBeOnTheScreen();
    expect(screen.getByText(l.loading)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: l.cancel }));
    expect(store.cancel).toHaveBeenCalledTimes(1);
  });
});

describe('result', () => {
  const current = rec('r1', 'b1');

  it('shows the book, its data and the explanation', async () => {
    setup({ current, status: 'ready' });
    await renderLibrarian();
    expect(screen.getByRole('header', { name: 'Libro b1' })).toBeOnTheScreen();
    expect(
      screen.getByText(
        `${format(l.authorGenre, { author: 'Inés Carvajal', genre: 'Novela' })} · ${format(l.pages, { pages: 212 })}`,
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('Motivo de b1.')).toBeOnTheScreen();
  });

  it('"Empezar a leer" sets the status through the store, marks it viewed and opens the ficha', async () => {
    setup({ current, status: 'ready' });
    await renderLibrarian();
    await fireEvent.press(screen.getByRole('button', { name: l.startReading }));
    expect(updateReadingStatus).toHaveBeenCalledWith('b1', 'reading');
    expect(store.markViewed).toHaveBeenCalledWith('r1');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/book/[id]', params: { id: 'b1' } });
  });

  it('"Empezar a leer" shows an error and stays when the status cannot change', async () => {
    setup({ current, status: 'ready' });
    updateReadingStatus.mockResolvedValueOnce({ ok: false, error: 'unknown' });
    await renderLibrarian();
    await fireEvent.press(screen.getByRole('button', { name: l.startReading }));
    expect(await screen.findByText(l.startReadingFailed)).toBeOnTheScreen();
    expect(store.markViewed).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('"Leer después" saves it for later with a toast', async () => {
    setup({ current, status: 'ready' });
    await renderLibrarian();
    await fireEvent.press(screen.getByRole('button', { name: l.readLater }));
    expect(store.saveForLater).toHaveBeenCalledWith('r1');
    expect(await screen.findByText(t.toast.savedForLater)).toBeOnTheScreen();
  });

  it('a saved one shows its tag and a disabled "Guardado para después"', async () => {
    setup({ current: rec('r1', 'b1', { disposition: 'read_later' }), status: 'ready' });
    await renderLibrarian();
    expect(screen.getByRole('button', { name: l.savedLater })).toBeDisabled();
    expect(screen.getAllByText(l.dispositions.read_later).length).toBeGreaterThan(0);
  });

  it('"Ver ficha" marks it viewed and opens the ficha', async () => {
    setup({ current, status: 'ready' });
    await renderLibrarian();
    await fireEvent.press(screen.getByRole('link', { name: l.viewBook }));
    expect(store.markViewed).toHaveBeenCalledWith('r1');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/book/[id]', params: { id: 'b1' } });
  });

  it('"Otra recomendación" asks again (the store skips the old one once the new one arrives)', async () => {
    setup({ current, status: 'ready' });
    await renderLibrarian();
    await fireEvent.changeText(screen.getByLabelText(l.contextLabel), 'otra cosa');
    await fireEvent.press(screen.getByRole('link', { name: l.another }));
    expect(store.requestAnother).toHaveBeenCalledWith('otra cosa', {
      availableTime: null,
      mood: null,
    });
    expect(store.skip).not.toHaveBeenCalled();
  });

  it('a book already being read has no "Empezar a leer"', async () => {
    setup({ current, status: 'ready', books: [book('b1', { readingStatus: 'reading' })] });
    await renderLibrarian();
    expect(screen.queryByRole('button', { name: l.startReading })).toBeNull();
  });

  it('a recommended book that was deleted is shown as unavailable', async () => {
    setup({ current, status: 'ready', books: [] });
    await renderLibrarian();
    expect(screen.getByText(l.unavailableTitle)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: l.another }));
    expect(store.requestAnother).toHaveBeenCalledTimes(1);
  });
});

describe('errors and empty states', () => {
  it.each(['rate_limited', 'network', 'timeout', 'unauthorized', 'unknown'] as const)(
    '%s shows its message and "Reintentar"',
    async (error) => {
      setup({ status: 'error', error });
      await renderLibrarian();
      expect(screen.getByText(t.recommendations.errors[error])).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: l.retry }));
      expect(store.requestRecommendation).toHaveBeenCalledTimes(1);
    },
  );

  it('no_candidates explains it and offers to add a book', async () => {
    setup({ status: 'error', error: 'no_candidates' });
    await renderLibrarian();
    expect(screen.getByText(l.noCandidatesTitle)).toBeOnTheScreen();
    expect(screen.getByText(t.recommendations.errors.no_candidates)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: l.retry })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: l.addBook }));
    expect(mockRouter.push).toHaveBeenCalledWith('/book/new');
  });

  it('exhausted offers "Empezar de nuevo"', async () => {
    setup({ status: 'error', error: 'exhausted' });
    await renderLibrarian();
    expect(screen.getByText(l.exhaustedTitle)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: l.startOver }));
    expect(store.startOver).toHaveBeenCalledTimes(1);
  });

  it('offline: the cached recommendation with a note; no new request', async () => {
    setup({ current: rec('r1', 'b1'), status: 'ready', offline: true });
    await renderLibrarian();
    expect(screen.getByText(t.recommendations.errors.offline)).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Libro b1' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: l.request })).toBeDisabled();
    expect(screen.getAllByText(l.requestOfflineHint).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: l.another })).toBeNull();
  });

  it('offline without any cached recommendation keeps the invitation and the hint', async () => {
    setup({ offline: true });
    await renderLibrarian();
    expect(screen.getByTestId('librarian-invite')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: l.request })).toBeDisabled();
  });
});

describe('history', () => {
  const history = [
    rec('r3', 'b3', { createdAt: new Date().toISOString() }),
    rec('r2', 'gone', { disposition: 'skipped' }),
    rec('r1', 'b1', { disposition: 'read_later' }),
  ];

  async function openHistory(list = history) {
    setup({ books: [book('b1'), book('b3')], history: list });
    await renderLibrarian();
    await fireEvent.press(screen.getByRole('link', { name: l.history }));
  }

  it('lists past recommendations with date and disposition; tapping opens the ficha', async () => {
    await openHistory();
    expect(screen.getByText(l.historyTitle)).toBeOnTheScreen();
    const item = screen.getByRole('button', {
      name: format(l.historyItemA11y, {
        title: 'Libro b3',
        date: t.dates.today,
        disposition: l.dispositions.suggested,
      }),
    });
    await fireEvent.press(item);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/book/[id]', params: { id: 'b3' } });
  });

  it('a deleted book is unavailable and not tappable', async () => {
    await openHistory();
    const row = screen.getByTestId('history-unavailable-r2');
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(screen.getByText(l.historyUnavailable)).toBeOnTheScreen();
  });

  it('"Leer después" shows only the saved ones', async () => {
    await openHistory();
    await fireEvent.press(screen.getByRole('button', { name: l.historyFilters.read_later }));
    expect(screen.getByTestId('history-item-r1')).toBeOnTheScreen();
    expect(screen.queryByTestId('history-item-r3')).toBeNull();
    expect(screen.queryByTestId('history-unavailable-r2')).toBeNull();
  });

  it('empty states', async () => {
    await openHistory([]);
    expect(screen.getByText(l.historyEmpty)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: l.historyFilters.read_later }));
    expect(screen.getByText(l.historyEmptyLater)).toBeOnTheScreen();
  });
});

describe('arrival animation', () => {
  it('renders the card at rest when reduce motion is on', async () => {
    const reanimated = jest.requireMock<{ useReducedMotion: jest.Mock }>('react-native-reanimated');
    reanimated.useReducedMotion.mockReturnValue(true);
    try {
      setup({ current: rec('r1', 'b1'), status: 'ready' });
      await renderLibrarian();
      expect(screen.getByTestId('librarian-result')).toBeOnTheScreen();
      await act(async () => undefined);
    } finally {
      reanimated.useReducedMotion.mockReturnValue(false);
    }
  });
});

describe('no mock data left', () => {
  const src = path.join(__dirname, '..');

  it('the _mock folder, the scenario switcher and the mock view-model are gone', () => {
    expect(fs.existsSync(path.join(src, 'features', '_mock'))).toBe(false);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !full.endsWith('librarianScreen.test.tsx'))
          files.push(full);
      }
    };
    walk(src);
    const code = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    for (const needle of [
      '_mock/',
      'useMockData',
      'scenarioStore',
      'useScenarioStore',
      't.scenario',
    ]) {
      expect(code).not.toContain(needle);
    }
  });

  it('the fake fixtures are only used by the fake services (and tests)', () => {
    const users = [
      'features/scan/fakeBookIdentifier.ts',
      'features/suggestions/fakeBookSuggester.ts',
      'features/recommendations/fakeRecommendationService.ts',
    ];
    for (const rel of users) {
      expect(fs.readFileSync(path.join(src, rel), 'utf8')).toContain("from '@/dev/fakeFixtures'");
    }
    for (const rel of [
      'app/(tabs)/librarian.tsx',
      'app/(tabs)/index.tsx',
      'app/(tabs)/profile.tsx',
    ]) {
      expect(fs.readFileSync(path.join(src, rel), 'utf8')).not.toContain('fakeFixtures');
    }
  });
});
