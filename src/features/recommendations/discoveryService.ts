// "Nuevas aventuras": asks for ONE book that is not on the user's shelf. The implementation is
// picked by discoveryFactory.ts: the Supabase Edge Function `discover-book`, or a fake chosen in
// the dev gallery. Results are suggestions only: a book is created only through the add form.
import type { Confidence, Mood } from './recommendationRules';

export const DISCOVER_ERROR_CODES = [
  'no_new_suggestions',
  'rate_limited',
  'network',
  'timeout',
  'unauthorized',
  'unknown',
] as const;

export type DiscoverErrorCode = (typeof DISCOVER_ERROR_CODES)[number];

/** Typed failure of a discovery service. `message` is the English code. */
export class DiscoverError extends Error {
  readonly code: DiscoverErrorCode;

  constructor(code: DiscoverErrorCode) {
    super(code);
    this.name = 'DiscoverError';
    this.code = code;
  }
}

export type TitleAuthor = { title: string; author: string | null };

export type DiscoverRequest = {
  /** "Parecido a…": one of the user's books; null = based on their favorites. */
  seedBookId: string | null;
  /** Only when consider_mood is on. */
  mood: Mood | null;
  context: string | null;
  /** Suggestions already shown in this app session (at most 30). */
  excludeSuggestions: TitleAuthor[];
  localWeekday: number;
  localHour: number;
};

/** What the Edge Function returned. */
export type NewDiscovery = {
  recommendationId: string;
  title: string;
  author: string | null;
  genre: string | null;
  pageCount: number | null;
  /** Found in an open catalog (Open Library). */
  verified: boolean;
  confidence: Confidence;
  rationale: string;
  createdAt: string;
};

export type DiscoverOptions = { signal?: AbortSignal };

export interface DiscoveryService {
  /** Rejects with a DiscoverError (or an AbortError when cancelled). */
  discover(request: DiscoverRequest, options?: DiscoverOptions): Promise<NewDiscovery>;
}

export function toDiscoverErrorCode(error: unknown): DiscoverErrorCode {
  return error instanceof DiscoverError ? error.code : 'unknown';
}
