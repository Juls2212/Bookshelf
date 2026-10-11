import { t } from '@/i18n';

import type { ValidationErrorCode } from './validation';

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_taken'
  | 'weak_password'
  | 'email_not_confirmed'
  | 'rate_limited'
  | 'network_error'
  | 'unknown';

type ErrorLike = { name?: unknown; status?: unknown; code?: unknown; message?: unknown };

const codeMap: Record<string, AuthErrorCode> = {
  invalid_credentials: 'invalid_credentials',
  email_exists: 'email_taken',
  user_already_exists: 'email_taken',
  weak_password: 'weak_password',
  email_not_confirmed: 'email_not_confirmed',
  over_request_rate_limit: 'rate_limited',
  over_email_send_rate_limit: 'rate_limited',
};

/**
 * Maps Supabase auth errors (AuthApiError, AuthWeakPasswordError, AuthRetryableFetchError...)
 * and plain network failures to internal codes. Duck-typed so it never depends on class
 * identity and never exposes the raw error to the UI.
 */
export function mapAuthError(error: unknown): AuthErrorCode {
  if (error === null || typeof error !== 'object') return 'unknown';
  const e = error as ErrorLike;
  const name = typeof e.name === 'string' ? e.name : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';

  // supabase-js wraps failed fetches (offline, DNS, gateway 502-504) in this error.
  if (name === 'AuthRetryableFetchError') return 'network_error';
  if (name === 'TypeError' && message.includes('network request failed')) return 'network_error';
  if (name === 'AbortError') return 'network_error';

  if (code in codeMap) return codeMap[code];
  if (name === 'AuthWeakPasswordError') return 'weak_password';
  if (status === 429) return 'rate_limited';

  // Older servers send no `code`; fall back to their stable messages.
  if (message.includes('invalid login credentials')) return 'invalid_credentials';
  if (message.includes('already registered')) return 'email_taken';
  if (message.includes('email not confirmed')) return 'email_not_confirmed';

  return 'unknown';
}

export function authErrorMessage(code: AuthErrorCode): string {
  return t.auth.errors[code];
}

export function validationMessage(code: ValidationErrorCode): string {
  return t.auth.validation[code];
}
