import { addBook } from '@/features/library/addBook';
import {
  digitsOnly,
  emptyBookForm,
  toNewBook,
  validateBookForm,
  type BookFormValues,
} from '@/features/library/bookFormLogic';
import { currentReading, libraryCountLabel, recentBooks } from '@/features/library/libraryCopy';
import { t } from '@/i18n';
import type { Book } from '@/types/book';

jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));

const form = (overrides: Partial<BookFormValues>): BookFormValues => ({
  ...emptyBookForm,
  title: 'Los almendros',
  ...overrides,
});

describe('book form logic', () => {
  it('keeps digits only in numeric fields', () => {
    expect(digitsOnly('2a6-4 ')).toBe('264');
  });

  it('requires a title and validates pages, current page and rating', () => {
    expect(validateBookForm(emptyBookForm)).toEqual({ title: 'title_required' });
    expect(validateBookForm(form({ pages: '0' }))).toEqual({ pages: 'page_count_invalid' });
    expect(
      validateBookForm(form({ pages: '100', readingStatus: 'reading', currentPage: '120' })),
    ).toEqual({ currentPage: 'current_page_exceeds_total' });
    // The current page only matters while reading.
    expect(
      validateBookForm(form({ pages: '100', readingStatus: 'to_read', currentPage: '120' })),
    ).toEqual({});
  });

  it('builds the repository payload', () => {
    expect(
      toNewBook(
        form({
          title: '  Los almendros ',
          author: ' Marta Elena Ossa ',
          genre: '',
          pages: '312',
          readingStatus: 'reading',
          currentPage: '214',
          rating: 4,
          notes: '  ',
        }),
      ),
    ).toEqual({
      title: 'Los almendros',
      author: 'Marta Elena Ossa',
      genre: null,
      pageCount: 312,
      readingStatus: 'reading',
      currentPage: 214,
      rating: 4,
      notes: null,
    });
  });

  it('derives the current page from the status', () => {
    expect(toNewBook(form({ pages: '200', readingStatus: 'finished' })).currentPage).toBe(200);
    expect(toNewBook(form({ readingStatus: 'finished' })).currentPage).toBe(0);
    expect(toNewBook(form({ readingStatus: 'to_read', currentPage: '50' })).currentPage).toBe(0);
    expect(toNewBook(form({ readingStatus: 'reading', currentPage: '' })).currentPage).toBe(0);
  });
});

describe('addBook', () => {
  const book = { id: 'uuid-1', title: 'X' } as Book;
  const cover = { uri: 'file:///picked.jpg', width: 900, height: 1200 };

  function covers() {
    return {
      prepare: jest.fn(async () => ({
        ok: true as const,
        data: { uri: 'file:///prepared.jpg', width: 900, height: 1200 },
      })),
      upload: jest.fn(async () => ({ ok: true as const, data: 'user-1/uuid-1.jpg' })),
      remove: jest.fn(async () => ({ ok: true as const, data: null })),
    };
  }

  it('creates without a cover', async () => {
    const create = jest.fn(async () => ({ ok: true as const, data: book }));
    const c = covers();
    await addBook({ userId: 'user-1', input: { title: 'X' }, cover: null }, { create, covers: c });
    expect(c.upload).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      title: 'X',
      id: 'uuid-1',
      coverPath: null,
      coverSource: null,
    });
  });

  it('uploads the prepared cover with the pre-generated id before creating the row', async () => {
    const create = jest.fn(async () => ({ ok: true as const, data: book }));
    const c = covers();
    const result = await addBook(
      { userId: 'user-1', input: { title: 'X' }, cover },
      { create, covers: c, newId: () => 'uuid-1' },
    );
    expect(c.prepare).toHaveBeenCalledWith(cover);
    expect(c.upload).toHaveBeenCalledWith('user-1', 'uuid-1', 'file:///prepared.jpg');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'uuid-1',
        coverPath: 'user-1/uuid-1.jpg',
        coverSource: 'gallery',
      }),
    );
    expect(result).toEqual({ ok: true, data: book });
  });

  it('removes the uploaded cover when the row insert fails', async () => {
    const create = jest.fn(async () => ({ ok: false as const, error: 'network_error' as const }));
    const c = covers();
    const result = await addBook(
      { userId: 'user-1', input: { title: 'X' }, cover },
      { create, covers: c },
    );
    expect(c.remove).toHaveBeenCalledWith('user-1/uuid-1.jpg');
    expect(result).toEqual({ ok: false, error: 'network_error' });
  });

  it('reports an empty or invalid upload as a cover failure', async () => {
    const create = jest.fn();
    const c = covers();
    c.upload.mockResolvedValueOnce({ ok: false, error: 'unknown' } as never);
    const result = await addBook(
      { userId: 'user-1', input: { title: 'X' }, cover },
      { create, covers: c },
    );
    expect(result).toEqual({ ok: false, error: 'cover_failed' });
    expect(create).not.toHaveBeenCalled();
  });

  it('stops before creating when the cover cannot be uploaded', async () => {
    const create = jest.fn();
    const c = covers();
    c.upload.mockResolvedValueOnce({ ok: false, error: 'unauthorized' } as never);
    const result = await addBook(
      { userId: 'user-1', input: { title: 'X' }, cover },
      { create, covers: c },
    );
    expect(result).toEqual({ ok: false, error: 'cover_failed' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('library copy', () => {
  it('pluralizes the book count', () => {
    expect(libraryCountLabel(0)).toBe(t.library.countEmpty);
    expect(libraryCountLabel(1)).toBe('1 libro en tu estante');
    expect(libraryCountLabel(2)).toBe('2 libros en tus estantes');
    expect(libraryCountLabel(42)).toBe('42 libros en tus estantes');
  });

  const b = (id: string, overrides: Partial<Book>) => ({ id, ...overrides }) as Book;

  it('picks the most recently updated book being read', () => {
    const books = [
      b('a', { readingStatus: 'reading', updatedAt: '2026-10-01' }),
      b('b', { readingStatus: 'reading', updatedAt: '2026-10-05' }),
      b('c', { readingStatus: 'finished', updatedAt: '2026-10-09' }),
    ];
    expect(currentReading(books)?.id).toBe('b');
    expect(currentReading([books[2]])).toBeNull();
  });

  it('lists the most recently added books, excluding one', () => {
    const books = [
      b('a', { createdAt: '2026-10-01' }),
      b('b', { createdAt: '2026-10-03' }),
      b('c', { createdAt: '2026-10-02' }),
    ];
    expect(recentBooks(books, 2).map((x) => x.id)).toEqual(['b', 'c']);
    expect(recentBooks(books, 8, 'b').map((x) => x.id)).toEqual(['c', 'a']);
  });
});
