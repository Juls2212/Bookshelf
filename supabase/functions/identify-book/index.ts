// Edge Function `identify-book`: identifies ONE book from a photo with OpenAI vision.
// JWT verification stays on (Supabase default). The OpenAI key and model are Supabase
// secrets; they are never returned or logged. Logs contain only error codes.
import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  buildOpenAIRequest,
  ERROR_STATUS,
  errorBody,
  extractModelOutput,
  FUNCTION_NAME,
  isRateLimited,
  mapIdentification,
  OPENAI_TIMEOUT_MS,
  parseIdentifyRequest,
  sanitizeIdentification,
  usageWindows,
  type ErrorCode,
} from '../_shared/identifyBook.ts';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Logs only the code (never images, titles, tokens or keys). */
function fail(code: ErrorCode, reason?: string): Response {
  console.error(`[${FUNCTION_NAME}] ${reason ? `${code} (${reason})` : code}`);
  return json(ERROR_STATUS[code], errorBody(code));
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

  // 1. Authenticated user, from the caller's own token.
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return fail('unauthorized');
  const authClient = createClient(supabaseUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) return fail('unauthorized');

  // 2. Request body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('invalid_request', 'json');
  }
  const parsed = parseIdentifyRequest(body);
  if (!parsed.ok) return fail(parsed.error);

  // 3. Rate limit per user (service role: the table has no client policies).
  const admin = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { hourAgo, dayAgo } = usageWindows(new Date());
  const countSince = (since: string) =>
    admin
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('function_name', FUNCTION_NAME)
      .gte('created_at', since);
  const [hour, day] = await Promise.all([countSince(hourAgo), countSince(dayAgo)]);
  if (hour.error || day.error) return fail('upstream_error', 'usage_count');
  if (isRateLimited({ lastHour: hour.count ?? 0, lastDay: day.count ?? 0 })) {
    return fail('rate_limited');
  }
  const recorded = await admin
    .from('ai_usage')
    .insert({ user_id: userId, function_name: FUNCTION_NAME });
  if (recorded.error) return fail('upstream_error', 'usage_insert');

  // 4. OpenAI (Responses API, image input, structured output), 25 s timeout.
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  const model = Deno.env.get('OPENAI_MODEL');
  if (!apiKey || !model) return fail('upstream_error', 'missing_config');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  let upstream: unknown;
  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOpenAIRequest({ model, request: parsed.value })),
      signal: controller.signal,
    });
    if (!response.ok) return fail('upstream_error', `openai_${response.status}`);
    upstream = await response.json();
  } catch {
    return controller.signal.aborted ? fail('timeout') : fail('upstream_error', 'openai_fetch');
  } finally {
    clearTimeout(timer);
  }

  // 5. Validate, sanitize and map the model output.
  const output = extractModelOutput(upstream);
  if (!output.ok) return fail('upstream_error', 'model_output');
  const identification = sanitizeIdentification(output.value);
  if (!identification) return fail('upstream_error', 'model_shape');
  const mapped = mapIdentification(identification);
  if (!mapped.ok) return fail(mapped.error);
  return json(200, { data: mapped.value });
});
