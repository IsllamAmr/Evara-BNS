const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
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

