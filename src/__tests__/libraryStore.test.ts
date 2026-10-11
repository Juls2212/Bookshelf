import type { BookRepository } from '@/features/library/bookRepository';
import { useAuthStore } from '@/stores/authStore';
import { bindLibraryToAuth, createLibraryStore } from '@/stores/libraryStore';
import type { Book } from '@/types/book';

jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('@/features/auth/authService', () => ({
  restoreSession: jest.fn(),
  onAuthStateChange: jest.fn(() => () => {}),
  signOut: jest.fn(),
}));

const book = (id: string, overrides: Partial<Book> = {}): Book => ({
  id,
  title: `Book ${id}`,
  author: null,
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

function fakeRepository(): jest.Mocked<BookRepository> {
  return {
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    setLoan: jest.fn(),
    clearLoan: jest.fn(),
  };
}

describe('libraryStore', () => {
  it('loads books and reports errors', async () => {
    const repo = fakeRepository();
    const store = createLibraryStore(repo);
    expect(store.getState().status).toBe('idle');

    repo.list.mockResolvedValueOnce({ ok: true, data: [book('a')] });
    const pending = store.getState().load();
    expect(store.getState().status).toBe('loading');
    await pending;
    expect(store.getState()).toMatchObject({
      status: 'ready',
      books: [{ id: 'a' }],
      errorCode: null,
    });

    repo.list.mockResolvedValueOnce({ ok: false, error: 'network_error' });
    await store.getState().refresh();
    // A failed background refresh keeps the books.
    expect(store.getState()).toMatchObject({ status: 'error', errorCode: 'network_error' });
    expect(store.getState().books).toHaveLength(1);
  });

  it('creates, updates, lends, returns and removes', async () => {
    const repo = fakeRepository();
    const store = createLibraryStore(repo);
    repo.list.mockResolvedValue({ ok: true, data: [book('a')] });
    await store.getState().load();

    repo.create.mockResolvedValue({ ok: true, data: book('b') });
    await store.getState().create({ title: 'Book b' });
    expect(store.getState().books.map((b) => b.id)).toEqual(['b', 'a']);

    repo.update.mockResolvedValue({ ok: true, data: book('a', { rating: 5 }) });
    await store.getState().update('a', { rating: 5 });
    expect(store.getState().books.find((b) => b.id === 'a')?.rating).toBe(5);

    repo.setLoan.mockResolvedValue({ ok: true, data: book('a', { lentTo: 'Laura', lentAt: 'x' }) });
    await store.getState().lend('a', 'Laura');
    expect(repo.setLoan).toHaveBeenCalledWith('a', 'Laura');
    expect(store.getState().books.find((b) => b.id === 'a')?.lentTo).toBe('Laura');

    repo.clearLoan.mockResolvedValue({ ok: true, data: book('a') });
    await store.getState().returnBook('a');
    expect(store.getState().books.find((b) => b.id === 'a')?.lentTo).toBeNull();

    repo.softDelete.mockResolvedValue({ ok: true, data: null });
    await store.getState().remove('b');
    expect(store.getState().books.map((b) => b.id)).toEqual(['a']);
  });

  it('keeps state unchanged when an action fails and returns the error', async () => {
    const repo = fakeRepository();
    const store = createLibraryStore(repo);
    repo.list.mockResolvedValue({ ok: true, data: [book('a')] });
    await store.getState().load();

    repo.softDelete.mockResolvedValue({ ok: false, error: 'network_error' });
    await expect(store.getState().remove('a')).resolves.toEqual({
      ok: false,
      error: 'network_error',
    });
    expect(store.getState().books).toHaveLength(1);
  });

  it('resets when the user signs out', async () => {
    const repo = fakeRepository();
    const store = createLibraryStore(repo);
    const onSignedOut = jest.fn();
    const unbind = bindLibraryToAuth(store, onSignedOut);
    repo.list.mockResolvedValue({ ok: true, data: [book('a')] });
    useAuthStore.setState({ status: 'signedIn' });
    await store.getState().load();

    useAuthStore.setState({ status: 'signedOut', session: null, user: null });
    expect(store.getState()).toMatchObject({ books: [], status: 'idle', errorCode: null });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    unbind();
  });
});
