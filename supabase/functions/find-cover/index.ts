// Edge Function `find-cover`: up to ten cover images for a typed title (and author, ISBN),
// from public catalogs (Open Library, then Google Books). No AI. JWT verification stays on
// (Supabase default). The optional GOOGLE_BOOKS_API_KEY is a Supabase secret, never returned or
// logged. Logs contain only error codes and, per catalog attempt, a JSON line with the source,
// the attempt name, the HTTP status and the number of candidates (never titles, authors, URLs,
// tokens or keys).
import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  CATALOG_TIMEOUT_MS,
  FIND_COVER_ERROR_STATUS,
  FIND_COVER_FUNCTION_NAME,
  FIND_COVER_LIMITS,
  findCoverErrorBody,
  parseFindCoverRequest,
  SEARCH_BUDGET_MS,
  searchCovers,
  type CatalogAnswer,
  type FindCoverErrorCode,
} from '../_shared/findCover.ts';
import { isRateLimited, usageWindows } from '../_shared/identifyBook.ts';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Logs only the code (never titles, authors, URLs, tokens or keys). */
function fail(code: FindCoverErrorCode, reason?: string): Response {
  console.error(`[${FIND_COVER_FUNCTION_NAME}] ${reason ? `${code} (${reason})` : code}`);
  return json(FIND_COVER_ERROR_STATUS[code], findCoverErrorBody(code));
}

/** First key of a JSON dictionary env var (new API keys), or the legacy variable. */
function projectKey(dictionaryName: string, legacyName: string): string | null {
  const dictionary = Deno.env.get(dictionaryName);
  if (dictionary) {
    try {
      const keys = JSON.parse(dictionary) as Record<string, string>;
      const first = keys.default ?? Object.values(keys)[0];
      if (first) return first;
    } catch {
      // Fall back to the legacy variable.
    }
  }
  return Deno.env.get(legacyName) ?? null;
}

/** One catalog request with its own timeout; status 0 = network error or timeout. */
async function fetchJson(url: string): Promise<CatalogAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Bookshelf-App/1.0 (reading app)' },
      signal: controller.signal,
    });
    if (!response.ok) return { status: response.status, body: null };
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail('invalid_request', 'method');

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publicKey = projectKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const adminKey = projectKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publicKey || !adminKey) return fail('upstream_error', 'project_config');

  // 1. Authenticated user, from the caller's own token (user-scoped client).
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return fail('unauthorized');
  const userClient = createClient(supabaseUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) return fail('unauthorized');

  // 2. Request body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('invalid_request', 'json');
  }
  const parsed = parseFindCoverRequest(body);
  if (!parsed.ok) return fail(parsed.error);

  // 3. Rate limit per user (same ai_usage table as the other functions; service role only).
  const admin = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { hourAgo, dayAgo } = usageWindows(new Date());
  const countSince = (since: string) =>
    admin
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('function_name', FIND_COVER_FUNCTION_NAME)
      .gte('created_at', since);
  const [hour, day] = await Promise.all([countSince(hourAgo), countSince(dayAgo)]);
  if (hour.error || day.error) return fail('upstream_error', 'usage_count');
  if (isRateLimited({ lastHour: hour.count ?? 0, lastDay: day.count ?? 0 }, FIND_COVER_LIMITS)) {
    return fail('rate_limited');
  }
  const recorded = await admin
    .from('ai_usage')
    .insert({ user_id: userId, function_name: FIND_COVER_FUNCTION_NAME });
  if (recorded.error) return fail('upstream_error', 'usage_insert');

  // 4. Catalogs. Nothing found is a normal answer (an empty list).
  const startedAt = Date.now();
  const candidates = await searchCovers(parsed.value, {
    fetchJson,
    googleApiKey: Deno.env.get('GOOGLE_BOOKS_API_KEY') || null,
    budgetLeft: () => Date.now() - startedAt < SEARCH_BUDGET_MS,
    // Diagnostics only: never the title, author, URL or key.
    log: (entry) => console.log(JSON.stringify({ fn: FIND_COVER_FUNCTION_NAME, ...entry })),
  });
  console.log(
    JSON.stringify({
      fn: FIND_COVER_FUNCTION_NAME,
      result: candidates === null ? 'catalogs_failed' : 'ok',
      candidates: candidates?.length ?? 0,
      ms: Date.now() - startedAt,
    }),
  );
  if (candidates === null) return fail('upstream_error', 'catalogs');
  return json(200, { data: { candidates } });
});
