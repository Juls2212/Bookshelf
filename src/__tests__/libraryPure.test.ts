import {
  newBookToInsert,
  patchToUpdate,
  rowToBook,
  type BookRowSelection,
} from '@/features/library/bookMapper';
import {
  bookValidationMessage,
  validateBook,
  validatePageCount,
  validateLentTo,
  type BookValidationCode,
} from '@/features/library/bookValidation';
import { filterBooks, normalizeText, relatedBooks } from '@/features/library/filterBooks';
import { t } from '@/i18n';
import type { Book } from '@/types/book';

const row: BookRowSelection = {
  id: 'b1',
  title: 'Los almendros',
  author: null,
  genre: 'Novela',
  page_count: 312,
  cover_path: 'u1/b1.jpg',
  cover_source: 'gallery',
  reading_status: 'reading',
  current_page: 214,
  rating: null,
  notes: null,
  lent_to: null,
  lent_at: null,
  status_changed_at: '2026-10-02T09:00:00.000Z',
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-03T09:00:00.000Z',
};

function book(overrides: Partial<Book>): Book {
  return { ...rowToBook(row), ...overrides };
}

describe('bookMapper', () => {
  it('maps a row to a Book (null-safe)', () => {
    expect(rowToBook(row)).toEqual({
      id: 'b1',
      title: 'Los almendros',
      author: null,
      genre: 'Novela',
      pageCount: 312,
      coverPath: 'u1/b1.jpg',
      coverSource: 'gallery',
      readingStatus: 'reading',
      currentPage: 214,
      rating: null,
      notes: null,
      lentTo: null,
      lentAt: null,
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-03T09:00:00.000Z',
      statusChangedAt: '2026-10-02T09:00:00.000Z',
    });
  });

  it('builds an insert with trimmed text, defaults and status_changed_at', () => {
    expect(
      newBookToInsert(
        { id: 'b2', title: '  Mapa de sal ', author: '  ', notes: ' nota ' },
        '2026-10-10T00:00:00.000Z',
      ),
    ).toEqual({
      id: 'b2',
      title: 'Mapa de sal',
      author: null,
      genre: null,
      page_count: null,
      cover_path: null,
      cover_source: null,
      reading_status: 'to_read',
      current_page: 0,
      rating: null,
      notes: 'nota',
      status_changed_at: '2026-10-10T00:00:00.000Z',
    });
  });

  it('builds an update with only the patched keys', () => {
    expect(patchToUpdate({ rating: 4, author: ' Ana ', currentPage: null })).toEqual({
      rating: 4,
      author: 'Ana',
      current_page: 0,
    });
    expect(patchToUpdate({})).toEqual({});
  });
});

describe('bookValidation', () => {
  it('accepts a valid book', () => {
    expect(validateBook({ title: 'A', pageCount: 100, currentPage: 100, rating: 5 })).toEqual([]);
    expect(validateBook({ title: 'A', pageCount: 1 })).toEqual([]);
    expect(validateBook({ title: 'A', pageCount: 10_000 })).toEqual([]);
  });

  it('requires a page count from 1 to 10000', () => {
    expect(validateBook({ title: 'A' })).toEqual(['page_count_required']);
    expect(validateBook({ title: 'A', pageCount: null })).toEqual(['page_count_required']);
    expect(validateBook({ title: 'A', pageCount: Number.NaN })).toEqual(['page_count_required']);
    expect(validateBook({ title: 'A', pageCount: 10_001 })).toEqual(['page_count_invalid']);
    expect(validatePageCount(0)).toBe('page_count_invalid');
    expect(validatePageCount(264)).toBeNull();
    // Updates that do not touch the page count of an older book without one.
    expect(validateBook({ title: 'A', pageCount: null, requirePageCount: false })).toEqual([]);
    expect(validatePageCount(null, { required: false })).toBeNull();
    expect(validatePageCount(0, { required: false })).toBe('page_count_invalid');
  });

  it('reports every issue', () => {
    expect(validateBook({ title: '  ', pageCount: 0, currentPage: -1, rating: 6 })).toEqual([
      'title_required',
      'page_count_invalid',
      'current_page_invalid',
      'rating_invalid',
    ]);
    expect(validateBook({ title: 'A', pageCount: 10, currentPage: 11 })).toEqual([
      'current_page_exceeds_total',
    ]);
    expect(validateBook({ title: 'A', pageCount: 2.5 })).toEqual(['page_count_invalid']);
  });

  it('validates the borrower name (1-80 characters)', () => {
    expect(validateLentTo('Laura')).toBeNull();
    expect(validateLentTo('   ')).toBe('lent_to_required');
    expect(validateLentTo('a'.repeat(80))).toBeNull();
    expect(validateLentTo('a'.repeat(81))).toBe('lent_to_too_long');
  });

  it('has a Spanish message for every code', () => {
    for (const code of Object.keys(t.bookValidation) as BookValidationCode[]) {
      expect(bookValidationMessage(code).length).toBeGreaterThan(0);
    }
  });
});

describe('filterBooks', () => {
  const books = [
    book({ id: '1', title: 'Lo que callan los ríos', author: 'Tomás Aguirre', genre: 'Crónica' }),
    book({ id: '2', title: 'Herbario', author: 'Sara Beltrán', lentTo: 'Laura', lentAt: 'x' }),
    book({ id: '3', title: 'Mapa de sal', author: 'Inés Carvajal', readingStatus: 'to_read' }),
    book({ id: '4', title: 'Ceniza y miel', author: 'Paula Zuleta', readingStatus: 'finished' }),
  ];
  const ids = (list: Book[]) => list.map((b) => b.id);

  it('matches title and author ignoring accents and case', () => {
    expect(ids(filterBooks(books, { query: 'RIOS' }))).toEqual(['1']);
    expect(ids(filterBooks(books, { query: 'tomas' }))).toEqual(['1']);
    expect(ids(filterBooks(books, { query: 'inés' }))).toEqual(['3']);
    expect(ids(filterBooks(books, { query: '  ' }))).toEqual(['1', '2', '3', '4']);
  });

  it('filters by status and lent', () => {
    expect(ids(filterBooks(books, { filter: 'lent' }))).toEqual(['2']);
    expect(ids(filterBooks(books, { filter: 'to_read' }))).toEqual(['3']);
    expect(ids(filterBooks(books, { filter: 'finished', query: 'miel' }))).toEqual(['4']);
    expect(ids(filterBooks(books, { filter: 'reading', query: 'miel' }))).toEqual([]);
  });

  it('filters by genre ignoring accents', () => {
    expect(ids(filterBooks(books, { genre: 'cronica' }))).toEqual(['1']);
  });

  it('normalizes text', () => {
    expect(normalizeText('  Ñandú Él ')).toBe('nandu el');
    expect(normalizeText(null)).toBe('');
  });
});

describe('relatedBooks', () => {
  const a = book({ id: 'a', genre: 'Novela' });
  const list = [
    a,
    book({ id: 'b', genre: 'novela' }),
    book({ id: 'c', genre: 'Poesía' }),
    book({ id: 'd', genre: 'NOVELA' }),
  ];

  it('returns other books of the same genre, excluding itself, up to the limit', () => {
    expect(relatedBooks(a, list).map((b) => b.id)).toEqual(['b', 'd']);
    expect(relatedBooks(a, list, 1).map((b) => b.id)).toEqual(['b']);
  });

  it('returns nothing without a genre', () => {
    expect(relatedBooks(book({ id: 'x', genre: null }), list)).toEqual([]);
  });
});
