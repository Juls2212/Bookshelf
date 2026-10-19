// State of the "Sugerir datos" helper in the book form. A request only starts when the user
// taps the button (never while typing). Leaving the form or asking again aborts the request.
import { useEffect, useRef, useState } from 'react';

import { deviceNetwork, type Network } from '@/lib/network';

import {
  isAbortError,
  toSuggestErrorCode,
  type BookSuggester,
  type SuggestedBook,
  type SuggestErrorCode,
  type SuggestRequest,
} from './bookSuggester';
import { bookSuggester } from './suggesterFactory';
import type { SuggestField } from './suggestionLogic';

type SuggestState =
  | { name: 'idle' }
  | { name: 'loading' }
  | { name: 'ready'; candidates: SuggestedBook[]; index: number }
  | { name: 'failed'; error: SuggestErrorCode };

type Deps = {
  suggester?: BookSuggester;
  network?: Pick<Network, 'isOnline' | 'subscribe'>;
  /** False in the edit flow: no connectivity listener, nothing to suggest. */
  enabled?: boolean;
};

const NO_FIELDS: ReadonlySet<SuggestField> = new Set();

export function useBookSuggestions({
  suggester = bookSuggester,
  network = deviceNetwork,
  enabled = true,
}: Deps = {}) {
  const [state, setState] = useState<SuggestState>({ name: 'idle' });
  const [online, setOnline] = useState(true);
  /** Dismissed proposals of the current candidate. */
  const [dismissed, setDismissed] = useState<ReadonlySet<SuggestField>>(NO_FIELDS);
  /** Fields the user typed in after asking: their proposals are gone for good. */
  const [edited, setEdited] = useState<ReadonlySet<SuggestField>>(NO_FIELDS);
  const request = useRef<AbortController | null>(null);
  const lastQuery = useRef<SuggestRequest | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    network
      .isOnline()
      .then((value) => {
        if (active) setOnline(value);
      })
      .catch(() => undefined);
    const unsubscribe = network.subscribe(setOnline);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled, network]);

  // Leaving the form aborts a request in flight.
  useEffect(() => () => request.current?.abort(), []);

  const run = async (query: SuggestRequest) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    lastQuery.current = query;
    setDismissed(NO_FIELDS);
    setEdited(NO_FIELDS);
    setState({ name: 'loading' });

    const isOnline = await network.isOnline().catch(() => true);
    if (controller.signal.aborted) return;
    if (!isOnline) {
      setOnline(false);
      setState({ name: 'failed', error: 'network' });
      return;
    }
    try {
      const candidates = await suggester.suggest(query, { signal: controller.signal });
      if (request.current !== controller) return;
      setState(
        candidates.length > 0
          ? { name: 'ready', candidates, index: 0 }
          : { name: 'failed', error: 'no_suggestions' },
      );
    } catch (error) {
      if (request.current !== controller || isAbortError(error)) return;
      setState({ name: 'failed', error: toSuggestErrorCode(error) });
    } finally {
      if (request.current === controller) request.current = null;
    }
  };

  const hidden: ReadonlySet<SuggestField> =
    dismissed.size === 0 ? edited : new Set([...dismissed, ...edited]);

  return {
    state,
    online,
    /** Fields whose proposal must not be shown (dismissed, or typed in after asking). */
    hidden,
    /** Only ever called from the "Sugerir datos" button. */
    ask(title: string, author: string) {
      void run({ title: title.trim(), author: author.trim() || null });
    },
    retry() {
      if (lastQuery.current) void run(lastQuery.current);
    },
    /** Switches to another candidate; its proposals start fresh except for typed fields. */
    choose(index: number) {
      if (state.name !== 'ready' || index < 0 || index >= state.candidates.length) return;
      setDismissed(NO_FIELDS);
      setState({ ...state, index });
    },
    dismiss(fields: readonly SuggestField[]) {
      setDismissed((current) => new Set([...current, ...fields]));
    },
    /** The user typed in a field: its pending proposal disappears. */
    markEdited(field: SuggestField) {
      if (state.name !== 'ready' || edited.has(field)) return;
      setEdited((current) => new Set([...current, field]));
    },
    /** "Descartar todo": closes the suggestions. */
    close() {
      request.current?.abort();
      request.current = null;
      setState({ name: 'idle' });
    },
  };
}

export type BookSuggestions = ReturnType<typeof useBookSuggestions>;
