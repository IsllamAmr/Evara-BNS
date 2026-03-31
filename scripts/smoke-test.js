const DEFAULT_PORT = Number(process.env.PORT) || 5000;
const DEFAULT_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS) || 8000;

function normalizeBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return DEFAULT_BASE_URL;
  }

  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function runCheck(baseUrl, check) {
  const url = `${baseUrl}${check.path}`;
  const response = await fetchWithTimeout(url, { method: 'GET' });

  if (response.status !== check.status) {
    throw new Error(`Expected status ${check.status}, received ${response.status}`);
  }

  if (check.validateJson) {
    const payload = await response.json();
    check.validateJson(payload);
    return `status=${response.status} json=ok`;
  }

  const body = await response.text();

  if (check.contentTypeIncludes) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes(check.contentTypeIncludes)) {
      throw new Error(`Expected content-type to include "${check.contentTypeIncludes}" but received "${contentType}"`);
    }
  }

  if (check.bodyIncludes && !body.toLowerCase().includes(String(check.bodyIncludes).toLowerCase())) {
    throw new Error(`Response body does not include expected text "${check.bodyIncludes}"`);
  }

  return `status=${response.status} body=ok`;
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL);
  const checks = [
    {
      name: 'Health API',
      path: '/api/health',
      status: 200,
      validateJson(payload) {
        if (!payload || payload.success !== true) {
          throw new Error('health.success is not true');
        }
        if (!Object.prototype.hasOwnProperty.call(payload, 'rate_limit_backend')) {
          throw new Error('health.rate_limit_backend is missing');
        }
      },
    },
    {
      name: 'Index page',
      path: '/',
      status: 200,
      contentTypeIncludes: 'text/html',
      bodyIncludes: '<html',
    },
    {
      name: 'Check-in page',
      path: '/checkin',
      status: 200,
      contentTypeIncludes: 'text/html',
      bodyIncludes: 'checkin',
    },
    {
      name: 'Runtime env',
      path: '/env.js',
      status: 200,
      contentTypeIncludes: 'application/javascript',
      bodyIncludes: 'window.__EVARA_CONFIG__',
    },
  ];

  console.log(`[smoke] base=${baseUrl}`);
  let hasFailure = false;

  for (const check of checks) {
    try {
      const details = await runCheck(baseUrl, check);
      console.log(`[PASS] ${check.name}: ${details}`);
    } catch (error) {
      hasFailure = true;
      console.error(`[FAIL] ${check.name}: ${error.message}`);
    }
  }

  if (hasFailure) {
    process.exit(1);
  }

  console.log('[smoke] all checks passed');
}

main().catch((error) => {
  console.error(`[smoke] failed: ${error.message}`);
  process.exit(1);
});
