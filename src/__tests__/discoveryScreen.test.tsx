// "Nuevas aventuras" in the Librero, its history entries and the prefilled add-book form.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import LibrarianScreen from '@/app/(tabs)/librarian';
import NewBookScreen from '@/app/book/new';
import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import { defaultPreferences } from '@/features/preferences/preferencesRules';
import type { Recommendation } from '@/features/recommendations/recommendationRules';
import { format, t } from '@/i18n';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useRecommendationsStore, type DiscoverFailure } from '@/stores/recommendationsStore';
import { useSyncStore } from '@/stores/syncStore';
import type { Book } from '@/types/book';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'new-id') }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn() };
const mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/features/library/coverService', () => ({ coverService: {} }));
jest.mock('@/features/library/useCoverUris', () => ({ useCoverUris: <T,>(books: T[]) => books }));
jest.mock('@/stores/authStore', () => {
  const state = { user: { id: 'user-1' } };
  const useAuthStore = <T,>(selector: (s: typeof state) => T) => selector(state);
  useAuthStore.getState = () => state;
  useAuthStore.subscribe = () => () => undefined;
  return { useAuthStore };
});
const mockAddBook = jest.fn();
jest.mock('@/features/library/addBook', () => ({
  addBook: (...args: unknown[]) => mockAddBook(...args),
}));

const l = t.librarian;
const d = t.librarian.discovery;

const book = (id: string, title: string): Book => ({
  id,
  title,
  author: 'Autora',
  genre: 'Novela',
  pageCount: 200,
  coverPath: null,
  coverSource: null,
  readingStatus: 'finished',
  currentPage: 200,
  rating: 5,
  notes: null,
  lentTo: null,
  lentAt: null,
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:00:00.000Z',
  statusChangedAt: '2026-03-01T09:00:00.000Z',
});

const suggestion = (
  overrides: Partial<NonNullable<Recommendation['suggestion']>> = {},
  rec: Partial<Recommendation> = {},
): Recommendation => ({
  id: 'disc-1',
  kind: 'discovery',
  bookId: null,
  suggestion: {
    title: 'La hojarasca',
    author: 'Gabriel García Márquez',
    genre: 'Novela',
    pageCount: 144,
    verified: true,
    confidence: 'high',
    ...overrides,
  },
  rationale: 'Valoraste con 5 estrellas varias novelas cortas.',
  disposition: 'suggested',
  createdAt: new Date().toISOString(),
  pending: false,
  ...rec,
});

let store: Record<string, jest.Mock>;

function setup({
  currentDiscovery = null as Recommendation | null,
  history = [] as Recommendation[],
  discoveryStatus = 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  discoveryError = null as DiscoverFailure | null,
  offline = false,
  considerMood = true,
  books = [book('b1', 'Pedro Páramo'), book('b2', 'Rayuela')],
} = {}) {
  store = {
    requestRecommendation: jest.fn(async () => true),
    requestDiscovery: jest.fn(async () => true),
    requestAnotherDiscovery: jest.fn(async () => true),
    markViewed: jest.fn(async () => true),
    saveForLater: jest.fn(async () => true),
    skip: jest.fn(async () => true),
    saveIdea: jest.fn(async () => true),
    markAdded: jest.fn(async () => true),
    cancel: jest.fn(),
    cancelDiscovery: jest.fn(),
    startOver: jest.fn(async () => true),
    loadHistory: jest.fn(async () => undefined),
  };
  useLibraryStore.setState({ books, status: 'ready', load: jest.fn() } as never);
  useRecommendationsStore.setState({
    userId: 'user-1',
    current: null,
    currentDiscovery,
    history,
    status: 'idle',
    error: null,
    discoveryStatus,
    discoveryError,
    sessionSuggestedBookIds: [],
    sessionDiscoveryExclusions: [],
    ...store,
  } as never);
  usePreferencesStore.setState({ preferences: { ...defaultPreferences(), considerMood } });
  useSyncStore.setState({ status: offline ? 'offline' : 'idle' });
}

const ui = (node: React.ReactElement) => (
  <ThemeProvider>
    <ToastProvider>{node}</ToastProvider>
  </ThemeProvider>
);

async function openDiscovery() {
  await render(ui(<LibrarianScreen />));
  await fireEvent.press(screen.getByRole('radio', { name: l.modes.discovery }));
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockParams)) delete mockParams[key];
});

