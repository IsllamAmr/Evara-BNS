const { getSupabaseAdmin, isSupabaseConfigured } = require('../config/supabase');

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

async function bootstrapInitialAdmin() {
  const email = normalizeEmail(process.env.INITIAL_ADMIN_EMAIL);
  const password = process.env.INITIAL_ADMIN_PASSWORD || '';
  const fullName = (process.env.INITIAL_ADMIN_FULL_NAME || 'System Admin').trim();

  if (!isSupabaseConfigured() || !email || !password) {
    return { skipped: true };
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: existingProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (existingProfile) {
    return { skipped: true, reason: 'already-exists' };
  }

  const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role: 'admin',
      status: 'active',
      is_active: true,
    },
  });

  if (createError) {
    throw createError;
  }

  const userId = createdUser?.user?.id;
  if (!userId) {
    return { skipped: true, reason: 'missing-user-id' };
  }

  const { error: profileUpsertError } = await supabaseAdmin.from('profiles').upsert(
    {
      id: userId,
      full_name: fullName,
      email,
      role: 'admin',
      is_active: true,
      status: 'active',
    },
    { onConflict: 'id' }
  );

  if (profileUpsertError) {
    throw profileUpsertError;
  }

  return { created: true, email };
}

module.exports = {
  bootstrapInitialAdmin,
};

