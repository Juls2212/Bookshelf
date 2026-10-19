// One identification attempt: offline shortcut -> small copy of the photo -> identifier, with
// a 30 s timeout (reported as a network error) and a real cancel through the abort signal.
import type { LocalImage } from '@/features/library/coverService';
import { deviceNetwork, type Network } from '@/lib/network';

import {
  BookIdentifyError,
  toIdentifyErrorCode,
  type BookIdentifier,
  type IdentifiedBook,
  type IdentifyErrorCode,
  type ScanMode,
} from './bookIdentifier';
import { bookIdentifier } from './identifierFactory';
import { discardImage, prepareForIdentification } from './scanPhoto';

export const IDENTIFY_TIMEOUT_MS = 30_000;

/** `offline`: no connection, so the identifier was never called. */
export type ScanFailure = IdentifyErrorCode | 'offline';

type IdentifyOutcome =
  | { status: 'success'; book: IdentifiedBook }
  | { status: 'failed'; error: ScanFailure }
  | { status: 'cancelled' };

type Deps = {
  identifier?: BookIdentifier;
  network?: Pick<Network, 'isOnline'>;
  prepare?: (image: LocalImage) => Promise<LocalImage>;
  discard?: (uri: string) => void;
  timeoutMs?: number;
};

/** Trims the fields; a result without a title cannot be reviewed as such. */
function cleanResult(book: IdentifiedBook): IdentifiedBook {
  const text = (value: string | null) => value?.trim() || null;
  const title = book.title?.trim() ?? '';
  if (!title) throw new BookIdentifyError('low_confidence');
  const pages = book.pageCount;
  return {
    title,
    author: text(book.author),
    genre: text(book.genre),
    pageCount: pages != null && Number.isInteger(pages) && pages > 0 ? pages : null,
    confidence: book.confidence,
    coverBox: book.coverBox ?? null,
    coverCorners: book.coverCorners ?? null,
  };
}

export async function identifyBook(
  { photo, mode, signal }: { photo: LocalImage; mode: ScanMode; signal: AbortSignal },
  {
    identifier = bookIdentifier,
    network = deviceNetwork,
    prepare = prepareForIdentification,
    discard = discardImage,
    timeoutMs = IDENTIFY_TIMEOUT_MS,
  }: Deps = {},
): Promise<IdentifyOutcome> {
  const cancelled = { status: 'cancelled' } as const;
  if (signal.aborted) return cancelled;

  const online = await network.isOnline().catch(() => true);
  if (signal.aborted) return cancelled;
  if (!online) return { status: 'failed', error: 'offline' };

  let small: LocalImage;
  try {
    small = await prepare(photo);
  } catch {
    return signal.aborted ? cancelled : { status: 'failed', error: 'unknown' };
  }
  if (signal.aborted) {
    discard(small.uri);
    return cancelled;
  }

  // The request gets its own controller: the user's cancel and the timeout both abort it.
  const request = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    request.abort();
  }, timeoutMs);
  const onCancel = () => request.abort();
  signal.addEventListener('abort', onCancel, { once: true });
  // Settles as soon as the request is aborted, even if the identifier ignores the signal.
  const aborted = new Promise<never>((_, reject) => {
    request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

  try {
    const book = await Promise.race([
      identifier.identify({ imageUri: small.uri, mode }, { signal: request.signal }),
      aborted,
    ]);
    if (signal.aborted) return cancelled;
    return { status: 'success', book: cleanResult(book) };
  } catch (error) {
    if (signal.aborted) return cancelled;
    if (timedOut) return { status: 'failed', error: 'timeout' };
    return { status: 'failed', error: toIdentifyErrorCode(error) };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onCancel);
    discard(small.uri);
  }
}
