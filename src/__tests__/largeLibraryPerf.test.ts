// Large-library budget (Jest only): filtering and statistics must stay well under a frame
// budget with about 500 books, so typing in the search box and opening Inicio stay smooth.
import { filterBooks } from '@/features/library/filterBooks';
import { readingStats } from '@/features/library/readingStats';
import type { Book, ReadingStatus } from '@/types/book';

const BOOK_COUNT = 500;
/** Generous per-call budget (ms) so slow CI machines do not flake; real runs take ~1 ms. */
const BUDGET_MS = 50;
const STATUSES: ReadingStatus[] = ['to_read', 'reading', 'finished'];
const GENRES = ['Novela', 'Poesía', 'Ensayo', 'Historia', null];

function library(count: number): Book[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `b${i}`,
    title: `Título número ${i} ${i % 7 === 0 ? 'Cien años de soledad' : 'Crónica'}`,
    author: i % 3 === 0 ? null : `Autora ${i % 40}`,
    genre: GENRES[i % GENRES.length] ?? null,
    pageCount: 100 + (i % 400),
    coverPath: null,
    coverSource: null,
    readingStatus: STATUSES[i % STATUSES.length]!,
    currentPage: i % 90,
    rating: i % 5 === 0 ? null : (i % 5) + 1,
    notes: null,
    lentTo: i % 11 === 0 ? 'Ana' : null,
    lentAt: null,
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T09:00:00.000Z',
    statusChangedAt: `2026-0${(i % 9) + 1}-10T09:00:00.000Z`,
  }));
}

/** Best of a few runs: ignores one-off GC pauses and JIT warm-up. */
function bestTimeMs(run: () => unknown, repeats = 5): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < repeats; i += 1) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe('large library (500 books)', () => {
  const books = library(BOOK_COUNT);
  const now = new Date('2026-10-12T12:00:00');

  it('filters by query, status and genre within budget', () => {
    expect(filterBooks(books, { query: 'cien anos' }).length).toBeGreaterThan(0);
    expect(bestTimeMs(() => filterBooks(books, { query: 'SOLEDAD' }))).toBeLessThan(BUDGET_MS);
    expect(
      bestTimeMs(() =>
        filterBooks(books, { query: 'autora 1', filter: 'reading', genre: 'poesia' }),
      ),
    ).toBeLessThan(BUDGET_MS);
    expect(bestTimeMs(() => filterBooks(books, { query: '', filter: 'lent' }))).toBeLessThan(
      BUDGET_MS,
    );
  });

  it('computes the reading statistics within budget', () => {
    const stats = readingStats(books, { period: 'all', now });
    expect(stats.finished + stats.reading + stats.toRead).toBe(BOOK_COUNT);
    expect(bestTimeMs(() => readingStats(books, { period: 'year', now }))).toBeLessThan(BUDGET_MS);
  });
});
