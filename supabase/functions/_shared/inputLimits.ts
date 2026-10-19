// Maximum lengths of the user-typed text the Edge Functions accept (in Unicode code points).
// Same numbers as src/lib/inputLimits.ts and the CHECK constraints of
// supabase/migrations/20261015000000_input_constraints.sql; a Jest test keeps them equal.
// Functions cannot import from `src`, hence this copy. No imports, no Deno or Node APIs.

export const TITLE_MAX_LENGTH = 200;
export const AUTHOR_MAX_LENGTH = 120;
/** Longest genre the model may return (the app's own genre field allows 60). */
export const GENRE_MAX_LENGTH = 40;
/** Free text the user writes for the Librero (context or mood). */
export const CONTEXT_MAX_LENGTH = 200;
export const PAGE_COUNT_MAX = 10_000;
