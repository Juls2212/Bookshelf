// The one place that decides which RecommendationService the app uses: the `recommend-book`
// Edge Function by default. In development the fake can be switched on from the dev gallery.
import { create } from 'zustand';

import { useLibraryStore } from '@/stores/libraryStore';

import type { FakeRecommendConfig, FakeRecommendOutcome } from './fakeRecommendationService';

import type { RecommendationService } from './recommendationService';
import { supabaseRecommendationService } from './supabaseRecommendationService';

/**
 * The fake service exists only in development builds: production builds fold __DEV__ to
 * false, which drops this require (the fake and its sample data are not in the bundle).
 */
const fakes = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./fakeRecommendationService') as typeof import('./fakeRecommendationService'))
  : null;

type FakeRecommendState = FakeRecommendConfig & {
  /** Off by default: the real service is used unless the dev gallery turns the fake on. */
  fakeEnabled: boolean;
  setOutcome: (outcome: FakeRecommendOutcome) => void;
  chooseReal: () => void;
};

/** Dev gallery switch for the fake service. Not persisted. */
export const useFakeRecommendStore = create<FakeRecommendState>()((set) => ({
  fakeEnabled: false,
  outcome: 'success',
  delayMs: fakes?.FAKE_RECOMMEND_DELAY_MS ?? 0,
  setOutcome: (outcome) => set({ outcome, fakeEnabled: true }),
  chooseReal: () => set({ fakeEnabled: false }),
}));

/** The fake picks from the user's real "to read" books (oldest first), like the server. */
const toReadBookIds = () =>
  useLibraryStore
    .getState()
    .books.filter((book) => book.readingStatus === 'to_read' && !book.lentTo)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((book) => book.id);

export function createRecommendationService({
  dev = __DEV__,
  real = supabaseRecommendationService,
}: { dev?: boolean; real?: RecommendationService } = {}): RecommendationService {
  const fake =
    !dev || !fakes
      ? null
      : fakes.createFakeRecommendationService({
          getConfig: () => {
            const { outcome, delayMs } = useFakeRecommendStore.getState();
            return { outcome, delayMs };
          },
          getToReadBookIds: toReadBookIds,
        });
  return {
    // Chosen on every call, so the dev switch applies without restarting the app.
    recommend(request, options) {
      const fakeOn = fake !== null && useFakeRecommendStore.getState().fakeEnabled;
      return (fakeOn ? fake : real).recommend(request, options);
    },
  };
}

export const recommendationService: RecommendationService = createRecommendationService();
