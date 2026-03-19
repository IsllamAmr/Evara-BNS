import { PUBLIC_RUNTIME_DEFAULTS } from './runtimeDefaults.js';

function resolveConfigValue(value, fallback) {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || fallback;
  }

  return value ?? fallback;
}

const injectedConfig = window.__EVARA_CONFIG__ || {};
const runtimeConfig = {
  API_BASE_URL: resolveConfigValue(injectedConfig.API_BASE_URL, PUBLIC_RUNTIME_DEFAULTS.API_BASE_URL),
  SUPABASE_URL: resolveConfigValue(injectedConfig.SUPABASE_URL, PUBLIC_RUNTIME_DEFAULTS.SUPABASE_URL),
  SUPABASE_ANON_KEY: resolveConfigValue(injectedConfig.SUPABASE_ANON_KEY, PUBLIC_RUNTIME_DEFAULTS.SUPABASE_ANON_KEY),
  APP_URL: resolveConfigValue(injectedConfig.APP_URL, PUBLIC_RUNTIME_DEFAULTS.APP_URL || window.location.origin),
};

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
    apiBaseUrl: runtimeConfig.API_BASE_URL.replace(/\/$/, ''),
    supabaseUrl: runtimeConfig.SUPABASE_URL || '',
    supabaseAnonKey: runtimeConfig.SUPABASE_ANON_KEY || '',
    appUrl: runtimeConfig.APP_URL.replace(/\/$/, ''),
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
