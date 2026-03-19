#!/bin/sh
set -eu

cat <<EOF >/usr/share/nginx/html/env.js
window.__EVARA_CONFIG__ = Object.assign({}, window.__EVARA_CONFIG__ || {}, {
  API_BASE_URL: "${API_BASE_URL:-/api}",
  SUPABASE_URL: "${SUPABASE_URL:-}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY:-}",
  APP_URL: "${APP_URL:-}"
});
EOF
