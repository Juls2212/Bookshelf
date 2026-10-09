import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getEnv } from './env';

let client: SupabaseClient | null = null;

// Lazy singleton: nothing is created or validated at import time.
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const { supabaseUrl, supabasePublishableKey } = getEnv();
  client = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      // Phase 2 configures secure session storage and enables persistence/refresh.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return client;
}
