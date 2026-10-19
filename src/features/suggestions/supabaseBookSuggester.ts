// Real suggester: sends the typed title (and author) to the `suggest-book-details` Edge
// Function, which calls OpenAI on the server. The app never holds an AI key. Errors become the
// app's typed codes; a 20 s client timeout and the caller's signal both abort the request.
// Successful answers are cached in memory, so asking again for the same book costs nothing.
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';

import {
  abortError,
  BookSuggestError,
  type BookSuggester,
  type SuggestedBook,
  type SuggestErrorCode,
} from './bookSuggester';

export const SUGGEST_FUNCTION = 'suggest-book-details';
const SUGGEST_CLIENT_TIMEOUT_MS = 20_000;
const MAX_CANDIDATES = 3;
const CACHE_LIMIT = 50;

type Deps = {
  getClient?: () => Pick<AppSupabaseClient, 'functions'>;
  timeoutMs?: number;
};

/** Error codes of the Edge Function -> codes the form shows messages for. */
const SERVER_ERRORS: Record<string, SuggestErrorCode> = {
  unauthorized: 'unauthorized',
  rate_limited: 'rate_limited',
  no_suggestions: 'no_suggestions',
  timeout: 'timeout',
  upstream_error: 'unknown',
  invalid_request: 'unknown',
};

/** Same book, same key: trimmed, single spaces, lower case. */
export function suggestCacheKey(title: string, author?: string | null): string {
  const normalize = (text: string) =>
    text.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${normalize(title)}\u0000${normalize(author ?? '')}`;
}

/** `{ error: code }` from the function; the status alone when there is no readable body. */
async function httpErrorCode(response: unknown): Promise<SuggestErrorCode> {
  let code: unknown;
  try {
    code = ((await (response as Response).clone().json()) as { error?: unknown }).error;
  } catch {
    code = undefined;
  }
  if (typeof code === 'string' && code in SERVER_ERRORS) return SERVER_ERRORS[code];
  const status = (response as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  return 'unknown';
}

const optionalText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Checks the `{ data: { candidates } }` body again on the client. */
function toSuggestedBooks(body: unknown): SuggestedBook[] {
  const data = (body as { data?: { candidates?: unknown } } | null)?.data;
  if (!data || !Array.isArray(data.candidates)) throw new BookSuggestError('unknown');
  const books: SuggestedBook[] = [];
  for (const item of data.candidates as unknown[]) {
    if (books.length >= MAX_CANDIDATES) break;
    const c = (item ?? {}) as Record<string, unknown>;
    const title = optionalText(c.title);
    if (!title) continue;
    const pages = c.page_count;
    books.push({
      title,
      canonicalTitle: optionalText(c.canonical_title),
      author: optionalText(c.author),
      genre: optionalText(c.genre),
      pageCount:
        typeof pages === 'number' && Number.isInteger(pages) && pages >= 1 && pages <= 10_000
          ? pages
          : null,
    });
  }
  if (books.length === 0) throw new BookSuggestError('no_suggestions');
  return books;
}

export function createSupabaseBookSuggester({
  getClient = getSupabaseClient,
  timeoutMs = SUGGEST_CLIENT_TIMEOUT_MS,
}: Deps = {}): BookSuggester & { clearCache(): void } {
  const cache = new Map<string, SuggestedBook[]>();

  return {
    /** Forgets every cached answer (sign-out: titles typed by one account stay with it). */
    clearCache() {
      cache.clear();
    },

    async suggest({ title, author }, { signal } = {}) {
      if (signal?.aborted) throw abortError();
      const key = suggestCacheKey(title, author);
      const cached = cache.get(key);
      if (cached) return cached.map((book) => ({ ...book }));

      // The request gets its own controller: the caller's signal and the timeout both abort it.
      const request = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        request.abort();
      }, timeoutMs);
      const onAbort = () => request.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      // Settles as soon as the request is aborted, even if invoke ignores the signal.
      const aborted = new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => reject(abortError()), { once: true });
      });

      try {
        const body: Record<string, string> = { title: title.trim() };
        if (author?.trim()) body.author = author.trim();
        const { data, error } = await Promise.race([
          getClient().functions.invoke(SUGGEST_FUNCTION, { body, signal: request.signal }),
          aborted,
        ]);
        if (error) {
          if (error instanceof FunctionsHttpError) {
            throw new BookSuggestError(await httpErrorCode(error.context));
          }
          if (error instanceof FunctionsFetchError) throw new BookSuggestError('network');
          throw new BookSuggestError('unknown');
        }
        const books = toSuggestedBooks(data);
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
        cache.set(key, books);
        return books.map((book) => ({ ...book }));
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (timedOut) throw new BookSuggestError('timeout');
        throw error instanceof BookSuggestError ? error : new BookSuggestError('unknown');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

export const supabaseBookSuggester = createSupabaseBookSuggester();
