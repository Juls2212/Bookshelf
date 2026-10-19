// Brings a book row within the limits the server enforces (CHECK constraints). Rows saved before
// the limits existed, or pulled from another device, may exceed them; pushing such a row as-is
// would be rejected for good, so the push sends the clamped copy instead.
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { truncateChars } from '@/lib/inputSanitizers';

type BookTextFields = {
  title: string;
  author: string | null;
  genre: string | null;
  notes: string | null;
  lent_to: string | null;
  page_count: number | null;
  current_page: number;
};

const cut = (value: string | null, max: number) =>
  value === null ? null : truncateChars(value, max);

export function clampBookRow<T extends BookTextFields>(row: T): T {
  const validPages =
    row.page_count !== null &&
    Number.isInteger(row.page_count) &&
    row.page_count >= INPUT_LIMITS.pageCountMin &&
    row.page_count <= INPUT_LIMITS.pageCountMax;
  const pageCount = validPages ? row.page_count : null;
  return {
    ...row,
    title: truncateChars(row.title, INPUT_LIMITS.title),
    author: cut(row.author, INPUT_LIMITS.author),
    genre: cut(row.genre, INPUT_LIMITS.genre),
    notes: cut(row.notes, INPUT_LIMITS.notes),
    lent_to: cut(row.lent_to, INPUT_LIMITS.lentTo),
    page_count: pageCount,
    current_page:
      pageCount !== null
        ? Math.min(Math.max(row.current_page, 0), pageCount)
        : Math.max(row.current_page, 0),
  };
}
