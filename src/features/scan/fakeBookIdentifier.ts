// Development-only identifier: waits `delayMs`, then returns or throws the configured outcome.
// It honors the abort signal like a real request would.
import { fakeIdentifiedBook, fakeLowConfidenceBook } from '@/dev/fakeFixtures';

import {
  BookIdentifyError,
  IDENTIFY_ERROR_CODES,
  type BookIdentifier,
  type IdentifiedBook,
  type IdentifyErrorCode,
} from './bookIdentifier';

/**
 * `success`: a confident result. `low_result`: a result with low confidence (still reviewable).
 * An error code: that failure. `hang`: never answers (exercises cancel and the 30 s timeout).
 */
export const FAKE_OUTCOMES = ['success', 'low_result', ...IDENTIFY_ERROR_CODES, 'hang'] as const;

export type FakeOutcome = (typeof FAKE_OUTCOMES)[number];

export type FakeIdentifierConfig = { outcome: FakeOutcome; delayMs: number };

export const FAKE_DEFAULT_DELAY_MS = 2500;

const isErrorCode = (outcome: FakeOutcome): outcome is IdentifyErrorCode =>
  (IDENTIFY_ERROR_CODES as readonly string[]).includes(outcome);

/** Same error name fetch uses when its signal aborts. */
function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

/** `getConfig` is read on every call, so the outcome can change while the app runs. */
export function createFakeBookIdentifier(getConfig: () => FakeIdentifierConfig): BookIdentifier {
  return {
    identify(_request, { signal } = {}) {
      const { outcome, delayMs } = getConfig();
      return new Promise<IdentifiedBook>((resolve, reject) => {
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
          if (outcome === 'success') resolve({ ...fakeIdentifiedBook });
          else if (outcome === 'low_result') resolve({ ...fakeLowConfidenceBook });
          else if (isErrorCode(outcome)) reject(new BookIdentifyError(outcome));
        }, delayMs);
      });
    },
  };
}
