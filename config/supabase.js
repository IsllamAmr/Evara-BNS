const { createClient } = require('@supabase/supabase-js');

const DEFAULT_SUPABASE_URL = 'https://qgvuustfnojlpqrtakof.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_l4n8UA1-0zhQkpysgu6rkA_iH7-QQFD';

function resolvePublicValue(value, fallback) {
  return (value || '').trim() || fallback;
}

const supabaseUrl = resolvePublicValue(process.env.SUPABASE_URL, DEFAULT_SUPABASE_URL);
const supabaseAnonKey = resolvePublicValue(process.env.SUPABASE_ANON_KEY, DEFAULT_SUPABASE_ANON_KEY);
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey && supabaseServiceRoleKey);
}

function assertSupabaseConfigured() {
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error(
      'Supabase is not fully configured. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
}

function createClientOptions(extraHeaders = {}) {
  return {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: extraHeaders,
    },
  };
}

function getSupabaseAdmin() {
  assertSupabaseConfigured();

  return createClient(
    supabaseUrl,
    supabaseServiceRoleKey,
    createClientOptions()
  );
}

function createScopedClient(accessToken) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase public client is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  }

  const headers = accessToken
    ? {
        Authorization: `Bearer ${accessToken}`,
      }
    : {};

  return createClient(supabaseUrl, supabaseAnonKey, createClientOptions(headers));
}

module.exports = {
  createScopedClient,
  getSupabaseAdmin,
  isSupabaseConfigured,
  supabaseAnonKey,
  supabaseServiceRoleKey,
  supabaseUrl,
};

