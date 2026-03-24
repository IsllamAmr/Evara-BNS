const { AppError } = require('../middlewares/errorMiddleware');
const { createScopedClient } = require('../config/supabase');

function isInvalidCredentialsError(message) {
  return String(message || '').toLowerCase().includes('invalid login credentials');
}

function isApplicationNotFoundError(message) {
  return String(message || '').toLowerCase().includes('application not found');
}

function throwSupabaseAuthError(error, statusCode = 400) {
  const message = error?.message || 'Supabase auth request failed';
  if (isApplicationNotFoundError(message)) {
    throw new AppError(
      'Supabase auth configuration is invalid. Ensure SUPABASE_URL and keys belong to the same project.',
      500
    );
  }

  throw new AppError(message, statusCode);
}

async function verifyCurrentPassword(email, currentPassword) {
  const verifyClient = createScopedClient();
  const { error } = await verifyClient.auth.signInWithPassword({
    email,
    password: currentPassword,
  });

  if (error) {
    if (isInvalidCredentialsError(error.message)) {
      throw new AppError('Current password is incorrect', 401);
    }
    throwSupabaseAuthError(error, 400);
  }
}

async function changeOwnPassword({ supabase, actorProfile, currentPassword, newPassword }) {
  if (!supabase) {
    throw new AppError('Authenticated Supabase client is required', 500);
  }

  if (!actorProfile?.email) {
    throw new AppError('Unable to resolve your account email', 400);
  }

  const rawCurrentPassword = typeof currentPassword === 'string' ? currentPassword : '';
  const rawNewPassword = typeof newPassword === 'string' ? newPassword : '';

  if (!rawCurrentPassword || !rawNewPassword) {
    throw new AppError('current_password and new_password are required', 422);
  }

  if (rawCurrentPassword === rawNewPassword) {
    throw new AppError('New password must be different from your current password', 422);
  }

  await verifyCurrentPassword(actorProfile.email, rawCurrentPassword);

  const { error: updateError } = await supabase.auth.updateUser({
    password: rawNewPassword,
  });

  if (updateError) {
    throwSupabaseAuthError(updateError, 400);
  }

  return {
    id: actorProfile.id,
    email: actorProfile.email,
    password_changed: true,
  };
}

module.exports = {
  changeOwnPassword,
};
