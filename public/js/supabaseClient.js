import { PUBLIC_RUNTIME_DEFAULTS } from './runtimeDefaults.js';

function resolveConfigValue(value, fallback) {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || fallback;
  }

  return value ?? fallback;
}

function resolveApiBaseUrl(value, fallback) {
  const normalized = resolveConfigValue(value, fallback);
  if (typeof normalized !== 'string') {
    return fallback;
  }

  const trimmed = normalized.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.hostname.endsWith('.supabase.co')) {
      return fallback;
    }
  } catch (_error) {
    return fallback;
  }

  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

const injectedConfig = window.__EVARA_CONFIG__ || {};
const runtimeConfig = {
  API_BASE_URL: resolveApiBaseUrl(injectedConfig.API_BASE_URL, PUBLIC_RUNTIME_DEFAULTS.API_BASE_URL),
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
