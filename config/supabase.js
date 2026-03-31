const { createClient } = require('@supabase/supabase-js');

function resolveConfigValue(value) {
  return (value || '').trim();
}

const supabaseUrl = resolveConfigValue(process.env.SUPABASE_URL);
const supabaseAnonKey = resolveConfigValue(process.env.SUPABASE_ANON_KEY);
const supabaseServiceRoleKey = resolveConfigValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

function missingSupabaseEnvKeys({ requireServiceRole = true } = {}) {
  const missing = [];

  if (!supabaseUrl) {
    missing.push('SUPABASE_URL');
  }
  if (!supabaseAnonKey) {
    missing.push('SUPABASE_ANON_KEY');
  }
  if (requireServiceRole && !supabaseServiceRoleKey) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }

  return missing;
}

function isSupabaseConfigured() {
  return missingSupabaseEnvKeys().length === 0;
}

function assertSupabaseConfigured() {
  const missingKeys = missingSupabaseEnvKeys();
  if (missingKeys.length) {
    throw new Error(
      `Supabase is not fully configured. Missing environment variables: ${missingKeys.join(', ')}.`
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
      timeout: 30000, // 30 second timeout
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
  missingSupabaseEnvKeys,
  supabaseAnonKey,
  supabaseServiceRoleKey,
  supabaseUrl,
};
