// The Librero's recommendations: the current one from the shelf, the current "Nuevas aventuras"
// suggestion, the cached history (works offline) and what was already suggested in this app
// session (memory only, so a restart starts fresh). Before asking the server, a quick sync
// (max 5 s) lets it see the latest books and preferences.
import { create } from 'zustand';

import { discoveryService } from '@/features/recommendations/discoveryFactory';
import {
  toDiscoverErrorCode,
  type DiscoverErrorCode,
  type DiscoveryService,
  type TitleAuthor,
} from '@/features/recommendations/discoveryService';
import type { RecommendationRepository } from '@/features/recommendations/recommendationRepository';
import {
  addDiscoveryExclusion,
  addSessionExclusion,
  excludeIdsFor,
  localTimeOf,
  nextDisposition,
  noCandidatesReason,
  type Disposition,
  type Mood,
  type Recommendation,
  type RecommendChoices,
} from '@/features/recommendations/recommendationRules';
import {
  isAbortError,
  toRecommendErrorCode,
  type RecommendationService,
  type RecommendErrorCode,
} from '@/features/recommendations/recommendationService';
import { recommendationService } from '@/features/recommendations/serviceFactory';
import { sqliteRecommendationRepository } from '@/features/recommendations/sqliteRecommendationRepository';
import { deviceNetwork, type Network } from '@/lib/network';

import { useSyncStore } from './syncStore';

/** `offline`: no connection (the cached recommendation stays). `exhausted`: every "to read"
 * book was already suggested in this session ("Empezar de nuevo" clears the session). */
export type RecommendFailure = RecommendErrorCode | 'offline' | 'exhausted';

/** `offline`: no connection (the cached suggestion stays). */
export type DiscoverFailure = DiscoverErrorCode | 'offline';

type RequestStatus = 'idle' | 'loading' | 'ready' | 'error';

/** "Nuevas aventuras" request: a book of the shelf to look like (or favorites), mood, text. */
export type DiscoverInput = {
  seedBookId?: string | null;
  mood?: Mood | null;
  context?: string | null;
};

/** How long a request waits for the pre-sync before asking anyway. */
const PRE_SYNC_WAIT_MS = 5_000;

