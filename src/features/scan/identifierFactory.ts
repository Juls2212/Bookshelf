// The one place that decides which BookIdentifier the app uses: the `identify-book` Edge
// Function by default. In development the fake can be switched on from the dev gallery.
import { create } from 'zustand';

import type { BookIdentifier } from './bookIdentifier';
import type { FakeIdentifierConfig, FakeOutcome } from './fakeBookIdentifier';
import { supabaseBookIdentifier } from './supabaseBookIdentifier';

/**
 * The fake service exists only in development builds: production builds fold __DEV__ to
 * false, which drops this require (the fake and its sample data are not in the bundle).
 */
const fakes = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./fakeBookIdentifier') as typeof import('./fakeBookIdentifier'))
  : null;

type FakeIdentifierState = FakeIdentifierConfig & {
  /** Off by default: the real identifier is used unless the dev gallery turns the fake on. */
  fakeEnabled: boolean;
  setOutcome: (outcome: FakeOutcome) => void;
  chooseReal: () => void;
};

/** Dev gallery switch for the fake identifier. Not persisted. */
export const useFakeIdentifierStore = create<FakeIdentifierState>()((set) => ({
  fakeEnabled: false,
  outcome: 'success',
  delayMs: fakes?.FAKE_DEFAULT_DELAY_MS ?? 0,
  setOutcome: (outcome) => set({ outcome, fakeEnabled: true }),
  chooseReal: () => set({ fakeEnabled: false }),
}));

export function createBookIdentifier({
  dev = __DEV__,
  real = supabaseBookIdentifier,
}: { dev?: boolean; real?: BookIdentifier } = {}): BookIdentifier {
  const fake =
    !dev || !fakes
      ? null
      : fakes.createFakeBookIdentifier(() => {
          const { outcome, delayMs } = useFakeIdentifierStore.getState();
          return { outcome, delayMs };
        });
  return {
    // Chosen on every call, so the dev switch applies without restarting the app.
    identify(request, options) {
      const fakeOn = fake !== null && useFakeIdentifierStore.getState().fakeEnabled;
      return (fakeOn ? fake : real).identify(request, options);
    },
  };
}

export const bookIdentifier: BookIdentifier = createBookIdentifier();
