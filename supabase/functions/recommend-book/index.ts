// Edge Function `recommend-book`: picks the next book from the user's own "to read" shelf with
// OpenAI and stores it in `recommendations`. JWT verification stays on (Supabase default).
// Every read and the insert use a client scoped to the caller's token, so RLS applies; the
// service role is used only for the ai_usage rate limit. The OpenAI key and model are Supabase
// secrets; they are never returned or logged. Logs contain only error codes (never titles,
// context, tokens or keys).
import { createClient } from 'npm:@supabase/supabase-js@2';

import { extractModelOutput, isRateLimited, usageWindows } from '../_shared/identifyBook.ts';
import {
  buildModelPayload,
  buildRecommendRequest,
  CANDIDATE_CAP,
  EXCLUDE_MAX,
  parseRecommendRequest,
  preferencesOrDefault,
  RECENT_CAP,
  RECOMMEND_ERROR_STATUS,
  RECOMMEND_FUNCTION_NAME,
  RECOMMEND_LIMITS,
  RECOMMEND_TIMEOUT_MS,
  recommendErrorBody,
  requestContextRecord,
  selectCandidates,
  selectTaste,
  TASTE_CAP,
  validateRecommendation,
  type RecommendErrorCode,
  type ValidatedRecommendation,
} from '../_shared/recommendBook.ts';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
/** One retry when the model answers with an id that is not a candidate. */
const MODEL_ATTEMPTS = 2;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Logs only the code (never titles, context, tokens or keys). */
function fail(code: RecommendErrorCode, reason?: string): Response {
  console.error(`[${RECOMMEND_FUNCTION_NAME}] ${reason ? `${code} (${reason})` : code}`);
  return json(RECOMMEND_ERROR_STATUS[code], recommendErrorBody(code));
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
  const parsed = parseRecommendRequest(body);
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
      .eq('function_name', RECOMMEND_FUNCTION_NAME)
      .gte('created_at', since);
  const [hour, day] = await Promise.all([countSince(hourAgo), countSince(dayAgo)]);
  if (hour.error || day.error) return fail('upstream_error', 'usage_count');
  if (isRateLimited({ lastHour: hour.count ?? 0, lastDay: day.count ?? 0 }, RECOMMEND_LIMITS)) {
    return fail('rate_limited');
  }

  // 4. The user's own data, under RLS. Only the columns the logic needs are read.
  let candidatesQuery = user
    .from('user_books')
    .select('id, title, author, genre, page_count, created_at')
    .is('deleted_at', null)
    .eq('reading_status', 'to_read')
    .is('lent_to', null)
    .order('created_at', { ascending: true })
    // Room for reordering recently skipped books before the cap.
    .limit(CANDIDATE_CAP + EXCLUDE_MAX);
  if (request.excludeBookIds.length > 0) {
    // Validated UUIDs only, so the list is safe to inline.
    candidatesQuery = candidatesQuery.not('id', 'in', `(${request.excludeBookIds.join(',')})`);
  }
  const [prefsResult, candidatesResult, tasteResult, recentResult] = await Promise.all([
    user
      .from('reading_preferences')
      .select('favorite_genres, prioritize_unread, consider_mood, prefer_short_weekdays')
      .eq('user_id', userId)
      .maybeSingle(),
    candidatesQuery,
    user
      .from('user_books')
      .select('title, author, genre, rating')
      .is('deleted_at', null)
      .eq('reading_status', 'finished')
      .not('rating', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(TASTE_CAP),
    user
      .from('recommendations')
      .select('user_book_id, disposition')
      .order('created_at', { ascending: false })
      .limit(RECENT_CAP),
  ]);
  if (prefsResult.error || candidatesResult.error || tasteResult.error || recentResult.error) {
    return fail('upstream_error', 'read_data');
  }
  const preferences = preferencesOrDefault(prefsResult.data);
  const recent = recentResult.data ?? [];
  const candidates = selectCandidates(candidatesResult.data ?? [], request.excludeBookIds, recent);
  if (candidates.length === 0) return fail('no_candidates');
  const payload = buildModelPayload({
    candidates,
    taste: selectTaste(tasteResult.data ?? []),
    recent,
    preferences,
    request,
    now: new Date(),
  });
  const candidateIds = candidates.map((c) => c.id);

  // 5. Record the call, then ask OpenAI (one retry for an invalid choice), 25 s in total.
  const recorded = await admin
    .from('ai_usage')
    .insert({ user_id: userId, function_name: RECOMMEND_FUNCTION_NAME });
  if (recorded.error) return fail('upstream_error', 'usage_insert');

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  const model = Deno.env.get('OPENAI_MODEL');
  if (!apiKey || !model) return fail('upstream_error', 'missing_config');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECOMMEND_TIMEOUT_MS);
  let choice: ValidatedRecommendation | null = null;
  try {
    for (let attempt = 0; attempt < MODEL_ATTEMPTS && !choice; attempt += 1) {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRecommendRequest({ model, payload })),
        signal: controller.signal,
      });
      if (!response.ok) return fail('upstream_error', `openai_${response.status}`);
      const output = extractModelOutput(await response.json());
      if (!output.ok) return fail('upstream_error', 'model_output');
      const validated = validateRecommendation(output.value, candidateIds);
      if (validated.ok) choice = validated.value;
      else console.error(`[${RECOMMEND_FUNCTION_NAME}] retry (${validated.error})`);
    }
  } catch {
    return controller.signal.aborted ? fail('timeout') : fail('upstream_error', 'openai_fetch');
  } finally {
    clearTimeout(timer);
  }
  if (!choice) return fail('upstream_error', 'invalid_choice');

  // 6. Store it (RLS: the composite key only accepts a book of the same user).
  const inserted = await user
    .from('recommendations')
    .insert({
      user_id: userId,
      user_book_id: choice.bookId,
      rationale: choice.rationale,
      request_context: requestContextRecord(request, preferences),
      disposition: 'suggested',
    })
    .select('id, user_book_id, rationale, created_at')
    .single();
  if (inserted.error || !inserted.data) return fail('upstream_error', 'insert');

  return json(200, {
    data: {
      recommendation_id: inserted.data.id,
      book_id: inserted.data.user_book_id,
      rationale: inserted.data.rationale,
      created_at: inserted.data.created_at,
    },
  });
});
