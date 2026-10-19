// "Tu lectura": pure statistics and the Inicio card.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import {
  averageRatingOf,
  favoriteGenreOf,
  finishedInYear,
  formatCount,
  formatRating,
  pagesReadOf,
  readingStats,
} from '@/features/library/readingStats';
import { ReadingStatsCard } from '@/features/library/ReadingStatsCard';
import { format, t } from '@/i18n';
import type { Book } from '@/types/book';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const s = t.home.stats;

let n = 0;
const book = (overrides: Partial<Book> = {}): Book => {
  n += 1;
  return {
    id: `b${n}`,
    title: `Libro ${n}`,
    author: null,
    genre: null,
    pageCount: 200,
    coverPath: null,
    coverSource: null,
    readingStatus: 'to_read',
    currentPage: 0,
    rating: null,
    notes: null,
    lentTo: null,
    lentAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
};

/** A local date-time (the device's time zone), as an ISO string. */
const local = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

describe('this year (device local time)', () => {
  const now = new Date(2027, 0, 1, 0, 5); // 1 January 2027, 00:05 local

  it('a book finished late on 31 December counts for the old year', () => {
    const dec31 = book({ readingStatus: 'finished', statusChangedAt: local(2026, 12, 31, 23, 59) });
    expect(finishedInYear(dec31, now)).toBe(false);
    expect(finishedInYear(dec31, new Date(2026, 11, 31, 23, 59, 30))).toBe(true);
  });

  it('a book finished just after midnight on 1 January counts for the new year', () => {
    const jan1 = book({ readingStatus: 'finished', statusChangedAt: local(2027, 1, 1, 0, 1) });
    expect(finishedInYear(jan1, now)).toBe(true);
  });

  it('legacy rows without status_changed_at, and unfinished books, never count', () => {
    expect(finishedInYear(book({ readingStatus: 'finished', statusChangedAt: null }), now)).toBe(
      false,
    );
    expect(
      finishedInYear(book({ readingStatus: 'reading', statusChangedAt: local(2027, 1, 1) }), now),
    ).toBe(false);
  });
});

describe('statistics', () => {
  const now = new Date(2026, 9, 11);

  it('counts finished (year and total), reading, to read and pages read', () => {
    const books = [
      book({ readingStatus: 'finished', pageCount: 300, statusChangedAt: local(2026, 3, 1) }),
      book({ readingStatus: 'finished', pageCount: 150, statusChangedAt: local(2025, 6, 1) }),
      book({ readingStatus: 'reading', pageCount: 400, currentPage: 120 }),
      book({ readingStatus: 'to_read', currentPage: 0 }),
      book({ readingStatus: 'to_read' }),
    ];
    // Without a reading log, a period has no pages; Total falls back to the library.
    expect(readingStats(books, { period: 'year', now })).toMatchObject({
      finished: 1,
      pagesRead: 0,
      reading: 1,
      toRead: 2,
    });
    expect(readingStats(books, { period: 'all', now })).toMatchObject({
      finished: 2,
      pagesRead: 300 + 150 + 120,
    });
  });

  it('books without page_count: finished ones count the page they reached, others nothing', () => {
    expect(pagesReadOf(book({ readingStatus: 'finished', pageCount: null, currentPage: 95 }))).toBe(
      95,
    );
    expect(
      pagesReadOf(book({ readingStatus: 'finished', pageCount: null, currentPage: null })),
    ).toBe(0);
    expect(pagesReadOf(book({ readingStatus: 'reading', pageCount: null, currentPage: 40 }))).toBe(
      40,
    );
    expect(pagesReadOf(book({ readingStatus: 'to_read', currentPage: 10 }))).toBe(0);
  });

  it('average rating of rated books, hidden (null) when none is rated', () => {
    expect(
      averageRatingOf([book({ rating: 5 }), book({ rating: 4 }), book({ rating: 4 }), book()]),
    ).toBe(4.3);
    expect(averageRatingOf([book(), book()])).toBeNull();
    expect(formatRating(4.3)).toBe('4,3');
    expect(formatRating(5)).toBe('5,0');
  });

  it('favorite genre among finished books, ties broken alphabetically', () => {
    // Spellings are grouped (case, spaces); the first one seen is shown.
    const fin = (genre: string | null) => book({ readingStatus: 'finished', genre });
    expect(favoriteGenreOf([fin('Poesía'), fin('Novela'), fin('novela '), fin('Poesía')])).toBe(
      'Novela',
    );
    expect(favoriteGenreOf([fin('Poesía'), fin('Ensayo')])).toBe('Ensayo');
    // Only finished books count; no genres means no favorite.
    expect(favoriteGenreOf([book({ genre: 'Historia' }), fin(null), fin('  ')])).toBeNull();
  });

  it('an empty library is all zeros', () => {
    expect(readingStats([], { period: 'all', now })).toEqual({
      finished: 0,
      pagesRead: 0,
      reading: 0,
      toRead: 0,
      averageRating: null,
      favoriteGenre: null,
    });
  });

  it('formats large counts with a thousands separator', () => {
    expect(formatCount(950)).toBe('950');
    expect(formatCount(12345)).toBe('12.345');
    expect(formatCount(1234567)).toBe('1.234.567');
  });
});

describe('Inicio card "Tu lectura"', () => {
  const now = new Date(2026, 9, 14, 18, 0); // Wednesday 14 October 2026, 18:00 local
  const today = '2026-10-14';
  const card = (books: Book[], dailyPages: Record<string, number> = {}) => (
    <ThemeProvider>
      <ToastProvider>
        <ReadingStatsCard books={books} dailyPages={dailyPages} now={now} />
      </ToastProvider>
    </ThemeProvider>
  );
  const renderCard = (books: Book[], dailyPages: Record<string, number> = {}) =>
    render(card(books, dailyPages));

  it('is hidden when there are no books', async () => {
    await renderCard([]);
    expect(screen.queryByTestId('reading-stats')).toBeNull();
  });

  it('Hoy by default; a friendly zero state when nothing was read today', async () => {
    await renderCard([book({ readingStatus: 'reading', currentPage: 30 }), book()]);
    expect(screen.getByRole('radio', { name: s.periods.today })).toBeChecked();
    expect(screen.getByText(s.todayEmpty)).toBeOnTheScreen();
    expect(screen.queryByTestId('stat-finished')).toBeNull();
    expect(screen.queryByTestId('stat-pages')).toBeNull();
    expect(screen.getByLabelText(`1 ${s.reading.one}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`1 ${s.toRead.one}`)).toBeOnTheScreen();
    expect(screen.queryByTestId('stat-rating')).toBeNull();
    expect(screen.queryByTestId('stat-genre')).toBeNull();
  });

  it('always explains that daily counts start with the log (no backfill)', async () => {
    await renderCard([book()]);
    expect(screen.getByTestId('reading-stats-note')).toHaveTextContent(s.logNote);
  });

  it('shows the pages read today from the log', async () => {
    await renderCard([book({ readingStatus: 'reading', currentPage: 80 })], { [today]: 30 });
    expect(screen.queryByText(s.todayEmpty)).toBeNull();
    expect(screen.getByLabelText(`30 ${s.pages.today.many}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`0 ${s.finished.today.many}`)).toBeOnTheScreen();
  });

  it('switches between Esta semana, Este año and Total', async () => {
    await renderCard(
      [
        book({
          readingStatus: 'finished',
          statusChangedAt: local(2026, 10, 12), // Monday of this week
          rating: 5,
          genre: 'Ensayo',
        }),
        book({ readingStatus: 'finished', statusChangedAt: local(2024, 2, 1), rating: 4 }),
      ],
      { '2026-10-12': 120, '2026-10-05': 50, '2025-12-31': 10 },
    );
    await fireEvent.press(screen.getByRole('radio', { name: s.periods.week }));
    expect(screen.getByLabelText(`1 ${s.finished.week.one}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`120 ${s.pages.week.many}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: s.periods.year }));
    expect(screen.getByLabelText(`1 ${s.finished.year.one}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`170 ${s.pages.year.many}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: s.periods.all }));
    expect(screen.getByLabelText(`2 ${s.finished.all.many}`)).toBeOnTheScreen();
    // The library (2 finished books x 200 pages) is larger than the log: it wins in Total.
    expect(screen.getByLabelText(`400 ${s.pages.all.many}`)).toBeOnTheScreen();
    expect(
      screen.getByLabelText(`${format(s.ratingValue, { rating: '4,5' })} ${s.rating}`),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText(`Ensayo ${s.genre}`)).toBeOnTheScreen();
  });

  it('updates Hoy when pages are read and a book is marked as read', async () => {
    const reading = book({ readingStatus: 'reading', currentPage: 50 });
    const view = await renderCard([reading]);
    expect(screen.getByText(s.todayEmpty)).toBeOnTheScreen();
    await view.rerender(
      card(
        [
          {
            ...reading,
            readingStatus: 'finished',
            currentPage: 200,
            statusChangedAt: now.toISOString(),
          },
        ],
        { [today]: 150 },
      ),
    );
    expect(screen.getByLabelText(`1 ${s.finished.today.one}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`150 ${s.pages.today.many}`)).toBeOnTheScreen();
  });
});
