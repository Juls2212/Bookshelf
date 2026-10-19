// Reading log rules (pure). Every change of a book's current page becomes one append-only
// event with the signed page difference and the device's local date at that moment.

/** A page change as it is logged; the repository adds the id, book and timestamps. */
export type PageChangeEvent = { pagesDelta: number; localDate: string };

const pageOf = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

/**
 * The event for moving from `oldPage` to `newPage` on `nowLocalDate` ("YYYY-MM-DD"), or null
 * when the page did not change. Going back is a negative correction.
 */
export function eventForPageChange(
  oldPage: number | null | undefined,
  newPage: number | null | undefined,
  nowLocalDate: string,
): PageChangeEvent | null {
  const pagesDelta = pageOf(newPage) - pageOf(oldPage);
  return pagesDelta === 0 ? null : { pagesDelta, localDate: nowLocalDate };
}

/**
 * Pages read on the days from `from` to `to` (inclusive date keys; null = every day). Each day
 * is summed first and clamped at zero, so a correction never takes pages from another day.
 */
export function pagesReadBetween(
  dailyPages: Readonly<Record<string, number>>,
  from: string | null,
  to: string | null,
): number {
  let total = 0;
  for (const [day, pages] of Object.entries(dailyPages)) {
    if (from !== null && day < from) continue;
    if (to !== null && day > to) continue;
    total += Math.max(0, pages);
  }
  return total;
}
