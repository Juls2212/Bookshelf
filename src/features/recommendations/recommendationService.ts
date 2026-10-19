// Asks the Librero for the next book. The implementation is picked by serviceFactory.ts: the
// Supabase Edge Function `recommend-book`, or a fake chosen in the dev gallery.
import type { NewRecommendation } from './recommendationRepository';
import type { AvailableTime, Mood } from './recommendationRules';

export const RECOMMEND_ERROR_CODES = [
  'no_candidates',
  'rate_limited',
  'network',
  'timeout',
  'unauthorized',
  'unknown',
] as const;

export type RecommendErrorCode = (typeof RECOMMEND_ERROR_CODES)[number];

/** Typed failure of a recommendation service. `message` is the English code. */
export class RecommendError extends Error {
  readonly code: RecommendErrorCode;

  constructor(code: RecommendErrorCode) {
    super(code);
    this.name = 'RecommendError';
    this.code = code;
  }
}

export type RecommendRequest = {
  /** How the user feels / what they want right now (optional, up to 200 characters). */
  context: string | null;
  /** Length of the reading session, or null when not chosen. */
  availableTime: AvailableTime | null;
  /** Null when not chosen (or when consider_mood is off). */
  mood: Mood | null;
  /** Books already suggested in this app session (at most 30). */
  excludeBookIds: string[];
  /** Device weekday, 0 = Sunday ... 6 = Saturday. */
  localWeekday: number;
  localHour: number;
};

export type RecommendOptions = { signal?: AbortSignal };

export interface RecommendationService {
  /** Rejects with a RecommendError (or an AbortError when cancelled). */
  recommend(request: RecommendRequest, options?: RecommendOptions): Promise<NewRecommendation>;
}

export function toRecommendErrorCode(error: unknown): RecommendErrorCode {
  return error instanceof RecommendError ? error.code : 'unknown';
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}
