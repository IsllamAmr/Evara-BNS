(function applyRuntimeConfigFallback() {
  const existing = window.__EVARA_CONFIG__ || {};

  function resolveValue(value, fallback) {
    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized || fallback;
    }

    return value ?? fallback;
  }

  window.__EVARA_CONFIG__ = {
    API_BASE_URL: resolveValue(existing.API_BASE_URL, '/api'),
    SUPABASE_URL: resolveValue(existing.SUPABASE_URL, ''),
    SUPABASE_ANON_KEY: resolveValue(existing.SUPABASE_ANON_KEY, ''),
    APP_URL: resolveValue(existing.APP_URL, window.location.origin),
  };
})();
