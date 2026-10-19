// Pure presentation rules of the Librero: which state the screen shows, the history filter and
// the preferences summary. Copy comes from i18n.
import type { PreferenceOption, ReadingPreferences } from '@/features/preferences/preferencesRules';
import { PREFERENCE_OPTIONS } from '@/features/preferences/preferencesRules';
import type {
  Recommendation,
  SuggestedBookInfo,
} from '@/features/recommendations/recommendationRules';
import { format, t } from '@/i18n';
import type { DiscoverFailure, RecommendFailure } from '@/stores/recommendationsStore';

/** Errors shown as a message with "Reintentar". */
export type RetryableFailure = Exclude<RecommendFailure, 'offline' | 'no_candidates' | 'exhausted'>;

export type LibrarianView =
  | { kind: 'loading' }
  | { kind: 'error'; error: RetryableFailure }
  | { kind: 'no_candidates' }
  | { kind: 'exhausted' }
  /** `offline`: the cached one, with a note that it is a saved suggestion. */
  | { kind: 'result'; recommendation: Recommendation; offline: boolean }
  /** Nothing to show yet: an invitation to ask. */
  | { kind: 'invite'; offline: boolean };

type Input = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: RecommendFailure | null;
  current: Recommendation | null;
  /** No connection right now (the request button is disabled). */
  offline: boolean;
};

export function librarianView({ status, error, current, offline }: Input): LibrarianView {
  if (status === 'loading') return { kind: 'loading' };
  if (status === 'error' && error && error !== 'offline') {
    if (error === 'no_candidates' || error === 'exhausted') return { kind: error };
    return { kind: 'error', error };
  }
  const isOffline = offline || error === 'offline';
  return current
    ? { kind: 'result', recommendation: current, offline: isOffline }
    : { kind: 'invite', offline: isOffline };
}

export type HistoryFilter = 'all' | 'read_later';

export function filterHistory(
  history: readonly Recommendation[],
  filter: HistoryFilter,
): Recommendation[] {
  return filter === 'all' ? [...history] : history.filter((r) => r.disposition === 'read_later');
}

/** "Novela, Poesía" or the no-genres text; the active switches as a short list. */
export function preferencesSummary(preferences: ReadingPreferences): {
  genres: string;
  options: string;
} {
  const genres = preferences.favoriteGenres.map((genre) => t.profile.genres[genre]);
  const options = PREFERENCE_OPTIONS.filter((option: PreferenceOption) => preferences[option]).map(
    (option) => t.librarian.prefsOptions[option],
  );
  return {
    genres:
      genres.length > 0
        ? format(t.librarian.prefsGenres, { genres: genres.join(', ') })
        : t.librarian.prefsNoGenres,
    options:
      options.length > 0
        ? format(t.librarian.prefsOptionsLine, { options: options.join(', ') })
        : t.librarian.prefsNone,
  };
}

/** Discovery errors worth trying again right away ("Reintentar"). */
export const DISCOVERY_RETRYABLE: readonly DiscoverFailure[] = ['network', 'timeout', 'unknown'];

export type DiscoveryView =
  | { kind: 'loading' }
  | { kind: 'error'; error: Exclude<DiscoverFailure, 'offline'> }
  | {
      kind: 'result';
      recommendation: Recommendation & { suggestion: SuggestedBookInfo };
      offline: boolean;
    }
  | { kind: 'invite'; offline: boolean };

/** "Nuevas aventuras": same rules as the shelf view (offline keeps the cached suggestion). */
export function discoveryView({
  status,
  error,
  current,
  offline,
}: {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: DiscoverFailure | null;
  current: Recommendation | null;
  offline: boolean;
}): DiscoveryView {
  if (status === 'loading') return { kind: 'loading' };
  if (status === 'error' && error && error !== 'offline') return { kind: 'error', error };
  const isOffline = offline || error === 'offline';
  return current?.kind === 'discovery' && current.suggestion
    ? {
        kind: 'result',
        recommendation: current as Recommendation & { suggestion: SuggestedBookInfo },
        offline: isOffline,
      }
    : { kind: 'invite', offline: isOffline };
}
