// State of the scan screen: camera -> processing -> review, or a failure card. Nothing is saved
// here; saving only happens from the review form.
import { useEffect, useRef, useState } from 'react';

import type { LocalImage } from '@/features/library/coverService';

import type { IdentifiedBook, ScanMode } from './bookIdentifier';
import { identifyBook, type ScanFailure } from './identifyBook';
import { retryActionFor } from './scanReview';
import { discardImage } from './scanPhoto';

type ScanPhase =
  | { name: 'camera' }
  | { name: 'processing'; photo: LocalImage }
  | { name: 'failed'; photo: LocalImage; error: ScanFailure }
  | { name: 'review'; photo: LocalImage; book: IdentifiedBook };

type Deps = {
  identify?: typeof identifyBook;
  discard?: (uri: string) => void;
};

export function useScanFlow({ identify = identifyBook, discard = discardImage }: Deps = {}) {
  const [mode, setMode] = useState<ScanMode>('cover');
  const [phase, setPhase] = useState<ScanPhase>({ name: 'camera' });
  const request = useRef<AbortController | null>(null);
  /** The photo of this attempt; removed from the cache when replaced or on leaving. */
  const currentPhoto = useRef<string | null>(null);

  const abortRequest = () => {
    request.current?.abort();
    request.current = null;
  };

  const dropPhoto = () => {
    if (currentPhoto.current) discard(currentPhoto.current);
    currentPhoto.current = null;
  };

  // Leaving the screen cancels the request and removes the temporary photo.
  useEffect(
    () => () => {
      request.current?.abort();
      if (currentPhoto.current) discard(currentPhoto.current);
    },
    [discard],
  );

  const run = async (photo: LocalImage) => {
    abortRequest();
    const controller = new AbortController();
    request.current = controller;
    setPhase({ name: 'processing', photo });
    const outcome = await identify({ photo, mode, signal: controller.signal });
    // A cancelled or superseded attempt never changes the screen.
    if (controller.signal.aborted || request.current !== controller) return;
    request.current = null;
    if (outcome.status === 'success') setPhase({ name: 'review', photo, book: outcome.book });
    else if (outcome.status === 'failed') setPhase({ name: 'failed', photo, error: outcome.error });
  };

  return {
    mode,
    setMode,
    phase,
    /** A new photo from the camera or the gallery. */
    identifyPhoto(photo: LocalImage) {
      if (currentPhoto.current !== photo.uri) dropPhoto();
      currentPhoto.current = photo.uri;
      void run(photo);
    },
    /** Cancel really aborts the request; the user is back at the camera. */
    cancel() {
      abortRequest();
      dropPhoto();
      setPhase({ name: 'camera' });
    },
    retry() {
      if (phase.name !== 'failed') return;
      if (retryActionFor(phase.error) === 'identify') void run(phase.photo);
      else {
        dropPhoto();
        setPhase({ name: 'camera' });
      }
    },
    retake() {
      abortRequest();
      dropPhoto();
      setPhase({ name: 'camera' });
    },
  };
}
