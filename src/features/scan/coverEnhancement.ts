// "Original | Mejorada": the pure state machine of the cover improvement in the book form, and
// which image is saved. The original (with its crop) is always available, so a failed or
// cancelled improvement never blocks saving.
import type { LocalImage } from '@/features/library/coverService';

import type { Quad } from './coverGeometry';

export type CoverVersion = 'original' | 'enhanced';

type EnhancementState = {
  /** idle: never run; processing: running; ready: an improved cover exists; failed: last run failed. */
  status: 'idle' | 'processing' | 'ready' | 'failed';
  /** Corners of the last run (the corner editor starts from them). */
  corners: Quad | null;
  enhanced: LocalImage | null;
  selected: CoverVersion;
};

type EnhancementEvent =
  | { type: 'start'; corners: Quad }
  | { type: 'succeeded'; image: LocalImage }
  | { type: 'failed' }
  | { type: 'cancelled' }
  | { type: 'select'; version: CoverVersion }
  | { type: 'reset' };

export const initialEnhancement: EnhancementState = {
  status: 'idle',
  corners: null,
  enhanced: null,
  selected: 'original',
};

export function enhancementReducer(
  state: EnhancementState,
  event: EnhancementEvent,
): EnhancementState {
  switch (event.type) {
    case 'start':
      // The current choice stays visible while the new version is made.
      return { ...state, status: 'processing', corners: event.corners };
    case 'succeeded':
      // Default to the improved cover when it worked.
      return { ...state, status: 'ready', enhanced: event.image, selected: 'enhanced' };
    case 'failed':
      // Quietly back to the plain crop (no error noise).
      return { ...state, status: 'failed', enhanced: null, selected: 'original' };
    case 'cancelled':
      return { ...state, status: state.enhanced ? 'ready' : 'idle' };
    case 'select':
      if (event.version === 'enhanced' && !state.enhanced) return state;
      return { ...state, selected: event.version };
    case 'reset':
      return initialEnhancement;
  }
}

/** The image that goes to the (unchanged) save pipeline. */
export function coverToSave(state: EnhancementState, original: LocalImage): LocalImage {
  return state.selected === 'enhanced' && state.enhanced ? state.enhanced : original;
}
