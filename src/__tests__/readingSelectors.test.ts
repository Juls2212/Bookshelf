import { lastReadingActivity, pickCurrentlyReading } from '@/features/library/readingSelectors';
import type { Book } from '@/types/book';

type Candidate = Pick<Book, 'id' | 'readingStatus' | 'statusChangedAt' | 'updatedAt' | 'createdAt'>;

const book = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  readingStatus: 'reading',
  statusChangedAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  createdAt: '2026-09-01T10:00:00.000Z',
  ...overrides,
});

describe('pickCurrentlyReading', () => {
  it('returns null when nothing is being read', () => {
    expect(pickCurrentlyReading([])).toBeNull();
    expect(
      pickCurrentlyReading([
        book('a', { readingStatus: 'to_read' }),
        book('b', { readingStatus: 'finished' }),
      ]),
    ).toBeNull();
  });

  it('returns the only book being read', () => {
    expect(pickCurrentlyReading([book('a', { readingStatus: 'to_read' }), book('b')])?.id).toBe(
      'b',
    );
  });

  it('picks the most recent status change or page update among several', () => {
    const books = [
      book('status', { statusChangedAt: '2026-10-05T10:00:00.000Z' }),
      // A page saved later bumps updated_at (server format with offset).
      book('page', { updatedAt: '2026-10-07T08:00:00.123456+00:00' }),
      book('old'),
      book('finished', { readingStatus: 'finished', updatedAt: '2026-10-09T10:00:00.000Z' }),
    ];
    expect(pickCurrentlyReading(books)?.id).toBe('page');
  });

  it('compares instants, not strings, across timestamp formats', () => {
    // Same instant written two ways; the later one wins by milliseconds, not by text.
    const books = [
      book('z-format', { updatedAt: '2026-10-07T10:00:00.500Z' }),
      book('offset', { updatedAt: '2026-10-07T12:00:00+02:00' }),
    ];
    expect(pickCurrentlyReading(books)?.id).toBe('z-format');
  });

  it('breaks ties by most recently added, then by id', () => {
    const tie = '2026-10-05T10:00:00.000Z';
    expect(
      pickCurrentlyReading([
        book('older', { updatedAt: tie, createdAt: '2026-09-01T00:00:00.000Z' }),
        book('newer', { updatedAt: tie, createdAt: '2026-09-15T00:00:00.000Z' }),
      ])?.id,
    ).toBe('newer');
    expect(
      pickCurrentlyReading([book('b', { updatedAt: tie }), book('a', { updatedAt: tie })])?.id,
    ).toBe('a');
  });

  it('treats missing or invalid dates as the oldest activity', () => {
    expect(lastReadingActivity(book('x', { statusChangedAt: null, updatedAt: 'not a date' }))).toBe(
      0,
    );
  });
});
