// Spanish date formatting without Intl: names and templates live in i18n.
import { format, t } from '@/i18n';

export type GreetingKey = keyof typeof t.greeting;

/** Morning 05:00-11:59, afternoon 12:00-19:59, evening 20:00-04:59 (local time). */
export function greetingKeyFor(date: Date): GreetingKey {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 20) return 'afternoon';
  return 'evening';
}

export function greetingFor(date: Date): string {
  return t.greeting[greetingKeyFor(date)];
}

/**
 * Greeting line for Inicio: the greeting with a trailing comma plus the first name, or the
 * neutral greeting (no comma) when the name is unknown.
 */
export function buildGreeting(
  date: Date,
  firstName: string | null,
): { greeting: string; name: string | null } {
  const key = greetingKeyFor(date);
  return firstName
    ? { greeting: t.greeting[key], name: firstName }
    : { greeting: t.greetingAlone[key], name: null };
}

/** "viernes 9 de octubre" */
export function formatLongDate(date: Date): string {
  return format(t.dates.longDate, {
    weekday: t.dates.weekdays[date.getDay()],
    day: date.getDate(),
    month: t.dates.months[date.getMonth()],
  });
}

/** "2 de octubre" */
export function formatDayMonth(date: Date): string {
  return format(t.dates.dayMonth, { day: date.getDate(), month: t.dates.months[date.getMonth()] });
}

/** "octubre de 2026" */
export function formatMonthYear(date: Date): string {
  return format(t.dates.monthYear, {
    month: t.dates.months[date.getMonth()],
    year: date.getFullYear(),
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Relative calendar days (local time), copy from i18n: today, yesterday, N days (2-6),
 * 1 week / N weeks (7-29), 1 month / N months (30+).
 * Future dates count as today.
 */
export function formatRelativeDays(date: Date, now: Date): string {
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS));
  if (days === 0) return t.dates.today;
  if (days === 1) return t.dates.yesterday;
  if (days < 7) return format(t.dates.daysAgo, { count: days });
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? t.dates.weekAgo : format(t.dates.weeksAgo, { count: weeks });
  }
  const months = Math.floor(days / 30);
  return months === 1 ? t.dates.monthAgo : format(t.dates.monthsAgo, { count: months });
}
