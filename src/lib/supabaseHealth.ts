import { EnvConfigError, getEnv, type Env } from './env';

export type HealthErrorCode =
  'missing_env' | 'network_error' | 'timeout' | 'unauthorized' | 'unexpected_status';

export type HealthResult = { status: 'ok' } | { status: 'error'; code: HealthErrorCode };

// Pings the public Auth settings endpoint. Never logs the key.
export async function checkSupabaseHealth(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<HealthResult> {
  let env: Env;
  try {
    env = getEnv();
  } catch (error) {
    if (error instanceof EnvConfigError) return { status: 'error', code: 'missing_env' };
    throw error;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(`${env.supabaseUrl}/auth/v1/settings`, {
      method: 'GET',
      headers: { apikey: env.supabasePublishableKey },
      signal: controller.signal,
    });
    if (response.ok) return { status: 'ok' };
    if (response.status === 401 || response.status === 403) {
      return { status: 'error', code: 'unauthorized' };
    }
    return { status: 'error', code: 'unexpected_status' };
  } catch {
    return { status: 'error', code: timedOut ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}
