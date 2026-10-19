// Real service: calls the `recommend-book` Edge Function, which reads the user's own books and
// preferences under RLS and calls OpenAI on the server. The app never holds an AI key. Errors
// become the app's typed codes; a 30 s client timeout and the caller's signal abort the request.
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase';

import type { NewRecommendation } from './recommendationRepository';
import {
  abortError,
  RecommendError,
  type RecommendationService,
  type RecommendErrorCode,
} from './recommendationService';

export const RECOMMEND_FUNCTION = 'recommend-book';
const RECOMMEND_CLIENT_TIMEOUT_MS = 30_000;

type Deps = {
  getClient?: () => Pick<AppSupabaseClient, 'functions'>;
  timeoutMs?: number;
};

/** Error codes of the Edge Function -> codes the app shows messages for. */
const SERVER_ERRORS: Record<string, RecommendErrorCode> = {
  unauthorized: 'unauthorized',
  rate_limited: 'rate_limited',
  no_candidates: 'no_candidates',
  timeout: 'timeout',
  upstream_error: 'unknown',
  invalid_request: 'unknown',
};

/** `{ error: code }` from the function; the status alone when there is no readable body. */
async function httpErrorCode(response: unknown): Promise<RecommendErrorCode> {
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

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** Checks the `{ data }` body again on the client: only well-formed results get through. */
function toNewRecommendation(body: unknown): NewRecommendation {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  if (
    !data ||
    !isText(data.recommendation_id) ||
    !isText(data.book_id) ||
    !isText(data.rationale) ||
    !isText(data.created_at)
  ) {
    throw new RecommendError('unknown');
  }
  return {
    recommendationId: data.recommendation_id,
    bookId: data.book_id,
    rationale: data.rationale.trim(),
    createdAt: data.created_at,
  };
}

export function createSupabaseRecommendationService({
  getClient = getSupabaseClient,
  timeoutMs = RECOMMEND_CLIENT_TIMEOUT_MS,
}: Deps = {}): RecommendationService {
  return {
    async recommend(request, { signal } = {}) {
      if (signal?.aborted) throw abortError();
      // The request gets its own controller: the caller's signal and the timeout both abort it.
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      // Settles as soon as the request is aborted, even if invoke ignores the signal.
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(abortError()), { once: true });
      });

      try {
        const body: Record<string, unknown> = {
          exclude_book_ids: request.excludeBookIds,
          local_weekday: request.localWeekday,
          local_hour: request.localHour,
        };
        if (request.context?.trim()) body.context = request.context.trim();
        if (request.availableTime) body.available_time = request.availableTime;
        if (request.mood) body.mood = request.mood;
        const { data, error } = await Promise.race([
          getClient().functions.invoke(RECOMMEND_FUNCTION, { body, signal: controller.signal }),
          aborted,
        ]);
        if (error) {
          if (error instanceof FunctionsHttpError) {
            throw new RecommendError(await httpErrorCode(error.context));
          }
          if (error instanceof FunctionsFetchError) throw new RecommendError('network');
          throw new RecommendError('unknown');
        }
        return toNewRecommendation(data);
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (timedOut) throw new RecommendError('timeout');
        throw error instanceof RecommendError ? error : new RecommendError('unknown');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

export const supabaseRecommendationService: RecommendationService =
  createSupabaseRecommendationService();
