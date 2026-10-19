// Suggests details (author, genre, pages) for a typed title. The implementation is picked by
// suggesterFactory.ts: the Supabase Edge Function `suggest-book-details`, or a fake chosen in
// the dev gallery. Results are proposals only: the form never fills anything on its own.

export type SuggestedBook = {
  title: string;
  /** Official title, only when it differs meaningfully from the typed one (a proposal). */
  canonicalTitle: string | null;
  author: string | null;
  genre: string | null;
  pageCount: number | null;
};

export const SUGGEST_ERROR_CODES = [
  'no_suggestions',
  'rate_limited',
  'network',
  'timeout',
  'unauthorized',
  'unknown',
] as const;

export type SuggestErrorCode = (typeof SUGGEST_ERROR_CODES)[number];

/** Typed failure of a suggester. `message` is the English code. */
export class BookSuggestError extends Error {
  readonly code: SuggestErrorCode;

  constructor(code: SuggestErrorCode) {
    super(code);
    this.name = 'BookSuggestError';
    this.code = code;
  }
}

export type SuggestRequest = { title: string; author?: string | null };

export type SuggestOptions = {
  /** Aborting it must stop the request (a newer request, or leaving the form). */
  signal?: AbortSignal;
};

export interface BookSuggester {
  /** Up to three candidates, best first; rejects with a BookSuggestError (or an AbortError). */
  suggest(request: SuggestRequest, options?: SuggestOptions): Promise<SuggestedBook[]>;
}

export function toSuggestErrorCode(error: unknown): SuggestErrorCode {
  return error instanceof BookSuggestError ? error.code : 'unknown';
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}
