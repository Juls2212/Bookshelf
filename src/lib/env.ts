type Env = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

export class EnvConfigError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    // Only variable NAMES are included, never their values.
    super(`Missing or invalid environment variables: ${variables.join(', ')}`);
    this.name = 'EnvConfigError';
    this.variables = variables;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function getEnv(): Env {
  // Referenced literally so Expo can inline them at build time.
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

  const invalid: string[] = [];
  if (!isHttpsUrl(supabaseUrl)) invalid.push('EXPO_PUBLIC_SUPABASE_URL');
  if (supabasePublishableKey.length === 0) invalid.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (invalid.length > 0) throw new EnvConfigError(invalid);

  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), supabasePublishableKey };
}
