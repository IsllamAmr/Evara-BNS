const { createScopedClient, getSupabaseAdmin } = require('../config/supabase');
const crypto = require('crypto');
const { sendError } = require('../utils/responseHelper');

// Every API call used to make two sequential Supabase round trips (verify token, load
// profile) before any real work. The result is reused for a short window per token.
// Trade-off: a deactivation or role change takes up to AUTH_CACHE_TTL_MS to apply.
const AUTH_CACHE_TTL_MS = 30 * 1000;
const AUTH_CACHE_MAX_ENTRIES = 500;
const authCache = new Map();

function authCacheKey(token) {
  return crypto.createHash('sha256').update(token).digest('base64url');
}

function readAuthCache(key) {
  const hit = authCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    authCache.delete(key);
    return null;
  }
  return hit;
}

function writeAuthCache(key, authUser, profile, token) {
  // Never outlive the token itself.
  let tokenExpiresAt = Infinity;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (payload?.exp) tokenExpiresAt = payload.exp * 1000;
  } catch (_error) {
    // Opaque token: the TTL alone bounds it.
  }
  if (authCache.size >= AUTH_CACHE_MAX_ENTRIES) {
    authCache.delete(authCache.keys().next().value);
  }
  authCache.set(key, { authUser, profile, expiresAt: Math.min(Date.now() + AUTH_CACHE_TTL_MS, tokenExpiresAt) });
}

function clearAuthCache() {
  authCache.clear();
}

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

    const cacheKey = authCacheKey(token);
    const cached = readAuthCache(cacheKey);
    if (cached) {
      req.accessToken = token;
      req.authUser = cached.authUser;
      req.profile = cached.profile;
      req.user = cached.profile;
      req.supabase = createScopedClient(token);
      return next();
    }

    const supabaseAdmin = getSupabaseAdmin();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !authUser) {
      if (required) {
        // Classify error types for better debugging
        const isServerError = authError?.status >= 500;
        const errorMessage = isServerError
          ? 'Authentication service temporarily unavailable'
          : 'Invalid or expired session';
        const statusCode = isServerError ? 503 : 401;
        return sendError(res, errorMessage, statusCode);
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

    // Check if user account is active
    if (!profile.is_active) {
      if (required) {
        return sendError(res, 'Your account has been deactivated', 401);
      }

      return next();
    }

    writeAuthCache(cacheKey, authUser, profile, token);
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
  clearAuthCache,
  optionalAuth,
  protect,
};

