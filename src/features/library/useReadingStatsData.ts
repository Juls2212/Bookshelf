// Data for "Tu lectura": the per-day pages of the reading log (reloaded whenever the library
// changes: a page update, a sync) and "now", which follows the calendar: it moves on at local
// midnight and whenever the app returns to the foreground, so "Hoy" never shows yesterday.
import { useEffect, useRef, useState } from 'react';

import { localDateKey } from '@/lib/dates';
import { appForeground, type Foreground } from '@/lib/network';
import type { Book } from '@/types/book';

import { sqliteReadingLog, type ReadingLogRepository } from './readingLogRepository';

const systemClock = () => new Date();

/** Milliseconds until the next local midnight (calendar arithmetic, DST safe). */
export function msUntilNextLocalDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

/** The current moment, refreshed when the local date changes or the app is foregrounded. */
export function useLocalNow(
  clock: () => Date = systemClock,
  foreground: Foreground = appForeground,
): Date {
  const [now, setNow] = useState(clock);
  const day = localDateKey(now);

  useEffect(() => {
    const timer = setTimeout(() => setNow(clock()), msUntilNextLocalDay(clock()));
    const unsubscribe = foreground.subscribe((active) => {
      if (active) setNow(clock());
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [day, clock, foreground]);

  return now;
}

/** Pages per local date; reloads after every library change (the newest load wins). */
export function useDailyPages(
  books: readonly Book[],
  log: ReadingLogRepository = sqliteReadingLog,
): Record<string, number> {
  const [dailyPages, setDailyPages] = useState<Record<string, number>>({});
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    void log.dailyTotals().then((result) => {
      if (result.ok && request === latest.current) setDailyPages(result.data);
    });
  }, [books, log]);

  return dailyPages;
}
