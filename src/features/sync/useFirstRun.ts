import { useSyncStore } from '@/stores/syncStore';

import { firstRunState, type FirstRunState } from './syncPresentation';

/** First-run state of the library on this device (see firstRunState). */
export function useFirstRun(hasBooks: boolean): FirstRunState {
  const status = useSyncStore((state) => state.status);
  const initialPullDone = useSyncStore((state) => state.initialPullDone);
  return firstRunState({ status, initialPullDone }, hasBooks);
}