describe('Nuevas aventuras: request', () => {
  it('the segmented control switches modes; shelf mode is unchanged', async () => {
    setup();
    await render(ui(<LibrarianScreen />));
    expect(screen.getByRole('radio', { name: l.modes.shelf })).toBeChecked();
    expect(screen.getByRole('button', { name: l.request })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: l.modes.discovery }));
    expect(screen.getByRole('header', { name: d.title })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: l.request })).toBeNull();
    expect(screen.getByTestId('discovery-invite')).toBeOnTheScreen();
  });

  it('asks with "based on my favorites" by default, mood and text', async () => {
    setup();
    await openDiscovery();
    expect(
      screen.getByRole('button', { name: format(d.seedA11y, { seed: d.seedFavorites }) }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: l.mood.calm }));
    await fireEvent.changeText(screen.getByLabelText(l.contextLabel), 'algo corto');
    await fireEvent.press(screen.getByRole('button', { name: d.request }));
    expect(store.requestDiscovery).toHaveBeenCalledWith({
      seedBookId: null,
      mood: 'calm',
      context: 'algo corto',
    });
  });

  it('"Parecido a…" picks one of the user\'s books (and back to favorites)', async () => {
    setup();
    await openDiscovery();
    await fireEvent.press(screen.getByTestId('seed-button'));
    expect(screen.getByRole('header', { name: d.seedSheetTitle })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'Rayuela, Autora' }));
    expect(
      screen.getByRole('button', { name: format(d.seedA11y, { seed: 'Rayuela' }) }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: d.request }));
    expect(store.requestDiscovery).toHaveBeenLastCalledWith(
      expect.objectContaining({ seedBookId: 'b2' }),
    );

    await fireEvent.press(screen.getByTestId('seed-button'));
    await fireEvent.press(screen.getByRole('radio', { name: d.seedFavorites }));
    await fireEvent.press(screen.getByRole('button', { name: d.request }));
    expect(store.requestDiscovery).toHaveBeenLastCalledWith(
      expect.objectContaining({ seedBookId: null }),
    );
  });

  it('without "consider mood" no mood or text is asked or sent', async () => {
    setup({ considerMood: false });
    await openDiscovery();
    expect(screen.queryByText(l.moodLabel)).toBeNull();
    expect(screen.queryByLabelText(l.contextLabel)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: d.request }));
    expect(store.requestDiscovery).toHaveBeenCalledWith({
      seedBookId: null,
      mood: null,
      context: '',
    });
  });

  it('opened from a ficha ("Buscar parecidos"): Nuevas aventuras with that book selected', async () => {
    setup();
    mockParams.mode = 'discovery';
    mockParams.seed = 'b1';
    await render(ui(<LibrarianScreen />));
    expect(screen.getByRole('radio', { name: l.modes.discovery })).toBeChecked();
    expect(
      screen.getByRole('button', { name: format(d.seedA11y, { seed: 'Pedro Páramo' }) }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: d.request }));
    expect(store.requestDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({ seedBookId: 'b1' }),
    );
  });

  it('loading has a real Cancelar', async () => {
    setup({ discoveryStatus: 'loading' });
    await openDiscovery();
    expect(screen.getByText(d.loading)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: l.cancel }));
    expect(store.cancelDiscovery).toHaveBeenCalledTimes(1);
  });
});

describe('Nuevas aventuras: result', () => {
  it('is tagged outside the shelf, verified, with the AI disclaimer', async () => {
    setup({ currentDiscovery: suggestion(), discoveryStatus: 'ready' });
    await openDiscovery();
    expect(screen.getByRole('header', { name: 'La hojarasca' })).toBeOnTheScreen();
    expect(screen.getByText(d.outsideTag)).toBeOnTheScreen();
    expect(
      screen.getByText('Gabriel García Márquez · Novela · ' + format(l.pages, { pages: 144 })),
    ).toBeOnTheScreen();
    expect(screen.getByText('Valoraste con 5 estrellas varias novelas cortas.')).toBeOnTheScreen();
    expect(screen.getByText(d.verified)).toBeOnTheScreen();
    expect(screen.getByText(d.aiDisclaimer)).toBeOnTheScreen();
    expect(screen.queryByText(d.lowConfidence)).toBeNull();
  });

  it('unverified and low-confidence suggestions say so', async () => {
    setup({
      currentDiscovery: suggestion({ verified: false, confidence: 'low', pageCount: null }),
      discoveryStatus: 'ready',
    });
    await openDiscovery();
    expect(screen.getByText(d.unverified)).toBeOnTheScreen();
    expect(screen.getByText(d.lowConfidence)).toBeOnTheScreen();
    expect(screen.getByText('Gabriel García Márquez · Novela')).toBeOnTheScreen();
  });

  it('"Añadir a mi estante" opens the prefilled, editable add form', async () => {
    setup({ currentDiscovery: suggestion(), discoveryStatus: 'ready' });
    await openDiscovery();
    await fireEvent.press(screen.getByRole('button', { name: d.add }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/book/new',
      params: {
        title: 'La hojarasca',
        author: 'Gabriel García Márquez',
        genre: 'Novela',
        pages: '144',
        suggestion: 'disc-1',
      },
    });
  });

  it('"Guardar idea" saves it with a toast; a saved one shows "Idea guardada"', async () => {
    setup({ currentDiscovery: suggestion(), discoveryStatus: 'ready' });
    await openDiscovery();
    await fireEvent.press(screen.getByRole('button', { name: d.saveIdea }));
    expect(store.saveIdea).toHaveBeenCalledWith('disc-1');
    expect(await screen.findByText(d.ideaSavedToast)).toBeOnTheScreen();
  });

  it('"Otra sugerencia" asks again with the same input (skipping happens in the store)', async () => {
    setup({ currentDiscovery: suggestion(), discoveryStatus: 'ready' });
    await openDiscovery();
    await fireEvent.press(screen.getByRole('link', { name: d.another }));
    expect(store.requestAnotherDiscovery).toHaveBeenCalledWith({
      seedBookId: null,
      mood: null,
      context: '',
    });
    expect(store.skip).not.toHaveBeenCalled();
  });

  it('offline: the cached suggestion with a note; the request is disabled', async () => {
    setup({ currentDiscovery: suggestion(), discoveryStatus: 'ready', offline: true });
    await openDiscovery();
    expect(screen.getByText(d.offlineNote)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: d.request })).toBeDisabled();
    expect(screen.getAllByText(d.offlineHint).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: d.another })).toBeNull();
  });

  it.each([
    ['network', true],
    ['timeout', true],
    ['unknown', true],
    ['rate_limited', false],
    ['unauthorized', false],
    ['no_new_suggestions', false],
  ] as const)('%s shows its message (Reintentar: %s)', async (error, retry) => {
    setup({ discoveryStatus: 'error', discoveryError: error });
    await openDiscovery();
    expect(screen.getByText(t.discoveryErrors[error])).toBeOnTheScreen();
    const button = screen.queryByRole('button', { name: l.retry });
    if (retry) {
      await fireEvent.press(button!);
      expect(store.requestDiscovery).toHaveBeenCalledTimes(1);
    } else {
      expect(button).toBeNull();
    }
  });
});

