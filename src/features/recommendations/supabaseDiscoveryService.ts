// Real service: calls the `discover-book` Edge Function, which reads the user's own books and
// preferences under RLS, calls OpenAI on the server and checks the suggestion in an open
// catalog. The app never holds an AI key. A 30 s client timeout and the caller's signal abort.
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';

import {
  DiscoverError,
  type DiscoverErrorCode,
  type DiscoveryService,
  type NewDiscovery,
} from './discoveryService';
import { abortError } from './recommendationService';

export const DISCOVER_FUNCTION = 'discover-book';
const DISCOVER_CLIENT_TIMEOUT_MS = 30_000;

type Deps = {
  getClient?: () => Pick<AppSupabaseClient, 'functions'>;
  timeoutMs?: number;
};

/** Error codes of the Edge Function -> codes the app shows messages for. */
const SERVER_ERRORS: Record<string, DiscoverErrorCode> = {
  unauthorized: 'unauthorized',
  rate_limited: 'rate_limited',
  no_new_suggestions: 'no_new_suggestions',
  timeout: 'timeout',
  upstream_error: 'unknown',
  invalid_request: 'unknown',
};

async function httpErrorCode(response: unknown): Promise<DiscoverErrorCode> {
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

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';
const optionalText = (value: unknown) => (isText(value) ? value.trim() : null);
const CONFIDENCES = ['high', 'medium', 'low'] as const;

/** Checks the `{ data }` body again on the client: only well-formed results get through. */
function toNewDiscovery(body: unknown): NewDiscovery {
  const d = (body as { data?: Record<string, unknown> } | null)?.data;
  if (
    !d ||
    !isText(d.recommendation_id) ||
    !isText(d.title) ||
    !isText(d.rationale) ||
    !isText(d.created_at) ||
    typeof d.verified !== 'boolean' ||
    !(CONFIDENCES as readonly unknown[]).includes(d.confidence)
  ) {
    throw new DiscoverError('unknown');
  }
  const pages = d.page_count;
  return {
    recommendationId: d.recommendation_id,
    title: d.title.trim(),
    author: optionalText(d.author),
    genre: optionalText(d.genre),
    pageCount:
      typeof pages === 'number' && Number.isInteger(pages) && pages >= 1 && pages <= 10_000
        ? pages
        : null,
    verified: d.verified,
    confidence: d.confidence as NewDiscovery['confidence'],
    rationale: d.rationale.trim(),
    createdAt: d.created_at,
  };
}

export function createSupabaseDiscoveryService({
  getClient = getSupabaseClient,
  timeoutMs = DISCOVER_CLIENT_TIMEOUT_MS,
}: Deps = {}): DiscoveryService {
  return {
    async discover(request, { signal } = {}) {
      if (signal?.aborted) throw abortError();
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(abortError()), { once: true });
      });

      try {
        const body: Record<string, unknown> = {
          exclude_suggestions: request.excludeSuggestions,
          local_weekday: request.localWeekday,
          local_hour: request.localHour,
        };
        if (request.seedBookId) body.seed_book_id = request.seedBookId;
        if (request.mood) body.mood = request.mood;
        if (request.context?.trim()) body.context = request.context.trim();
        const { data, error } = await Promise.race([
          getClient().functions.invoke(DISCOVER_FUNCTION, { body, signal: controller.signal }),
          aborted,
        ]);
        if (error) {
          if (error instanceof FunctionsHttpError) {
            throw new DiscoverError(await httpErrorCode(error.context));
          }
          if (error instanceof FunctionsFetchError) throw new DiscoverError('network');
          throw new DiscoverError('unknown');
        }
        return toNewDiscovery(data);
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (timedOut) throw new DiscoverError('timeout');
        throw error instanceof DiscoverError ? error : new DiscoverError('unknown');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

export const supabaseDiscoveryService: DiscoveryService = createSupabaseDiscoveryService();
