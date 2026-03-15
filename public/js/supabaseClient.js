const runtimeConfig = window.__EVARA_CONFIG__ || {};

const client = window.supabase && runtimeConfig.SUPABASE_URL && runtimeConfig.SUPABASE_ANON_KEY
  ? window.supabase.createClient(runtimeConfig.SUPABASE_URL, runtimeConfig.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function getAppConfig() {
  return {
    apiBaseUrl: (runtimeConfig.API_BASE_URL || '/api').replace(/\/$/, ''),
    supabaseUrl: runtimeConfig.SUPABASE_URL || '',
    supabaseAnonKey: runtimeConfig.SUPABASE_ANON_KEY || '',
    appUrl: (runtimeConfig.APP_URL || window.location.origin).replace(/\/$/, ''),
  };
}

export function isSupabaseReady() {
  return Boolean(client);
}

export function getSupabase() {
  if (!client) {
    throw new Error('Supabase is not configured for the frontend.');
  }

  return client;
}

