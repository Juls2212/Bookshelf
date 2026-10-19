// Runs "Mejorar portada" for the book form: one run at a time (a new one cancels the previous),
// cancelled on unmount, and temporary files removed when replaced. Failures fall back to the
// original quietly.
import { useEffect, useReducer, useRef } from 'react';

import type { LocalImage } from '@/features/library/coverService';

import { coverEnhancer, type CoverEnhancer } from './coverEnhancer';
import { enhancementReducer, initialEnhancement, type CoverVersion } from './coverEnhancement';
import type { Quad } from './coverGeometry';
import { discardImage } from './scanPhoto';

type Deps = { enhancer?: CoverEnhancer; discard?: (uri: string) => void };

export function useCoverEnhancement({
  enhancer = coverEnhancer,
  discard = discardImage,
}: Deps = {}) {
  const [state, dispatch] = useReducer(enhancementReducer, initialEnhancement);
  const run = useRef<AbortController | null>(null);
  /** Improved files made by this form; removed when replaced or on leaving. */
  const files = useRef<string[]>([]);

  const dropFiles = (keep: string | null) => {
    files.current = files.current.filter((uri) => {
      if (uri === keep) return true;
      discard(uri);
      return false;
    });
  };

  useEffect(
    () => () => {
      run.current?.abort();
      // Saved covers are copied by the save pipeline, so the cache files can go.
      for (const uri of files.current) discard(uri);
    },
    [discard],
  );

  return {
    state,
    /** Improves `image` (the original photo) with these normalized corners. */
    start(image: LocalImage, corners: Quad) {
      run.current?.abort();
      const controller = new AbortController();
      run.current = controller;
      dispatch({ type: 'start', corners });
      enhancer.enhance(image, corners, { signal: controller.signal }).then(
        (result) => {
          if (run.current !== controller) {
            discard(result.uri);
            return;
          }
          run.current = null;
          files.current.push(result.uri);
          dropFiles(result.uri);
          dispatch({ type: 'succeeded', image: result });
        },
        () => {
          if (run.current !== controller) return;
          run.current = null;
          dropFiles(null);
          dispatch({ type: 'failed' });
        },
      );
    },
    select(version: CoverVersion) {
      dispatch({ type: 'select', version });
    },
    cancel() {
      if (!run.current) return;
      run.current.abort();
      run.current = null;
      dispatch({ type: 'cancelled' });
    },
    /** A different image (or none): forget the improvement. */
    reset() {
      run.current?.abort();
      run.current = null;
      dropFiles(null);
      dispatch({ type: 'reset' });
    },
  };
}

export type CoverEnhancement = ReturnType<typeof useCoverEnhancement>;
