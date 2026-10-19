// "Portada sugerida" in the book form.
// - Automatic: once a title (and author) is typed and the book has no cover, asks for cover
//   candidates after a short pause. Typing again (or the author arriving later, e.g. from
//   "Sugerir datos") cancels the request in flight and searches again. Offline or on any error
//   nothing is shown.
// - Explicit ("Sugerir portada"): searches right away with the current title and author, also
//   when the book already has a cover; accepting then replaces it (after the user saw it).
// While a search runs the form shows "Buscando portada…", and when the catalogs found nothing,
// "No encontramos…". A failed download keeps the same candidate with an error and a retry;
// tapping another thumbnail of the strip selects another candidate.
import { useEffect, useRef, useState } from 'react';

import { deviceNetwork, type Network } from '@/lib/network';

import { coverFinder, type CoverFinder } from './coverFinder';
import type { LocalImage } from './coverService';
import {
  COVER_SUGGESTION_MIN_TITLE,
  shouldSuggestCover,
  type CoverCandidate,
} from './coverSuggestion';

const DEBOUNCE_MS = 800;

/** The latest search, for the title and author it was made with (`key`). */
type Search = { key: string; manual: boolean } & (
  | { kind: 'searching' }
  | { kind: 'none' }
  | { kind: 'offline' }
  | { kind: 'found'; candidates: CoverCandidate[]; index: number }
);

type Options = {
  /** Automatic suggestions (the explicit request works regardless). */
  enabled: boolean;
  title: string;
  author: string;
  /** A new image was picked, or the book has a saved cover. */
  hasCover: boolean;
  /** The accepted image (downloaded); the form uses it like a picked one. */
  onAccept: (image: LocalImage) => void;
  finder?: CoverFinder;
  network?: Pick<Network, 'isOnline'>;
  debounceMs?: number;
};

/** Same book whatever the case or extra spaces. */
const queryKey = (title: string, author: string) =>
  `${title.trim().replace(/\s+/g, ' ').toLowerCase()}\u0000${author
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()}`;

export function useCoverSuggestion({
  enabled,
  title,
  author,
  hasCover,
  onAccept,
  finder = coverFinder,
  network = deviceNetwork,
  debounceMs = DEBOUNCE_MS,
}: Options) {
  // Fixed for the life of the form: a new finder or network object on a re-render must not
  // cancel the pause or the request in flight (that dropped every answer).
  const [services] = useState(() => ({ finder, network }));
  const [search, setSearch] = useState<Search | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptFailed, setAcceptFailed] = useState(false);
  const manualRequest = useRef<AbortController | null>(null);
  const autoActive = shouldSuggestCover({ enabled, hasCover, dismissed, title });
  const key = queryKey(title, author);
  const trimmedTitle = title.trim();
  const trimmedAuthor = author.trim();

  /** One search; `manual` results stay visible even with a cover or after "No, gracias". */
  const runSearch = async (signal: AbortSignal, manual: boolean) => {
    const searchKey = queryKey(trimmedTitle, trimmedAuthor);
    const online = await services.network.isOnline().catch(() => false);
    if (signal.aborted) return;
    if (!online) {
      // Automatic: silent. Explicit: the user asked, so say why nothing happens.
      if (manual) setSearch({ key: searchKey, manual, kind: 'offline' });
      return;
    }
    setAcceptFailed(false);
    setSearch({ key: searchKey, manual, kind: 'searching' });
    const candidates = await services.finder.find(
      { title: trimmedTitle, author: trimmedAuthor || null },
      { signal },
    );
    if (signal.aborted) return;
    if (candidates === null) {
      setSearch(null); // failed: silent
    } else if (candidates.length === 0) {
      setSearch({ key: searchKey, manual, kind: 'none' });
    } else {
      setSearch({ key: searchKey, manual, kind: 'found', candidates, index: 0 });
    }
  };

  useEffect(() => {
    if (!autoActive) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void runSearch(controller.signal, false), debounceMs);
    // Typing again (or leaving the form) cancels the pause and the request in flight.
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // runSearch only reads the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoActive, trimmedTitle, trimmedAuthor, services, debounceMs]);

  // Leaving the form cancels an explicit request too.
  useEffect(() => () => manualRequest.current?.abort(), []);

  // Only a result for what is typed now: automatic ones while they make sense, explicit ones
  // until the title or author changes.
  const current = search?.key === key && (search.manual || autoActive) ? search : null;
  const found = current?.kind === 'found' ? current : null;
  const candidate = found ? found.candidates[found.index] : null;

  return {
    candidate,
    accepting,
    /** The last "Usar esta portada" could not download the image (same candidate kept). */
    acceptFailed,
    /** "searching", "none" (nothing found) or "offline" (explicit request only); else null. */
    status:
      current?.kind === 'searching' || current?.kind === 'none' || current?.kind === 'offline'
        ? current.kind
        : null,
    /** Every candidate found (up to ten), best first; empty while there is none. */
    candidates: found ? found.candidates : [],
    /** Position of the selected candidate in the list. */
    index: found ? found.index : 0,
    /** The automatic suggestion was declined or found nothing: offer "Sugerir portada". */
    autoExhausted: dismissed || (current?.kind === 'none' && !current.manual),
    /** "Sugerir portada" can run (a title long enough, nothing running). */
    canRequest: trimmedTitle.length >= COVER_SUGGESTION_MIN_TITLE && current?.kind !== 'searching',
    /** "Sugerir portada": searches now with the current title and author. */
    request() {
      if (trimmedTitle.length < COVER_SUGGESTION_MIN_TITLE) return;
      manualRequest.current?.abort();
      const controller = new AbortController();
      manualRequest.current = controller;
      void runSearch(controller.signal, true);
    },
    /**
     * "Usar esta portada" (and its retry): downloads it. On success the form gets the image
     * and the card closes; on failure the same candidate stays, with the error.
     */
    async accept() {
      if (!found || !candidate || accepting) return;
      setAccepting(true);
      setAcceptFailed(false);
      const image = await services.finder.download(candidate);
      setAccepting(false);
      if (image) {
        onAccept(image);
        setSearch(null);
      } else {
        setAcceptFailed(true);
      }
    },
    /** "No, gracias": no more automatic suggestions in this form. */
    decline() {
      manualRequest.current?.abort();
      setDismissed(true);
      setAcceptFailed(false);
      setSearch(null);
    },
    /** Selects another candidate of the strip as the current one. */
    select(index: number) {
      if (found && index >= 0 && index < found.candidates.length && index !== found.index) {
        setAcceptFailed(false);
        setSearch({ ...found, index });
      }
    },
  };
}

export type CoverSuggestion = ReturnType<typeof useCoverSuggestion>;
