// Development-only service: waits `delayMs`, then recommends one of the user's own "to read"
// books (not excluded) or fails with the configured outcome. It honors the abort signal.
import { randomUUID } from 'expo-crypto';

import { fakeRationale } from '@/dev/fakeFixtures';

import type { NewRecommendation } from './recommendationRepository';
import {
  abortError,
  RECOMMEND_ERROR_CODES,
  RecommendError,
  type RecommendationService,
  type RecommendErrorCode,
} from './recommendationService';

/** `success`: one of the books it is given. An error code: that failure. `hang`: no answer. */
export const FAKE_RECOMMEND_OUTCOMES = ['success', ...RECOMMEND_ERROR_CODES, 'hang'] as const;

export type FakeRecommendOutcome = (typeof FAKE_RECOMMEND_OUTCOMES)[number];

export type FakeRecommendConfig = { outcome: FakeRecommendOutcome; delayMs: number };

export const FAKE_RECOMMEND_DELAY_MS = 1500;

const isErrorCode = (outcome: FakeRecommendOutcome): outcome is RecommendErrorCode =>
  (RECOMMEND_ERROR_CODES as readonly string[]).includes(outcome);

type Deps = {
  getConfig: () => FakeRecommendConfig;
  /** The user's "to read" book ids (oldest first). */
  getToReadBookIds: () => string[];
  newId?: () => string;
  now?: () => Date;
};

export function createFakeRecommendationService({
  getConfig,
  getToReadBookIds,
  newId = randomUUID,
  now = () => new Date(),
}: Deps): RecommendationService {
  return {
    recommend(request, { signal } = {}) {
      const { outcome, delayMs } = getConfig();
      return new Promise<NewRecommendation>((resolve, reject) => {
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
            reject(new RecommendError(outcome));
            return;
          }
          const excluded = new Set(request.excludeBookIds);
          const bookId = getToReadBookIds().find((id) => !excluded.has(id));
          if (!bookId) {
            reject(new RecommendError('no_candidates'));
            return;
          }
          resolve({
            recommendationId: newId(),
            bookId,
            rationale: fakeRationale,
            createdAt: now().toISOString(),
          });
        }, delayMs);
      });
    },
  };
}
