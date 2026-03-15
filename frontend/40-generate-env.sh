#!/bin/sh
set -eu

cat <<EOF >/usr/share/nginx/html/env.js
window.__EVARA_CONFIG__ = {
  API_BASE_URL: "${API_BASE_URL:-/api}"
};
EOF
