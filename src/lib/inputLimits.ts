// Single source of truth for the length and range of every user-typed field. UI (maxLength),
// validators, sanitizers, tests and the SQL CHECK constraints
// (supabase/migrations/20261015000000_input_constraints.sql) all use these numbers.
// The Edge Functions cannot import from `src`, so supabase/functions/_shared/inputLimits.ts
// repeats the ones they need; a test keeps both files equal.
// Lengths are counted in Unicode code points (what Postgres char_length counts).

export const INPUT_LIMITS = {
  title: 200,
  author: 120,
  genre: 60,
  /** Reading notes (the book's review). */
  notes: 2000,
  lentTo: 80,
  displayName: 50,
  /** RFC 5321 maximum for an address. */
  email: 254,
  passwordMin: 8,
  /** bcrypt (used by Supabase Auth) ignores everything after 72 bytes. */
  passwordMax: 72,
  /** Library search box. */
  search: 100,
  /** Free text sent to the Librero (context or mood). */
  aiContext: 200,
  /** Digits typed in a page field (10000 has five). */
  pageDigits: 5,
  pageCountMin: 1,
  pageCountMax: 10_000,
} as const;

/** Where notes show a "remaining characters" counter (only long fields have one). */
export const NOTES_COUNTER_FROM = INPUT_LIMITS.notes - 200;

/** Longest text a list, card or header renders before cutting it with an ellipsis. */
export const DISPLAY_LIMITS = {
  title: 200,
  author: 120,
  notes: 2000,
} as const;
