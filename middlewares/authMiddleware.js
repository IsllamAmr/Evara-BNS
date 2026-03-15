const { createScopedClient, getSupabaseAdmin } = require('../config/supabase');
const { sendError } = require('../utils/responseHelper');

function extractToken(req) {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }

  return null;
}

async function attachUserFromToken(req, res, next, required) {
  try {
    const token = extractToken(req);

    if (!token) {
      if (required) {
        return sendError(res, 'Authentication required', 401);
      }

      return next();
    }

    const supabaseAdmin = getSupabaseAdmin();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !authUser) {
      if (required) {
        return sendError(res, 'Invalid or expired session', 401);
      }

      return next();
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (profileError || !profile) {
      if (required) {
        return sendError(res, 'Your profile is missing or inaccessible', 401);
      }

      return next();
    }

    req.accessToken = token;
    req.authUser = authUser;
    req.profile = profile;
    req.user = profile;
    req.supabase = createScopedClient(token);
    return next();
  } catch (error) {
    if (required) {
      return next(error);
    }

    return next();
  }
}

function protect(req, res, next) {
  return attachUserFromToken(req, res, next, true);
}

function optionalAuth(req, res, next) {
  return attachUserFromToken(req, res, next, false);
}

module.exports = {
  optionalAuth,
  protect,
};