type RecommendationsState = {
  userId: string | null;
  /** The shelf recommendation to show: the latest one, also when offline (from the cache). */
  current: Recommendation | null;
  /** The latest "Nuevas aventuras" suggestion, also when offline (from the cache). */
  currentDiscovery: Recommendation | null;
  /** Newest first, both kinds (cached, up to 50). */
  history: Recommendation[];
  /** Books suggested in this app session, sent as exclude_book_ids. Memory only. */
  sessionSuggestedBookIds: string[];
  /** Suggestions shown in this app session, sent as exclude_suggestions. Memory only. */
  sessionDiscoveryExclusions: TitleAuthor[];
  status: RequestStatus;
  error: RecommendFailure | null;
  discoveryStatus: RequestStatus;
  discoveryError: DiscoverFailure | null;
  /** Reads the cache for the signed-in user. */
  load: (userId: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  /**
   * Asks the Librero for a book (context, time and mood are optional). Resolves true when a new
   * recommendation arrived.
   */
  requestRecommendation: (context?: string | null, choices?: RecommendChoices) => Promise<boolean>;
  /** "Nuevas aventuras": asks for a book outside the shelf. True when one arrived. */
  requestDiscovery: (input?: DiscoverInput) => Promise<boolean>;
  /**
   * "Otra recomendación": asks for the next shelf book; the current one is marked skipped only
   * once the next one arrived (a failed request leaves it as it was).
   */
  requestAnother: (context?: string | null, choices?: RecommendChoices) => Promise<boolean>;
  /** "Otra sugerencia": the same rule for "Nuevas aventuras". */
  requestAnotherDiscovery: (input?: DiscoverInput) => Promise<boolean>;
  markViewed: (recommendationId: string) => Promise<boolean>;
  saveForLater: (recommendationId: string) => Promise<boolean>;
  /** Marks it skipped (either kind). */
  skip: (recommendationId: string) => Promise<boolean>;
  /** "Guardar idea": keeps a suggestion for later (read_later). */
  saveIdea: (recommendationId: string) => Promise<boolean>;
  /** The suggested book was added to the shelf through the form: it is kept as read_later. */
  markAdded: (recommendationId: string) => Promise<boolean>;
  /** Really aborts the shelf request in flight; the screen goes back to what it showed. */
  cancel: () => void;
  /** Really aborts the "Nuevas aventuras" request in flight. */
  cancelDiscovery: () => void;
  /** "Empezar de nuevo": forgets this session's suggestions and asks again. */
  startOver: (context?: string | null, choices?: RecommendChoices) => Promise<boolean>;
  clear: () => void;
};

type Deps = {
  repository?: RecommendationRepository;
  service?: RecommendationService;
  discovery?: DiscoveryService;
  network?: Pick<Network, 'isOnline'>;
  /** Pushes local changes before asking (the sync engine's syncNow). */
  syncFirst?: () => Promise<void>;
  now?: () => Date;
  preSyncWaitMs?: number;
};

const initial = {
  userId: null,
  current: null,
  currentDiscovery: null,
  history: [],
  sessionSuggestedBookIds: [],
  sessionDiscoveryExclusions: [],
  status: 'idle' as const,
  error: null,
  discoveryStatus: 'idle' as const,
  discoveryError: null,
};

/** Resolves when `task` finishes or after `ms`, whichever comes first (never rejects). */
function atMost(task: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    task.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const newestOf = (history: Recommendation[], kind: Recommendation['kind']) =>
  history.find((r) => r.kind === kind) ?? null;

export function createRecommendationsStore({
  repository = sqliteRecommendationRepository,
  service = recommendationService,
  discovery = discoveryService,
  network = deviceNetwork,
  syncFirst = () => useSyncStore.getState().syncNow(),
  now = () => new Date(),
  preSyncWaitMs = PRE_SYNC_WAIT_MS,
}: Deps = {}) {
  let request: AbortController | null = null;
  let discoveryRequest: AbortController | null = null;

  return create<RecommendationsState>()((set, get) => {
    const replace = (updated: Recommendation) =>
      set((state) => ({
        current: state.current?.id === updated.id ? updated : state.current,
        currentDiscovery:
          state.currentDiscovery?.id === updated.id ? updated : state.currentDiscovery,
        history: state.history.map((r) => (r.id === updated.id ? updated : r)),
      }));

    const find = (id: string) => {
      const { current, currentDiscovery, history } = get();
      if (current?.id === id) return current;
      if (currentDiscovery?.id === id) return currentDiscovery;
      return history.find((r) => r.id === id);
    };

    /** Optimistic disposition change; rolled back if the local save fails. */
    const changeDisposition = async (id: string, disposition: Disposition) => {
      const { userId } = get();
      const before = find(id);
      if (!userId || !before) return false;
      const next = nextDisposition(before.disposition, disposition);
      if (next === before.disposition) return true;
      replace({ ...before, disposition: next, pending: true });
      const result = await repository.updateDisposition(userId, id, disposition);
      if (get().userId !== userId) return false;
      if (result.ok) replace(result.data);
      else replace(before);
      return result.ok;
    };

    const readCache = async (userId: string) => {
      const result = await repository.listHistory(userId);
      if (get().userId !== userId || !result.ok) return;
      const history = result.data;
      // The newest cached one of each kind, unless a newer request result is already shown.
      const keep = (shown: Recommendation | null, kind: Recommendation['kind']) =>
        shown && !history.some((r) => r.id === shown.id) ? shown : newestOf(history, kind);
      set((state) => ({
        history,
        current: keep(state.current, 'shelf'),
        currentDiscovery: keep(state.currentDiscovery, 'discovery'),
      }));
    };

    /** Online check and pre-sync shared by both requests; false when offline. */
    const prepare = async () => {
      if (!(await network.isOnline().catch(() => true))) return false;
      await atMost(syncFirst(), preSyncWaitMs);
      return true;
    };

    return {
      ...initial,

      load: async (userId) => {
        if (get().userId !== userId) {
          request?.abort();
          discoveryRequest?.abort();
          set({ ...initial, userId });
        }
        await readCache(userId);
      },

      loadHistory: async () => {
        const { userId } = get();
        if (userId) await readCache(userId);
      },

      requestRecommendation: async (context = null, choices = {}) => {
        const { userId } = get();
        if (!userId) return false;
        request?.abort();
        const controller = new AbortController();
        request = controller;
        const stale = () => request !== controller || get().userId !== userId;
        set({ status: 'loading', error: null });

        if (!(await prepare())) {
          if (!stale()) set({ status: 'error', error: 'offline' });
          return false;
        }
        if (stale()) return false;

        const session = get().sessionSuggestedBookIds;
        const { localWeekday, localHour } = localTimeOf(now());
        const trimmed = context?.trim() || null;
        const availableTime = choices.availableTime ?? null;
        const mood = choices.mood ?? null;
        try {
          const created = await service.recommend(
            {
              context: trimmed,
              availableTime,
              mood,
              excludeBookIds: excludeIdsFor(session),
              localWeekday,
              localHour,
            },
            { signal: controller.signal },
          );
          if (stale()) return false;
          const saved = await repository.saveNew(userId, created, {
            context: trimmed,
            available_time: availableTime,
            mood,
            local_weekday: localWeekday,
            local_hour: localHour,
          });
          if (stale()) return false;
          const recommendation: Recommendation = saved.ok
            ? saved.data
            : {
                id: created.recommendationId,
                kind: 'shelf',
                bookId: created.bookId,
                suggestion: null,
                rationale: created.rationale,
                disposition: 'suggested',
                createdAt: created.createdAt,
                pending: false,
              };
          set((state) => ({
            current: recommendation,
            history: [recommendation, ...state.history.filter((r) => r.id !== recommendation.id)],
            sessionSuggestedBookIds: addSessionExclusion(
              state.sessionSuggestedBookIds,
              created.bookId,
            ),
            status: 'ready',
            error: null,
          }));
          return true;
        } catch (error) {
          if (stale() || isAbortError(error)) return false;
          const code = toRecommendErrorCode(error);
          if (code === 'no_candidates' && noCandidatesReason(session) === 'exhausted') {
            // Every book was suggested once in this session.
            set({ status: 'error', error: 'exhausted' });
          } else {
            set({ status: 'error', error: code });
          }
          return false;
        } finally {
          if (request === controller) request = null;
        }
      },

      requestDiscovery: async ({ seedBookId = null, mood = null, context = null } = {}) => {
        const { userId } = get();
        if (!userId) return false;
        discoveryRequest?.abort();
        const controller = new AbortController();
        discoveryRequest = controller;
        const stale = () => discoveryRequest !== controller || get().userId !== userId;
        set({ discoveryStatus: 'loading', discoveryError: null });

        if (!(await prepare())) {
          if (!stale()) set({ discoveryStatus: 'error', discoveryError: 'offline' });
          return false;
        }
        if (stale()) return false;

        const { localWeekday, localHour } = localTimeOf(now());
        const trimmed = context?.trim() || null;
        try {
          const created = await discovery.discover(
            {
              seedBookId,
              mood,
              context: trimmed,
              excludeSuggestions: get().sessionDiscoveryExclusions,
              localWeekday,
              localHour,
            },
            { signal: controller.signal },
          );
          if (stale()) return false;
          const saved = await repository.saveDiscovery(userId, created, {
            mode: 'discovery',
            seed_book_id: seedBookId,
            mood,
            context: trimmed,
            local_weekday: localWeekday,
            local_hour: localHour,
          });
          if (stale()) return false;
          const suggestion: Recommendation = saved.ok
            ? saved.data
            : {
                id: created.recommendationId,
                kind: 'discovery',
                bookId: null,
                suggestion: {
                  title: created.title,
                  author: created.author,
                  genre: created.genre,
                  pageCount: created.pageCount,
                  verified: created.verified,
                  confidence: created.confidence,
                },
                rationale: created.rationale,
                disposition: 'suggested',
                createdAt: created.createdAt,
                pending: false,
              };
          set((state) => ({
            currentDiscovery: suggestion,
            history: [suggestion, ...state.history.filter((r) => r.id !== suggestion.id)],
            sessionDiscoveryExclusions: addDiscoveryExclusion(state.sessionDiscoveryExclusions, {
              title: created.title,
              author: created.author,
            }),
            discoveryStatus: 'ready',
            discoveryError: null,
          }));
          return true;
        } catch (error) {
          if (stale() || isAbortError(error)) return false;
          set({ discoveryStatus: 'error', discoveryError: toDiscoverErrorCode(error) });
          return false;
        } finally {
          if (discoveryRequest === controller) discoveryRequest = null;
        }
      },

      requestAnother: async (context = null, choices = {}) => {
        const previous = get().current;
        const arrived = await get().requestRecommendation(context, choices);
        if (arrived && previous && get().current?.id !== previous.id) {
          await changeDisposition(previous.id, 'skipped');
        }
        return arrived;
      },

      requestAnotherDiscovery: async (input = {}) => {
        const previous = get().currentDiscovery;
        const arrived = await get().requestDiscovery(input);
        if (arrived && previous && get().currentDiscovery?.id !== previous.id) {
          await changeDisposition(previous.id, 'skipped');
        }
        return arrived;
      },

      markViewed: (id) => changeDisposition(id, 'viewed'),
      saveForLater: (id) => changeDisposition(id, 'read_later'),
      skip: (id) => changeDisposition(id, 'skipped'),
      saveIdea: (id) => changeDisposition(id, 'read_later'),
      markAdded: (id) => changeDisposition(id, 'read_later'),

      cancel: () => {
        if (!request) return;
        request.abort();
        request = null;
        set((state) => ({ status: state.current ? 'ready' : 'idle', error: null }));
      },

      cancelDiscovery: () => {
        if (!discoveryRequest) return;
        discoveryRequest.abort();
        discoveryRequest = null;
        set((state) => ({
          discoveryStatus: state.currentDiscovery ? 'ready' : 'idle',
          discoveryError: null,
        }));
      },

      startOver: (context = null, choices = {}) => {
        set({ sessionSuggestedBookIds: [] });
        return get().requestRecommendation(context, choices);
      },

      clear: () => {
        request?.abort();
        request = null;
        discoveryRequest?.abort();
        discoveryRequest = null;
        set({ ...initial });
      },
    };
  });
}

export const useRecommendationsStore = createRecommendationsStore();
