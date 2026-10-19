// Edge Function `discover-book` ("Nuevas aventuras"): suggests ONE real book that is NOT on the
// user's shelf, based on a chosen book or on the user's best-rated books and preferences.
// JWT verification stays on (Supabase default). Every read and the insert use a client scoped
// to the caller's token, so RLS applies; the service role is used only for the ai_usage rate
// limit. The suggestion is checked (best effort) against the Open Library search API. Logs
// contain only error codes (never titles, context, tokens or keys).
import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  applyVerification,
  buildDiscoverPayload,
  buildDiscoverRequest,
  DISCOVER_ERROR_STATUS,
  DISCOVER_FUNCTION_NAME,
  DISCOVER_LIMITS,
  DISCOVER_TIMEOUT_MS,
  discoverErrorBody,
  discoveryContextRecord,
  isExcludedSuggestion,
  LIBRARY_CAP,
  OPEN_LIBRARY_TIMEOUT_MS,
  openLibrarySearchUrl,
  parseDiscoverRequest,
  READING_CAP,
  RECENT_CAP,
  TASTE_CAP,
  validateDiscovery,
  verificationFrom,
  type DiscoverErrorCode,
  type Discovery,
  type TitleAuthor,
  type Verification,
} from '../_shared/discoverBook.ts';
import { extractModelOutput, isRateLimited, usageWindows } from '../_shared/identifyBook.ts';
import { preferencesOrDefault } from '../_shared/recommendBook.ts';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
/** One retry when the model suggests a book the user already has (or already got). */
const MODEL_ATTEMPTS = 2;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Logs only the code (never titles, context, tokens or keys). */
function fail(code: DiscoverErrorCode, reason?: string): Response {
  console.error(`[${DISCOVER_FUNCTION_NAME}] ${reason ? `${code} (${reason})` : code}`);
  return json(DISCOVER_ERROR_STATUS[code], discoverErrorBody(code));
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

/** Best effort: any failure (timeout, network, bad JSON) only means "not verified". */
async function verifyInOpenLibrary(suggestion: TitleAuthor): Promise<Verification> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPEN_LIBRARY_TIMEOUT_MS);
  try {
    const response = await fetch(openLibrarySearchUrl(suggestion), {
      headers: { Accept: 'application/json', 'User-Agent': 'Bookshelf-App/1.0 (reading app)' },
      signal: controller.signal,
    });
    if (!response.ok) return { verified: false, pageCount: null };
    return verificationFrom(await response.json(), suggestion);
  } catch {
    return { verified: false, pageCount: null };
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

  // 1. Authenticated user; this client carries the caller's token, so RLS scopes every query.
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return fail('unauthorized');
  const user = createClient(supabaseUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await user.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) return fail('unauthorized');

  // 2. Request body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('invalid_request', 'json');
  }
  const parsed = parseDiscoverRequest(body);
  if (!parsed.ok) return fail(parsed.error);
  const request = parsed.value;

  // 3. Rate limit per user and function (service role: ai_usage has no client policies).
  const admin = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { hourAgo, dayAgo } = usageWindows(new Date());
  const countSince = (since: string) =>
    admin
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('function_name', DISCOVER_FUNCTION_NAME)
      .gte('created_at', since);
  const [hour, day] = await Promise.all([countSince(hourAgo), countSince(dayAgo)]);
  if (hour.error || day.error) return fail('upstream_error', 'usage_count');
  if (isRateLimited({ lastHour: hour.count ?? 0, lastDay: day.count ?? 0 }, DISCOVER_LIMITS)) {
    return fail('rate_limited');
  }

  // 4. The user's own data, under RLS. Only the columns the logic needs are read.
  const [prefsResult, tasteResult, readingResult, libraryResult, recentResult, seedResult] =
    await Promise.all([
      user
        .from('reading_preferences')
        .select('favorite_genres, prioritize_unread, consider_mood, prefer_short_weekdays')
        .eq('user_id', userId)
        .maybeSingle(),
      user
        .from('user_books')
        .select('title, author, genre, rating')
        .is('deleted_at', null)
        .eq('reading_status', 'finished')
        .not('rating', 'is', null)
        .order('rating', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(TASTE_CAP),
      user
        .from('user_books')
        .select('title, author, genre')
        .is('deleted_at', null)
        .eq('reading_status', 'reading')
        .limit(READING_CAP),
      // Used only to reject books the user already has; never sent to the model.
      user.from('user_books').select('title, author').is('deleted_at', null).limit(LIBRARY_CAP),
      user
        .from('recommendations')
        .select('suggested_title, suggested_author')
        .eq('kind', 'discovery')
        .order('created_at', { ascending: false })
        .limit(RECENT_CAP),
      request.seedBookId
        ? user
            .from('user_books')
            .select('title, author, genre, page_count, rating')
            .eq('id', request.seedBookId)
            .is('deleted_at', null)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  if (
    prefsResult.error ||
    tasteResult.error ||
    readingResult.error ||
    libraryResult.error ||
    recentResult.error ||
    seedResult.error
  ) {
    return fail('upstream_error', 'read_data');
  }
  if (request.seedBookId && !seedResult.data) return fail('invalid_request', 'seed');

  const preferences = preferencesOrDefault(prefsResult.data);
  const library: TitleAuthor[] = (libraryResult.data ?? []).map((b) => ({
    title: b.title,
    author: b.author,
  }));
  const recent: TitleAuthor[] = (recentResult.data ?? [])
    .filter((r) => typeof r.suggested_title === 'string')
    .map((r) => ({ title: r.suggested_title as string, author: r.suggested_author }));
  const excluded = [...recent, ...request.excludeSuggestions];
  const payload = buildDiscoverPayload({
    seed: seedResult.data,
    taste: tasteResult.data ?? [],
    reading: readingResult.data ?? [],
    recent,
    preferences,
    request,
  });

  // 5. Record the call, then ask OpenAI (one retry for a book the user has), 25 s in total.
  const recorded = await admin
    .from('ai_usage')
    .insert({ user_id: userId, function_name: DISCOVER_FUNCTION_NAME });
  if (recorded.error) return fail('upstream_error', 'usage_insert');

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  const model = Deno.env.get('OPENAI_MODEL');
  if (!apiKey || !model) return fail('upstream_error', 'missing_config');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVER_TIMEOUT_MS);
  let suggestion: Discovery | null = null;
  let repeated = false;
  try {
    for (let attempt = 0; attempt < MODEL_ATTEMPTS && !suggestion; attempt += 1) {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildDiscoverRequest({ model, payload })),
        signal: controller.signal,
      });
      if (!response.ok) return fail('upstream_error', `openai_${response.status}`);
      const output = extractModelOutput(await response.json());
      if (!output.ok) return fail('upstream_error', 'model_output');
      const candidate = validateDiscovery(output.value);
      if (!candidate) return fail('upstream_error', 'model_shape');
      if (isExcludedSuggestion(candidate, library, excluded)) {
        repeated = true;
        console.error(`[${DISCOVER_FUNCTION_NAME}] retry (already known)`);
        continue;
      }
      suggestion = candidate;
    }
  } catch {
    return controller.signal.aborted ? fail('timeout') : fail('upstream_error', 'openai_fetch');
  } finally {
    clearTimeout(timer);
  }
  if (!suggestion) return fail(repeated ? 'no_new_suggestions' : 'upstream_error');

  // 6. Best-effort catalog check, then store it (kind 'discovery', no book on the shelf).
  const verification = await verifyInOpenLibrary(suggestion);
  const checked = applyVerification(suggestion, verification);
  const inserted = await user
    .from('recommendations')
    .insert({
      user_id: userId,
      kind: 'discovery',
      user_book_id: null,
      suggested_title: checked.title,
      suggested_author: checked.author,
      suggested_genre: checked.genre,
      suggested_page_count: checked.pageCount,
      suggestion_verified: verification.verified,
      rationale: checked.rationale,
      request_context: discoveryContextRecord(request, preferences, checked.confidence),
      disposition: 'suggested',
    })
    .select('id, created_at')
    .single();
  if (inserted.error || !inserted.data) return fail('upstream_error', 'insert');

  return json(200, {
    data: {
      recommendation_id: inserted.data.id,
      title: checked.title,
      author: checked.author,
      genre: checked.genre,
      page_count: checked.pageCount,
      verified: verification.verified,
      confidence: checked.confidence,
      rationale: checked.rationale,
      created_at: inserted.data.created_at,
    },
  });
});
