// Pure rules of the reading preferences (what the Librero takes into account). English keys;
// the Spanish labels live in i18n, keyed by these same keys.
import type { GenreKey } from '@/types/database';

export type { GenreKey };

/** The 8 genres the server accepts (same order as the CHECK constraint and the mockups). */
export const GENRE_KEYS = [
  'novel',
  'poetry',
  'history',
  'essay',
  'mystery',
  'chronicle',
  'fantasy',
  'biography',
] as const satisfies readonly GenreKey[];

/** The three switches. */
export const PREFERENCE_OPTIONS = [
  'prioritizeUnread',
  'considerMood',
  'preferShortWeekdays',
] as const;

export type PreferenceOption = (typeof PREFERENCE_OPTIONS)[number];

export type ReadingPreferences = {
  favoriteGenres: GenreKey[];
} & Record<PreferenceOption, boolean>;

/** Same defaults as the server table. */
export const DEFAULT_PREFERENCES: ReadingPreferences = {
  favoriteGenres: [],
  prioritizeUnread: true,
  considerMood: true,
  preferShortWeekdays: false,
};

export function defaultPreferences(): ReadingPreferences {
  return { ...DEFAULT_PREFERENCES, favoriteGenres: [] };
}

const isGenreKey = (value: unknown): value is GenreKey =>
  typeof value === 'string' && (GENRE_KEYS as readonly string[]).includes(value);

/** Known keys only, no duplicates, in the canonical order. Anything else becomes []. */
export function normalizeGenres(values: unknown): GenreKey[] {
  if (!Array.isArray(values)) return [];
  const chosen = new Set(values.filter(isGenreKey));
  return GENRE_KEYS.filter((key) => chosen.has(key));
}

/** Adds or removes one genre (no limit on how many are selected). */
export function toggleGenre(genres: readonly GenreKey[], genre: GenreKey): GenreKey[] {
  return genres.includes(genre)
    ? normalizeGenres(genres.filter((g) => g !== genre))
    : normalizeGenres([...genres, genre]);
}

/** A complete, valid copy (booleans coerced, genres normalized). */
export function normalizePreferences(value: Partial<Record<string, unknown>>): ReadingPreferences {
  const bool = (key: PreferenceOption) =>
    typeof value[key] === 'boolean' ? (value[key] as boolean) : DEFAULT_PREFERENCES[key];
  return {
    favoriteGenres: normalizeGenres(value.favoriteGenres),
    prioritizeUnread: bool('prioritizeUnread'),
    considerMood: bool('considerMood'),
    preferShortWeekdays: bool('preferShortWeekdays'),
  };
}

export function samePreferences(a: ReadingPreferences, b: ReadingPreferences): boolean {
  return (
    a.prioritizeUnread === b.prioritizeUnread &&
    a.considerMood === b.considerMood &&
    a.preferShortWeekdays === b.preferShortWeekdays &&
    a.favoriteGenres.join(',') === b.favoriteGenres.join(',')
  );
}
