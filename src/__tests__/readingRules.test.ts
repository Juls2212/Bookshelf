import {
  applyPageUpdate,
  applyStatusChange,
  getProgressPercent,
  pageForStatus,
  statusForPage,
  validateCurrentPage,
  validateRatingForStatus,
  type ReadingFields,
} from '@/features/library/readingRules';
import { validateBook } from '@/features/library/bookValidation';

const NOW = new Date('2026-10-11T10:00:00.000Z');
const OLD = '2026-10-01T10:00:00.000Z';

const book = (overrides: Partial<ReadingFields>): ReadingFields => ({
  readingStatus: 'reading',
  currentPage: 120,
  pageCount: 300,
  statusChangedAt: OLD,
  ...overrides,
});

describe('validateCurrentPage', () => {
  it('accepts integers between 0 and the page count', () => {
    expect(validateCurrentPage(0, 300)).toBeNull();
    expect(validateCurrentPage(300, 300)).toBeNull();
    expect(validateCurrentPage(5000, null)).toBeNull();
  });

  it('rejects negative, fractional and too-large pages', () => {
    expect(validateCurrentPage(-1, 300)).toBe('current_page_invalid');
    expect(validateCurrentPage(1.5, 300)).toBe('current_page_invalid');
    expect(validateCurrentPage(301, 300)).toBe('current_page_exceeds_total');
  });

  it('treats an empty value as optional unless required', () => {
    expect(validateCurrentPage(null, 300)).toBeNull();
    expect(validateCurrentPage(null, 300, { required: true })).toBe('current_page_required');
    expect(validateCurrentPage(Number.NaN, 300, { required: true })).toBe('current_page_required');
  });
});

describe('applyStatusChange', () => {
  it('to_read resets the page to 0', () => {
    expect(applyStatusChange(book({}), 'to_read', NOW)).toMatchObject({
      readingStatus: 'to_read',
      currentPage: 0,
      statusChangedAt: NOW.toISOString(),
    });
  });

  it('reading keeps the page, with at least page 1 when the total is known', () => {
    expect(
      applyStatusChange(book({ readingStatus: 'to_read', currentPage: 0 }), 'reading', NOW),
    ).toMatchObject({ readingStatus: 'reading', currentPage: 1 });
    expect(
      applyStatusChange(
        book({ readingStatus: 'to_read', currentPage: 0, pageCount: null }),
        'reading',
        NOW,
      ),
    ).toMatchObject({ currentPage: 0 });
    expect(
      applyStatusChange(book({ readingStatus: 'finished', currentPage: 300 }), 'reading', NOW),
    ).toMatchObject({ readingStatus: 'reading', currentPage: 300 });
  });

  it('finished jumps to the last page when known, otherwise keeps the page', () => {
    expect(applyStatusChange(book({}), 'finished', NOW)).toMatchObject({ currentPage: 300 });
    expect(
      applyStatusChange(book({ pageCount: null, currentPage: 80 }), 'finished', NOW),
    ).toMatchObject({ currentPage: 80 });
  });

  it('always stamps status_changed_at, even for the same status', () => {
    expect(applyStatusChange(book({}), 'reading', NOW).statusChangedAt).toBe(NOW.toISOString());
  });
});

describe('applyPageUpdate', () => {
  it('updates the page and keeps the status date when the status does not change', () => {
    expect(applyPageUpdate(book({}), 150, NOW)).toEqual(book({ currentPage: 150 }));
  });

  it('reaching the last page marks a reading book as finished', () => {
    expect(applyPageUpdate(book({}), 300, NOW)).toMatchObject({
      readingStatus: 'finished',
      currentPage: 300,
      statusChangedAt: NOW.toISOString(),
    });
  });

  it('page 0 keeps the status', () => {
    expect(applyPageUpdate(book({}), 0, NOW)).toMatchObject({
      readingStatus: 'reading',
      currentPage: 0,
    });
    expect(
      applyPageUpdate(book({ readingStatus: 'to_read', currentPage: 0 }), 0, NOW),
    ).toMatchObject({ readingStatus: 'to_read' });
  });

  it('starting a book to read marks it as reading', () => {
    expect(
      applyPageUpdate(book({ readingStatus: 'to_read', currentPage: 0 }), 10, NOW),
    ).toMatchObject({ readingStatus: 'reading', statusChangedAt: NOW.toISOString() });
  });

  it('going back from a finished book with known total marks it as reading', () => {
    expect(
      applyPageUpdate(book({ readingStatus: 'finished', currentPage: 300 }), 200, NOW),
    ).toMatchObject({ readingStatus: 'reading', currentPage: 200 });
  });

  it('without page_count nothing finishes automatically', () => {
    expect(applyPageUpdate(book({ pageCount: null }), 9999, NOW)).toMatchObject({
      readingStatus: 'reading',
      currentPage: 9999,
    });
  });

  it('never stores a page beyond the total', () => {
    expect(applyPageUpdate(book({}), 400, NOW).currentPage).toBe(300);
  });
});

describe('rating only for finished books', () => {
  it('leaving finished clears the rating; staying finished keeps it', () => {
    const finished = book({ readingStatus: 'finished', currentPage: 300, rating: 4 });
    expect(applyStatusChange(finished, 'reading', NOW).rating).toBeNull();
    expect(applyStatusChange(finished, 'to_read', NOW).rating).toBeNull();
    expect(applyStatusChange(finished, 'finished', NOW).rating).toBe(4);
  });

  it('going back from the last page of a finished book also clears the rating', () => {
    const finished = book({ readingStatus: 'finished', currentPage: 300, rating: 5 });
    expect(applyPageUpdate(finished, 120, NOW)).toMatchObject({
      readingStatus: 'reading',
      rating: null,
    });
  });

  it('does not add a rating key when the input has none', () => {
    expect('rating' in applyStatusChange(book({}), 'to_read', NOW)).toBe(false);
  });

  it('validateBook rejects a rating when the status is not finished', () => {
    expect(
      validateBook({ title: 'A', pageCount: 100, readingStatus: 'reading', rating: 4 }),
    ).toEqual(['rating_requires_finished']);
    expect(
      validateBook({ title: 'A', pageCount: 100, readingStatus: 'finished', rating: 4 }),
    ).toEqual([]);
    expect(
      validateBook({ title: 'A', pageCount: 100, readingStatus: 'to_read', rating: null }),
    ).toEqual([]);
    expect(validateRatingForStatus('to_read', 2)).toBe('rating_requires_finished');
  });
});

describe('helpers', () => {
  it('pageForStatus and statusForPage cover the form cases', () => {
    expect(pageForStatus('reading', null, 300)).toBe(1);
    expect(pageForStatus('finished', null, null)).toBe(0);
    expect(statusForPage('reading', 300, 300)).toBe('finished');
    expect(statusForPage('finished', 120, null)).toBe('finished');
  });

  it('getProgressPercent reuses computeProgressPercent and hides unknown totals', () => {
    expect(getProgressPercent({ currentPage: 214, pageCount: 312 })).toBe(69);
    expect(getProgressPercent({ currentPage: 214, pageCount: null })).toBeNull();
    expect(getProgressPercent({ currentPage: null, pageCount: 312 })).toBe(0);
  });
});
