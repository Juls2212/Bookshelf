// Auth service: the only module that talks to Supabase Auth.
// Returns typed results, never throws raw Supabase errors, never logs credentials or tokens.
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

import { AUTH_STORAGE_KEY, getSupabaseClient } from '@/lib/supabase';
import { secureStorage } from '@/lib/secureStorage';

import { mapAuthError, type AuthErrorCode } from './authErrors';
import { cleanDisplayName, normalizeEmail } from './validation';

export type AuthResult<T = null> = { ok: true; data: T } | { ok: false; error: AuthErrorCode };

type SignUpInput = { displayName: string; email: string; password: string };
type SignInInput = { email: string; password: string };

/** Max wait for the startup session check before falling back to the stored session. */
const RESTORE_TIMEOUT_MS = 8000;

const ok = <T>(data: T): AuthResult<T> => ({ ok: true, data });
const fail = (error: unknown): AuthResult<never> => ({ ok: false, error: mapAuthError(error) });

function isSession(value: unknown): value is Session {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<Session>;
  return (
    typeof v.access_token === 'string' &&
    typeof v.refresh_token === 'string' &&
    typeof v.user === 'object' &&
    v.user !== null
  );
}

/** Reads the persisted session without touching the network. */
async function readStoredSession(): Promise<Session | null> {
  try {
    const raw = await secureStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Restores the session at startup. If the access token expired and the refresh fails because
 * there is no network, supabase-js keeps the stored session but returns none; in that case we
 * fall back to the stored copy so the user stays signed in offline.
 */
export async function restoreSession(
  timeoutMs = RESTORE_TIMEOUT_MS,
): Promise<{ session: Session | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const result = await Promise.race([getSupabaseClient().auth.getSession(), timeout]);
    // A very slow network must not keep the splash screen up: use the stored copy.
    if (result === 'timeout') return { session: await readStoredSession() };
    const { data, error } = result;
    if (data.session) return { session: data.session };
    if (error && mapAuthError(error) === 'network_error') {
      return { session: await readStoredSession() };
    }
    return { session: null };
  } catch (error) {
    // Missing env or an unexpected failure: keep an offline session if one exists.
    return { session: mapAuthError(error) === 'network_error' ? await readStoredSession() : null };
  } finally {
    clearTimeout(timer);
  }
}

export function onAuthStateChange(
  listener: (event: AuthChangeEvent, session: Session | null) => void,
): () => void {
  try {
    const { data } = getSupabaseClient().auth.onAuthStateChange(listener);
    return () => data.subscription.unsubscribe();
  } catch {
    return () => {};
  }
}

export async function signUp(input: SignUpInput): Promise<AuthResult<{ sessionCreated: boolean }>> {
  try {
    const { data, error } = await getSupabaseClient().auth.signUp({
      email: normalizeEmail(input.email),
      password: input.password,
      options: { data: { display_name: cleanDisplayName(input.displayName) } },
    });
    if (error) return fail(error);
    // With email confirmation on, an existing address returns a user without identities.
    if (data.user && data.user.identities?.length === 0) return { ok: false, error: 'email_taken' };
    return ok({ sessionCreated: data.session !== null });
  } catch (error) {
    return fail(error);
  }
}

export async function signIn(input: SignInInput): Promise<AuthResult> {
  try {
    const { error } = await getSupabaseClient().auth.signInWithPassword({
      email: normalizeEmail(input.email),
      password: input.password,
    });
    return error ? fail(error) : ok(null);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Signs out of this device. If the server cannot be reached the local session is removed
 * anyway, so signing out always works offline.
 */
export async function signOut(): Promise<AuthResult> {
  try {
    const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
    if (!error) return ok(null);
    if (mapAuthError(error) !== 'network_error') return fail(error);
  } catch (error) {
    if (mapAuthError(error) !== 'network_error') return fail(error);
  }
  try {
    await secureStorage.removeItem(AUTH_STORAGE_KEY);
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  try {
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(normalizeEmail(email));
    return error ? fail(error) : ok(null);
  } catch (error) {
    return fail(error);
  }
}
