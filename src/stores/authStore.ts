import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import * as authService from '@/features/auth/authService';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

type AuthState = {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  /** Restores the stored session and subscribes to auth changes. Safe to call twice. */
  initialize: () => Promise<void>;
  signOut: () => Promise<authService.AuthResult>;
};

const signedOutState = { status: 'signedOut', session: null, user: null } as const;

function signedInState(session: Session) {
  return { status: 'signedIn', session, user: session.user } as const;
}

let initializing: Promise<void> | null = null;
let unsubscribe: (() => void) | null = null;

export const useAuthStore = create<AuthState>()((set) => ({
  status: 'loading',
  session: null,
  user: null,

  initialize: () => {
    if (!initializing) {
      initializing = (async () => {
        const { session } = await authService.restoreSession();
        set(session ? signedInState(session) : signedOutState);

        unsubscribe = authService.onAuthStateChange((event, next) => {
          if (event === 'SIGNED_OUT') {
            set(signedOutState);
          } else if (next) {
            set(signedInState(next));
          }
          // Any other event without a session (e.g. a token refresh that failed because the
          // device is offline) keeps the current state: only SIGNED_OUT ends the session.
        });
      })();
    }
    return initializing;
  },

  signOut: async () => {
    const result = await authService.signOut();
    if (result.ok) set(signedOutState);
    return result;
  },
}));

/** Test/dev helper: drops the subscription and returns the store to its initial state. */
export function resetAuthStore(): void {
  unsubscribe?.();
  unsubscribe = null;
  initializing = null;
  useAuthStore.setState({ status: 'loading', session: null, user: null });
}
