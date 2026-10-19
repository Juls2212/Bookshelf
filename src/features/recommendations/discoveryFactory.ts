// The one place that decides which DiscoveryService the app uses: the `discover-book` Edge
// Function by default. In development the fake can be switched on from the dev gallery.
import { create } from 'zustand';

import type { DiscoveryService } from './discoveryService';
import type { FakeDiscoverConfig, FakeDiscoverOutcome } from './fakeDiscoveryService';
import { supabaseDiscoveryService } from './supabaseDiscoveryService';

/**
 * The fake service exists only in development builds: production builds fold __DEV__ to
 * false, which drops this require (the fake and its sample data are not in the bundle).
 */
const fakes = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./fakeDiscoveryService') as typeof import('./fakeDiscoveryService'))
  : null;

type FakeDiscoverState = FakeDiscoverConfig & {
  /** Off by default: the real service is used unless the dev gallery turns the fake on. */
  fakeEnabled: boolean;
  setOutcome: (outcome: FakeDiscoverOutcome) => void;
  chooseReal: () => void;
};

/** Dev gallery switch for the fake service. Not persisted. */
export const useFakeDiscoverStore = create<FakeDiscoverState>()((set) => ({
  fakeEnabled: false,
  outcome: 'success',
  delayMs: fakes?.FAKE_DISCOVER_DELAY_MS ?? 0,
  setOutcome: (outcome) => set({ outcome, fakeEnabled: true }),
  chooseReal: () => set({ fakeEnabled: false }),
}));

export function createDiscoveryService({
  dev = __DEV__,
  real = supabaseDiscoveryService,
}: { dev?: boolean; real?: DiscoveryService } = {}): DiscoveryService {
  const fake =
    !dev || !fakes
      ? null
      : fakes.createFakeDiscoveryService({
          getConfig: () => {
            const { outcome, delayMs } = useFakeDiscoverStore.getState();
            return { outcome, delayMs };
          },
        });
  return {
    // Chosen on every call, so the dev switch applies without restarting the app.
    discover(request, options) {
      const fakeOn = fake !== null && useFakeDiscoverStore.getState().fakeEnabled;
      return (fakeOn ? fake : real).discover(request, options);
    },
  };
}

export const discoveryService: DiscoveryService = createDiscoveryService();
