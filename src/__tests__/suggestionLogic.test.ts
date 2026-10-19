import { emptyBookForm, type BookFormValues } from '@/features/library/bookFormLogic';
import type { SuggestedBook } from '@/features/suggestions/bookSuggester';
import {
  applySuggestion,
  applySuggestions,
  canAskForSuggestions,
  differsOnlyInAccentsOrCase,
  pendingSuggestions,
  type SuggestField,
} from '@/features/suggestions/suggestionLogic';

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));

const book: SuggestedBook = {
  title: 'El túnel',
  canonicalTitle: null,
  author: 'Ernesto Sabato',
  genre: 'Novela',
  pageCount: 160,
};
const form = (overrides: Partial<BookFormValues>): BookFormValues => ({
  ...emptyBookForm,
  title: 'el tunel',
  ...overrides,
});
const none = new Set<SuggestField>();

describe('suggestion rules', () => {
  it('needs at least 3 characters of title', () => {
    expect(canAskForSuggestions(' ab ')).toBe(false);
    expect(canAskForSuggestions('abc')).toBe(true);
  });

  it('proposes only empty fields, plus the title when only accents or case differ', () => {
    expect(pendingSuggestions(book, form({}), none)).toEqual([
      { field: 'title', value: 'El túnel' },
      { field: 'author', value: 'Ernesto Sabato' },
      { field: 'genre', value: 'Novela' },
      { field: 'pages', value: '160' },
    ]);
    const filled = form({ title: 'El túnel', author: 'Otro', genre: 'Ensayo', pages: '99' });
    expect(pendingSuggestions(book, filled, none)).toEqual([]);
  });

  it('a different title is never proposed', () => {
    expect(differsOnlyInAccentsOrCase('El tunel', 'El túnel')).toBe(true);
    expect(differsOnlyInAccentsOrCase('EL TÚNEL', 'El túnel')).toBe(true);
    expect(differsOnlyInAccentsOrCase('El túnel', 'El túnel')).toBe(false);
    expect(differsOnlyInAccentsOrCase('Túnel', 'El túnel')).toBe(false);
    expect(pendingSuggestions(book, form({ title: 'Sobre héroes' }), none)).not.toContainEqual(
      expect.objectContaining({ field: 'title' }),
    );
  });

  it('skips missing values, invalid page counts and hidden fields', () => {
    const sparse = { ...book, author: null, pageCount: 10_001 };
    expect(pendingSuggestions(sparse, form({}), none).map((s) => s.field)).toEqual([
      'title',
      'genre',
    ]);
    const hidden = new Set<SuggestField>(['genre', 'title']);
    expect(pendingSuggestions(book, form({}), hidden).map((s) => s.field)).toEqual([
      'author',
      'pages',
    ]);
    expect(pendingSuggestions(null, form({}), none)).toEqual([]);
  });

  it('accepting never overwrites what the user typed', () => {
    const typed = form({ author: 'Mi autor' });
    expect(applySuggestion(typed, { field: 'author', value: 'Ernesto Sabato' })).toBe(typed);
    expect(applySuggestion(form({}), { field: 'author', value: 'Ernesto Sabato' })).toMatchObject({
      author: 'Ernesto Sabato',
    });
    // The title is only replaced by its accented / capitalized version.
    expect(
      applySuggestion(form({ title: 'Otro' }), { field: 'title', value: 'El túnel' }).title,
    ).toBe('Otro');
  });

  it('accepting all fills only what is still empty', () => {
    const values = form({ genre: 'Ensayo' });
    const all = pendingSuggestions(book, form({}), none);
    expect(applySuggestions(values, all)).toEqual({
      ...values,
      title: 'El túnel',
      author: 'Ernesto Sabato',
      genre: 'Ensayo',
      pages: '160',
    });
  });
});
