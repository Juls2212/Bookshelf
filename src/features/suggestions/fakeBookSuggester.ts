// Development-only suggester: waits `delayMs`, then returns or throws the configured outcome.
// It honors the abort signal like a real request would.
import { fakeSuggestions } from '@/dev/fakeFixtures';

import {
  abortError,
  BookSuggestError,
  SUGGEST_ERROR_CODES,
  type BookSuggester,
  type SuggestedBook,
  type SuggestErrorCode,
} from './bookSuggester';

/**
 * `success`: three candidates. `single`: only the best one. An error code: that failure.
 * `hang`: never answers (exercises the loading state and the 20 s timeout).
 */
export const FAKE_SUGGEST_OUTCOMES = ['success', 'single', ...SUGGEST_ERROR_CODES, 'hang'] as const;

export type FakeSuggestOutcome = (typeof FAKE_SUGGEST_OUTCOMES)[number];

export type FakeSuggesterConfig = { outcome: FakeSuggestOutcome; delayMs: number };

export const FAKE_SUGGEST_DELAY_MS = 1200;

const isErrorCode = (outcome: FakeSuggestOutcome): outcome is SuggestErrorCode =>
  (SUGGEST_ERROR_CODES as readonly string[]).includes(outcome);

/** `getConfig` is read on every call, so the outcome can change while the app runs. */
export function createFakeBookSuggester(getConfig: () => FakeSuggesterConfig): BookSuggester {
  return {
    suggest(_request, { signal } = {}) {
      const { outcome, delayMs } = getConfig();
      return new Promise<SuggestedBook[]>((resolve, reject) => {
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
          if (outcome === 'success') resolve(fakeSuggestions.map((book) => ({ ...book })));
          else if (outcome === 'single') resolve([{ ...fakeSuggestions[0] }]);
          else if (isErrorCode(outcome)) reject(new BookSuggestError(outcome));
        }, delayMs);
      });
    },
  };
}
