// Classification of remote failures for the sync engine, and the retry schedule.
// Codes are English and safe to log (never messages, URLs or data).

export type SyncErrorCode =
  | 'network_error'
  | 'timeout'
  | 'server_error'
  | 'rate_limited'
  | 'auth_expired'
  | 'forbidden'
  | 'validation_failed'
  | 'constraint_failed'
  | 'invalid_cover'
  | 'unknown';

export type ClassifiedError = { code: SyncErrorCode; retryable: boolean };

/** Raw failure as reported by Supabase (PostgREST/Storage/Auth) or fetch. */
export type RemoteCause = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

const RETRYABLE: Record<SyncErrorCode, boolean> = {
  network_error: true,
  timeout: true,
  server_error: true,
  rate_limited: true,
  auth_expired: true,
  forbidden: false,
  validation_failed: false,
  constraint_failed: false,
  invalid_cover: false,
  unknown: true,
};

const classified = (code: SyncErrorCode): ClassifiedError => ({ code, retryable: RETRYABLE[code] });

/**
 * Retryable: network, timeout, 5xx, 429 and expired JWT (after one session refresh).
 * Permanent: RLS/403, other 4xx (validation, constraints) and broken local covers.
 * Unknown failures are retried with backoff (never lose a change by guessing "permanent").
 */
export function classifyRemoteError(cause: unknown): ClassifiedError {
  if (cause === null || typeof cause !== 'object') return classified('unknown');
  const e = cause as RemoteCause;
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  const status = Number(e.status ?? e.statusCode);

  if (code === 'empty_file' || code === 'empty_object' || code === 'missing_file') {
    return classified('invalid_cover');
  }
  if (e.name === 'TimeoutError' || code === 'timeout') return classified('timeout');
  if (
    e.name === 'AbortError' ||
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('network error')
  ) {
    return classified('network_error');
  }
  // RLS violations can arrive with HTTP 401; they are permanent, not an expired session.
  if (code === '42501') return classified('forbidden');
  if (
    code === 'PGRST301' ||
    code === 'PGRST302' ||
    message.includes('jwt expired') ||
    status === 401
  ) {
    return classified('auth_expired');
  }
  if (status === 429) return classified('rate_limited');
  if (status >= 500 && status < 600) return classified('server_error');
  if (status === 403) return classified('forbidden');
  if (code === '23505' || status === 409) return classified('constraint_failed');
  if (/^(22|23)/.test(code) || code.startsWith('PGRST') || (status >= 400 && status < 500)) {
    return classified('validation_failed');
  }
  return classified('unknown');
}

export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 15 * 60_000;

/**
 * Exponential backoff with jitter: base * 2^(attempts-1), capped, then scaled by a random
 * factor in [0.5, 1) so many devices do not retry in lockstep.
 */
export function backoffDelayMs(attempts: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attempts - 1);
  const capped = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
  return Math.round(capped * (0.5 + random() * 0.5));
}
