import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/types/database';

import { getEnv } from './env';
import { secureStorage } from './secureStorage';

/** Fixed key so the stored session can be read back while offline. */
export const AUTH_STORAGE_KEY = 'bookshelf.auth';

export type AppSupabaseClient = SupabaseClient<Database>;

let client: AppSupabaseClient | null = null;

// Official Supabase React Native guidance: refresh tokens only while the app is in the
// foreground, so a backgrounded app does not keep timers or network calls running.
function wireAutoRefresh(instance: AppSupabaseClient): void {
  if (Platform.OS === 'web') return;
  if (AppState.currentState === 'active') instance.auth.startAutoRefresh();
  AppState.addEventListener('change', (state) => {
    if (state === 'active') instance.auth.startAutoRefresh();
    else instance.auth.stopAutoRefresh();
  });
}

// Lazy singleton: nothing is created or validated at import time.
export function getSupabaseClient(): AppSupabaseClient {
  if (client) return client;
  const { supabaseUrl, supabasePublishableKey } = getEnv();
  client = createClient<Database>(supabaseUrl, supabasePublishableKey, {
    auth: {
      storage: secureStorage,
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
  });
  wireAutoRefresh(client);
  return client;
}
