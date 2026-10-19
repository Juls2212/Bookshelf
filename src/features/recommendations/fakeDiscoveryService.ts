// Development-only discovery service: waits `delayMs`, then returns the first sample suggestion
// that was not excluded, or fails with the configured outcome. It honors the abort signal.
import { randomUUID } from 'expo-crypto';

import { fakeDiscoveries } from '@/dev/fakeFixtures';

import {
  DISCOVER_ERROR_CODES,
  DiscoverError,
  type DiscoverErrorCode,
  type DiscoveryService,
  type NewDiscovery,
} from './discoveryService';
import { abortError } from './recommendationService';

/** `success`: a sample suggestion. An error code: that failure. `hang`: no answer. */
export const FAKE_DISCOVER_OUTCOMES = ['success', ...DISCOVER_ERROR_CODES, 'hang'] as const;

export type FakeDiscoverOutcome = (typeof FAKE_DISCOVER_OUTCOMES)[number];

export type FakeDiscoverConfig = { outcome: FakeDiscoverOutcome; delayMs: number };

export const FAKE_DISCOVER_DELAY_MS = 1500;

const isErrorCode = (outcome: FakeDiscoverOutcome): outcome is DiscoverErrorCode =>
  (DISCOVER_ERROR_CODES as readonly string[]).includes(outcome);

type Deps = {
  getConfig: () => FakeDiscoverConfig;
  newId?: () => string;
  now?: () => Date;
};

export function createFakeDiscoveryService({
  getConfig,
  newId = randomUUID,
  now = () => new Date(),
}: Deps): DiscoveryService {
  return {
    discover(request, { signal } = {}) {
      const { outcome, delayMs } = getConfig();
      return new Promise<NewDiscovery>((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onAbort = () => {
          clearTimeout(timer);
          reject(abortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        if (outcome === 'hang') return;
        timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          if (isErrorCode(outcome)) {
            reject(new DiscoverError(outcome));
            return;
          }
          const shown = new Set(request.excludeSuggestions.map((s) => s.title));
          const sample = fakeDiscoveries.find((s) => !shown.has(s.title));
          if (!sample) {
            reject(new DiscoverError('no_new_suggestions'));
            return;
          }
          resolve({ ...sample, recommendationId: newId(), createdAt: now().toISOString() });
        }, delayMs);
      });
    },
  };
}
