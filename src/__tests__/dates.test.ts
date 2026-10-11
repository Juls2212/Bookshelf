import { firstNameOf } from '@/features/profile/displayName';
import { t } from '@/i18n';
import {
  buildGreeting,
  formatDayMonth,
  formatLongDate,
  formatMonthYear,
  formatRelativeDays,
  greetingFor,
  greetingKeyFor,
} from '@/lib/dates';

// Local-time constructor so tests do not depend on the machine's time zone.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe('greeting', () => {
  it.each([
    [5, 0, 'morning'],
    [11, 59, 'morning'],
    [12, 0, 'afternoon'],
    [19, 59, 'afternoon'],
    [20, 0, 'evening'],
    [0, 0, 'evening'],
    [4, 59, 'evening'],
  ] as const)('%p:%p is %s', (hour, minute, key) => {
    expect(greetingKeyFor(at(2026, 10, 9, hour, minute))).toBe(key);
  });

  it('returns the Spanish greeting from i18n', () => {
    expect(greetingFor(at(2026, 10, 9, 8))).toBe(t.greeting.morning);
    expect(greetingFor(at(2026, 10, 9, 22))).toBe(t.greeting.evening);
  });
});

describe('long date', () => {
  it('formats weekday, day and month in Spanish', () => {
    expect(formatLongDate(at(2026, 10, 9))).toBe('viernes 9 de octubre');
    expect(formatLongDate(at(2026, 1, 1))).toBe('jueves 1 de enero');
    expect(formatLongDate(at(2026, 12, 27))).toBe('domingo 27 de diciembre');
  });

  it('formats day-month and month-year', () => {
    expect(formatDayMonth(at(2026, 10, 2))).toBe('2 de octubre');
    expect(formatMonthYear(at(2026, 10, 1))).toBe('octubre de 2026');
  });
});

describe('formatRelativeDays', () => {
  const now = at(2026, 10, 9, 9);
  it.each([
    [at(2026, 10, 9, 1), t.dates.today],
    [at(2026, 10, 8, 23), t.dates.yesterday],
    [at(2026, 10, 6), 'hace 3 días'],
    [at(2026, 10, 3), 'hace 6 días'],
    [at(2026, 10, 2), t.dates.weekAgo],
    [at(2026, 9, 27), t.dates.weekAgo],
    [at(2026, 9, 25), 'hace 2 semanas'],
    [at(2026, 9, 10), 'hace 4 semanas'],
    [at(2026, 9, 9), t.dates.monthAgo],
    [at(2026, 7, 9), 'hace 3 meses'],
  ])('%p -> %s', (date, expected) => {
    expect(formatRelativeDays(date, now)).toBe(expected);
  });

  it('never goes negative', () => {
    expect(formatRelativeDays(at(2026, 10, 12), now)).toBe(t.dates.today);
  });
});

describe('buildGreeting', () => {
  it('uses the greeting with a comma and the first name when known', () => {
    expect(buildGreeting(at(2026, 10, 9, 9), firstNameOf('  Juliana Peñafiel '))).toEqual({
      greeting: t.greeting.morning,
      name: 'Juliana',
    });
  });

  it('falls back to a neutral greeting without a name', () => {
    expect(buildGreeting(at(2026, 10, 9, 21), firstNameOf(null))).toEqual({
      greeting: t.greetingAlone.evening,
      name: null,
    });
    expect(buildGreeting(at(2026, 10, 9, 15), firstNameOf('   '))).toEqual({
      greeting: t.greetingAlone.afternoon,
      name: null,
    });
  });
});
