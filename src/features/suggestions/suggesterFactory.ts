// The one place that decides which BookSuggester the app uses: the `suggest-book-details` Edge
// Function by default. In development the fake can be switched on from the dev gallery.
import { create } from 'zustand';

import type { BookSuggester } from './bookSuggester';
import type { FakeSuggesterConfig, FakeSuggestOutcome } from './fakeBookSuggester';
import { supabaseBookSuggester } from './supabaseBookSuggester';

/**
 * The fake service exists only in development builds: production builds fold __DEV__ to
 * false, which drops this require (the fake and its sample data are not in the bundle).
 */
const fakes = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./fakeBookSuggester') as typeof import('./fakeBookSuggester'))
  : null;

type FakeSuggesterState = FakeSuggesterConfig & {
  /** Off by default: the real suggester is used unless the dev gallery turns the fake on. */
  fakeEnabled: boolean;
  setOutcome: (outcome: FakeSuggestOutcome) => void;
  chooseReal: () => void;
};

/** Dev gallery switch for the fake suggester. Not persisted. */
export const useFakeSuggesterStore = create<FakeSuggesterState>()((set) => ({
  fakeEnabled: false,
  outcome: 'success',
  delayMs: fakes?.FAKE_SUGGEST_DELAY_MS ?? 0,
  setOutcome: (outcome) => set({ outcome, fakeEnabled: true }),
  chooseReal: () => set({ fakeEnabled: false }),
}));

export function createBookSuggester({
  dev = __DEV__,
  real = supabaseBookSuggester,
}: { dev?: boolean; real?: BookSuggester } = {}): BookSuggester {
  const fake =
    !dev || !fakes
      ? null
      : fakes.createFakeBookSuggester(() => {
          const { outcome, delayMs } = useFakeSuggesterStore.getState();
          return { outcome, delayMs };
        });
  return {
    // Chosen on every call, so the dev switch applies without restarting the app.
    suggest(request, options) {
      const fakeOn = fake !== null && useFakeSuggesterStore.getState().fakeEnabled;
      return (fakeOn ? fake : real).suggest(request, options);
    },
  };
}

export const bookSuggester: BookSuggester = createBookSuggester();