describe('history with discovery entries', () => {
  it('shows them tagged; a saved idea offers "Añadir a mi estante"', async () => {
    setup({
      history: [
        suggestion({}, { id: 'disc-1', disposition: 'read_later' }),
        suggestion({ title: 'Descartado' }, { id: 'disc-2', disposition: 'skipped' }),
      ],
    });
    await render(ui(<LibrarianScreen />));
    await fireEvent.press(screen.getByRole('link', { name: l.history }));
    expect(screen.getByTestId('history-discovery-disc-1')).toBeOnTheScreen();
    expect(screen.getAllByText(d.outsideTag)).toHaveLength(2);
    const addButtons = screen.getAllByRole('button', { name: d.add });
    expect(addButtons).toHaveLength(1);
    await fireEvent.press(addButtons[0]);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/book/new',
      params: expect.objectContaining({ title: 'La hojarasca', suggestion: 'disc-1' }),
    });
  });

  it('the "Leer después" filter keeps working with both kinds', async () => {
    setup({
      history: [
        suggestion({}, { id: 'disc-1', disposition: 'read_later' }),
        suggestion({ title: 'Otro' }, { id: 'disc-2' }),
      ],
    });
    await render(ui(<LibrarianScreen />));
    await fireEvent.press(screen.getByRole('link', { name: l.history }));
    await fireEvent.press(screen.getByRole('button', { name: l.historyFilters.read_later }));
    expect(screen.getByTestId('history-discovery-disc-1')).toBeOnTheScreen();
    expect(screen.queryByTestId('history-discovery-disc-2')).toBeNull();
  });
});

describe('add-book form from a suggestion', () => {
  it('opens prefilled and editable, and marks the suggestion once saved', async () => {
    setup();
    Object.assign(mockParams, {
      title: 'La hojarasca',
      author: 'Gabriel García Márquez',
      genre: 'Novela',
      pages: '144',
      suggestion: 'disc-1',
    });
    mockAddBook.mockResolvedValue({ ok: true, data: { id: 'new-book' } });
    await render(ui(<NewBookScreen />));
    expect(screen.getByText(t.bookForm.fromSuggestion)).toBeOnTheScreen();
    expect(screen.getByDisplayValue('La hojarasca')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('144')).toBeOnTheScreen();
    // Editable like any other book.
    await fireEvent.changeText(screen.getByDisplayValue('144'), '160');
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(mockAddBook).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ title: 'La hojarasca', pageCount: 160 }),
      }),
      expect.anything(),
    );
    await act(async () => undefined);
    expect(store.markAdded).toHaveBeenCalledWith('disc-1');
  });

  it('a normal add form marks nothing', async () => {
    setup();
    mockAddBook.mockResolvedValue({ ok: true, data: { id: 'new-book' } });
    await render(ui(<NewBookScreen />));
    expect(screen.getByText(t.bookForm.subtitle)).toBeOnTheScreen();
    expect(screen.queryByDisplayValue('La hojarasca')).toBeNull();
    expect(store.markAdded).not.toHaveBeenCalled();
  });
});
