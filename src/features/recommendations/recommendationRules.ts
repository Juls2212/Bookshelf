// Pure rules of the Librero's recommendations: disposition changes, the books already suggested
// in this app session (sent as exclude_book_ids) and what "no candidates" means.
import type { RecommendationDisposition, RecommendationKind } from '@/types/database';

export type Disposition = RecommendationDisposition;

export type Confidence = 'high' | 'medium' | 'low';

/** A book suggested outside the shelf ("Nuevas aventuras"). */
export type SuggestedBookInfo = {
  title: string;
  author: string | null;
  genre: string | null;
  pageCount: number | null;
  /** Found in an open catalog; null when it was not checked. */
  verified: boolean | null;
  confidence: Confidence | null;
};

export type Recommendation = {
  id: string;
  kind: RecommendationKind;
  /** The shelf book (kind 'shelf'); null for discovery suggestions. */
  bookId: string | null;
  /** The suggested book (kind 'discovery'); null for shelf recommendations. */
  suggestion: SuggestedBookInfo | null;
  rationale: string;
  disposition: Disposition;
  createdAt: string;
  /** A disposition change saved on this device but not yet synced. */
  pending: boolean;
};

/** How long the reading session can be (same keys as the Edge Function). */
export const AVAILABLE_TIMES = [
  'under_30_min',
  'about_1_hour',
  'two_hours_plus',
  'no_rush',
] as const;
export type AvailableTime = (typeof AVAILABLE_TIMES)[number];

/** How the user feels like reading; only asked (and sent) when consider_mood is on. */
export const MOODS = ['calm', 'light', 'thoughtful', 'exciting'] as const;
export type Mood = (typeof MOODS)[number];

/** Optional choices of a request. */
export type RecommendChoices = { availableTime?: AvailableTime | null; mood?: Mood | null };

/** Single-select chips: tapping the selected one clears it. */
export function toggleChoice<T extends string>(current: T | null, tapped: T): T | null {
  return current === tapped ? null : tapped;
}

/** The server accepts at most 30 excluded ids. */
const SESSION_EXCLUDE_MAX = 30;

/**
 * The disposition after the user acts on a recommendation:
 * - nothing goes back to "suggested";
 * - "viewed" only upgrades a fresh suggestion (opening a saved or skipped one keeps it);
 * - "read_later" and "skipped" are explicit choices and replace any other state.
 */
export function nextDisposition(current: Disposition, requested: Disposition): Disposition {
  if (requested === 'suggested') return current;
  if (requested === 'viewed') return current === 'suggested' ? 'viewed' : current;
  return requested;
}

/** Whether acting on it changes anything (no write, no sync when it does not). */
export function changesDisposition(current: Disposition, requested: Disposition): boolean {
  return nextDisposition(current, requested) !== current;
}

/** Adds a suggested book to this session's exclusions (no duplicates, newest last). */
export function addSessionExclusion(ids: readonly string[], bookId: string): string[] {
  return [...ids.filter((id) => id !== bookId), bookId];
}

/** Same suggestion: same title and author, ignoring case, accents and spacing. */
const suggestionKey = ({ title, author }: { title: string; author: string | null }) =>
  [title, author ?? '']
    .map((part) =>
      part.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim(),
    )
    .join('|');

/** Adds a "Nuevas aventuras" suggestion to this session's exclusions (no duplicates, max 30). */
export function addDiscoveryExclusion<T extends { title: string; author: string | null }>(
  list: readonly T[],
  suggestion: T,
): T[] {
  const key = suggestionKey(suggestion);
  return [...list.filter((s) => suggestionKey(s) !== key), suggestion].slice(-SESSION_EXCLUDE_MAX);
}

/** What the request sends: the most recent exclusions, at most 30. */
export function excludeIdsFor(ids: readonly string[]): string[] {
  return ids.slice(-SESSION_EXCLUDE_MAX);
}

/**
 * `no_candidates` from the server: with books excluded in this session, every "to read" book
 * was already suggested (`exhausted`: start over); without exclusions there is nothing to
 * recommend (`no_candidates`: add or finish books).
 */
export function noCandidatesReason(
  sessionExcluded: readonly string[],
): 'exhausted' | 'no_candidates' {
  return sessionExcluded.length > 0 ? 'exhausted' : 'no_candidates';
}

/** The device weekday (0 = Sunday ... 6 = Saturday) and hour, as the server expects. */
export function localTimeOf(now: Date): { localWeekday: number; localHour: number } {
  return { localWeekday: now.getDay(), localHour: now.getHours() };
}
