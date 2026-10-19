// Read side of the reading log for the UI ("Tu lectura"). Events are written by the book
// repository together with the page change; this only reads the per-day sums.
import type { BookResult } from './bookRepository';
import { librarySession, type LibrarySession } from './librarySession';
import { dailyPageTotals } from './localReadingEvents';

export interface ReadingLogRepository {
  /** Signed pages per local date ("YYYY-MM-DD") of the signed-in user. */
  dailyTotals(): Promise<BookResult<Record<string, number>>>;
}

export function createSqliteReadingLog({
  session = librarySession,
}: { session?: Pick<LibrarySession, 'current'> } = {}): ReadingLogRepository {
  return {
    async dailyTotals() {
      try {
        const active = await session.current();
        if (!active) return { ok: false, error: 'unauthorized' };
        return { ok: true, data: await dailyPageTotals(active.db, active.userId) };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    },
  };
}

export const sqliteReadingLog: ReadingLogRepository = createSqliteReadingLog();
