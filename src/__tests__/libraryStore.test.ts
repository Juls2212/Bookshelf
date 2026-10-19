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
    await store.getState().create({ title: 'Book b', pageCount: 200 });
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

  it('updates the reading status optimistically and confirms with the server copy', async () => {
    const repo = fakeRepository();
    const store = createLibraryStore(repo);
    repo.list.mockResolvedValue({
      ok: true,
      data: [book('a', { readingStatus: 'to_read', pageCount: 200 })],
    });
    await store.getState().load();

    let resolveUpdate: (value: unknown) => void = () => {};
    repo.update.mockReturnValue(new Promise((resolve) => (resolveUpdate = resolve)) as never);
    const pending = store.getState().updateReadingStatus('a', 'reading');

    // Optimistic: the rules already applied (page 1 when the total is known).
    expect(store.getState().books[0]).toMatchObject({ readingStatus: 'reading', currentPage: 1 });
    expect(repo.update).toHaveBeenCalledWith('a', { readingStatus: 'reading', currentPage: 1 });

    const saved = book('a', { readingStatus: 'reading', currentPage: 1, pageCount: 200 });
    resolveUpdate({ ok: true, data: saved });
    await pending;
    expect(store.getState().books[0]).toBe(saved);
  });

  it('rolls the status back when the server rejects it', async () => {
    const repo = fakeRepository();
    const store = createLibraryStore(repo);
    const original = book('a', { readingStatus: 'reading', currentPage: 50, pageCount: 200 });
    repo.list.mockResolvedValue({ ok: true, data: [original] });
    await store.getState().load();

    repo.update.mockResolvedValue({ ok: false, error: 'network_error' });
    const result = await store.getState().updateReadingStatus('a', 'finished');
    expect(result).toEqual({ ok: false, error: 'network_error' });
    expect(store.getState().books[0]).toBe(original);
  });

  it('validates the page before touching anything', async () => {
    const repo = fakeRepository();
    const store = createLibraryStore(repo);
    const original = book('a', { readingStatus: 'reading', currentPage: 50, pageCount: 200 });
    repo.list.mockResolvedValue({ ok: true, data: [original] });
    await store.getState().load();

    await expect(store.getState().updateCurrentPage('a', 250)).resolves.toEqual({
      ok: false,
      error: 'validation_failed',
      issues: ['current_page_exceeds_total'],
    });
    expect(repo.update).not.toHaveBeenCalled();
    expect(store.getState().books[0]).toBe(original);
  });

  it('finishes the book on its last page and rolls back on failure', async () => {
    const repo = fakeRepository();
    const store = createLibraryStore(repo);
    const original = book('a', { readingStatus: 'reading', currentPage: 50, pageCount: 200 });
    repo.list.mockResolvedValue({ ok: true, data: [original] });
    await store.getState().load();

    repo.update.mockResolvedValueOnce({
      ok: true,
      data: book('a', { readingStatus: 'finished', currentPage: 200, pageCount: 200 }),
    });
    await store.getState().updateCurrentPage('a', 200);
    expect(repo.update).toHaveBeenLastCalledWith('a', {
      readingStatus: 'finished',
      currentPage: 200,
    });
    expect(store.getState().books[0]).toMatchObject({ readingStatus: 'finished' });

    const current = store.getState().books[0];
    repo.update.mockResolvedValueOnce({ ok: false, error: 'unknown' });
    await store.getState().updateCurrentPage('a', 120);
    expect(store.getState().books[0]).toBe(current);
  });

  it('does not overwrite a newer change when an older request fails', async () => {
    const repo = fakeRepository();
    const store = createLibraryStore(repo);
    repo.list.mockResolvedValue({
      ok: true,
      data: [book('a', { readingStatus: 'reading', currentPage: 50, pageCount: 200 })],
    });
    await store.getState().load();

    let failFirst: (value: unknown) => void = () => {};
    repo.update.mockReturnValueOnce(new Promise((resolve) => (failFirst = resolve)) as never);
    const first = store.getState().updateCurrentPage('a', 60);
    const newer = book('a', { readingStatus: 'reading', currentPage: 70, pageCount: 200 });
    repo.update.mockResolvedValueOnce({ ok: true, data: newer });
    await store.getState().updateCurrentPage('a', 70);

    failFirst({ ok: false, error: 'network_error' });
    await first;
    expect(store.getState().books[0]).toBe(newer);
  });

  it('sets, clears and rolls back the rating', async () => {
    const repo = fakeRepository();
    const store = createLibraryStore(repo);
    const original = book('a', { rating: 3, readingStatus: 'finished' });
    repo.list.mockResolvedValue({ ok: true, data: [original] });
    await store.getState().load();

    repo.update.mockResolvedValueOnce({
      ok: true,
      data: book('a', { rating: 5, readingStatus: 'finished' }),
    });
    await store.getState().updateRating('a', 5);
    expect(repo.update).toHaveBeenLastCalledWith('a', { rating: 5 });
    expect(store.getState().books[0].rating).toBe(5);

    repo.update.mockResolvedValueOnce({
      ok: true,
      data: book('a', { rating: null, readingStatus: 'finished' }),
    });
    await store.getState().updateRating('a', null);
    expect(repo.update).toHaveBeenLastCalledWith('a', { rating: null });
    expect(store.getState().books[0].rating).toBeNull();

    const current = store.getState().books[0];
    repo.update.mockResolvedValueOnce({ ok: false, error: 'network_error' });
    const failed = store.getState().updateRating('a', 2);
    // Optimistic first...
    expect(store.getState().books[0].rating).toBe(2);
    await expect(failed).resolves.toEqual({ ok: false, error: 'network_error' });
    // ...then rolled back.
    expect(store.getState().books[0]).toBe(current);

    await expect(store.getState().updateRating('a', 6)).resolves.toEqual({
      ok: false,
      error: 'validation_failed',
      issues: ['rating_invalid'],
    });
  });

  it('saves trimmed notes, stores empty notes as null and rolls back on failure', async () => {
    const repo = fakeRepository();
    const store = createLibraryStore(repo);
    const original = book('a', { notes: 'Old note' });
    repo.list.mockResolvedValue({ ok: true, data: [original] });
    await store.getState().load();

    repo.update.mockResolvedValueOnce({ ok: true, data: book('a', { notes: 'New note' }) });
    await store.getState().updateNotes('a', '  New note  ');
    expect(repo.update).toHaveBeenLastCalledWith('a', { notes: 'New note' });

    repo.update.mockResolvedValueOnce({ ok: true, data: book('a', { notes: null }) });
    await store.getState().updateNotes('a', '   ');
    expect(repo.update).toHaveBeenLastCalledWith('a', { notes: null });

    const current = store.getState().books[0];
    repo.update.mockResolvedValueOnce({ ok: false, error: 'unknown' });
    await store.getState().updateNotes('a', 'Will fail');
    expect(store.getState().books[0]).toBe(current);

    await expect(store.getState().updateNotes('a', 'x'.repeat(2001))).resolves.toEqual({
      ok: false,
      error: 'validation_failed',
      issues: ['notes_too_long'],
    });
  });

  it('clears the rating when the status leaves finished', async () => {
    const repo = fakeRepository();
    const store = createLibraryStore(repo);
    repo.list.mockResolvedValue({
      ok: true,
      data: [book('a', { readingStatus: 'finished', pageCount: 200, currentPage: 200, rating: 5 })],
    });
    await store.getState().load();

    repo.update.mockResolvedValue({ ok: true, data: book('a', { readingStatus: 'to_read' }) });
    await store.getState().updateReadingStatus('a', 'to_read');
    expect(repo.update).toHaveBeenCalledWith('a', {
      readingStatus: 'to_read',
      currentPage: 0,
      rating: null,
    });
  });

  it('refuses a rating for a book that is not finished', async () => {
    const repo = fakeRepository();
    const store = createLibraryStore(repo);
    repo.list.mockResolvedValue({ ok: true, data: [book('a', { readingStatus: 'reading' })] });
    await store.getState().load();
    await expect(store.getState().updateRating('a', 4)).resolves.toEqual({
      ok: false,
      error: 'validation_failed',
      issues: ['rating_requires_finished'],
    });
    expect(repo.update).not.toHaveBeenCalled();
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
