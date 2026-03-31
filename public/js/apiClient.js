const LOCAL_API_BASE_URL = '/api';
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

function resolveWindowOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return 'http://localhost';
}

export function normalizeApiBaseUrl(baseUrl, localApiBaseUrl = LOCAL_API_BASE_URL) {
  const normalized = String(baseUrl || '').trim();
  if (!normalized) {
    return localApiBaseUrl;
  }

  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

export function isSupabaseDomain(urlValue, origin = resolveWindowOrigin()) {
  try {
    const parsed = new URL(urlValue, origin);
    return parsed.hostname.endsWith('.supabase.co');
  } catch (_error) {
    return false;
  }
}

export function isApplicationNotFoundError(message) {
  return String(message || '').toLowerCase().includes('application not found');
}

export function shouldRetryOnLocalApi(
  primaryBaseUrl,
  message,
  localApiBaseUrl = LOCAL_API_BASE_URL
) {
  return primaryBaseUrl !== localApiBaseUrl && isApplicationNotFoundError(message);
}

export function formatApiErrorMessage({
  message,
  baseUrl,
  requestFailedMessage,
  apiEndpointMisconfiguredMessage,
  origin = resolveWindowOrigin(),
}) {
  if (isApplicationNotFoundError(message) && isSupabaseDomain(baseUrl, origin)) {
    return apiEndpointMisconfiguredMessage || requestFailedMessage || 'Request failed';
  }

  return message || requestFailedMessage || 'Request failed';
}

function buildAbortSignal(timeoutMs, externalSignal) {
  if (typeof AbortController === 'undefined') {
    return { signal: externalSignal, cleanup: () => {} };
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { signal: externalSignal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort('request-timeout'), timeoutMs);
  const cleanup = () => clearTimeout(timerId);

  if (!externalSignal) {
    return { signal: controller.signal, cleanup };
  }

  if (externalSignal.aborted) {
    controller.abort(externalSignal.reason);
  } else {
    externalSignal.addEventListener(
      'abort',
      () => controller.abort(externalSignal.reason),
      { once: true }
    );
  }

  return { signal: controller.signal, cleanup };
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

export async function sendApiRequest(baseUrl, path, requestOptions, fetchImpl = fetch, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const { signal, cleanup } = buildAbortSignal(timeoutMs, requestOptions?.signal);
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      ...requestOptions,
      signal,
    });
  } finally {
    cleanup();
  }

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export async function apiRequestWithFallback({
  path,
  baseUrl,
  requestOptions,
  requestFailedMessage,
  apiEndpointMisconfiguredMessage,
  localApiBaseUrl = LOCAL_API_BASE_URL,
  fetchImpl = fetch,
  origin = resolveWindowOrigin(),
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}) {
  const primaryBaseUrl = normalizeApiBaseUrl(baseUrl, localApiBaseUrl);
  let primaryResult = null;

  try {
    primaryResult = await sendApiRequest(primaryBaseUrl, path, requestOptions, fetchImpl, timeoutMs);
  } catch (error) {
    if (primaryBaseUrl !== localApiBaseUrl) {
      try {
        const fallbackResult = await sendApiRequest(localApiBaseUrl, path, requestOptions, fetchImpl, timeoutMs);
        if (!fallbackResult.response.ok) {
          throw new Error(
            formatApiErrorMessage({
              message: fallbackResult.payload?.message,
              baseUrl: localApiBaseUrl,
              requestFailedMessage,
              apiEndpointMisconfiguredMessage,
              origin,
            })
          );
        }
        return fallbackResult.payload;
      } catch (fallbackError) {
        if (isAbortError(error) || isAbortError(fallbackError)) {
          throw new Error('Request timed out. Please try again.');
        }
        throw new Error(requestFailedMessage || 'Request failed');
      }
    }

    if (isAbortError(error)) {
      throw new Error('Request timed out. Please try again.');
    }
    throw new Error(requestFailedMessage || 'Request failed');
  }

  if (!primaryResult.response.ok && shouldRetryOnLocalApi(primaryBaseUrl, primaryResult.payload?.message, localApiBaseUrl)) {
    const fallbackResult = await sendApiRequest(localApiBaseUrl, path, requestOptions, fetchImpl, timeoutMs);
    if (!fallbackResult.response.ok) {
      throw new Error(
        formatApiErrorMessage({
          message: fallbackResult.payload?.message || primaryResult.payload?.message,
          baseUrl: primaryBaseUrl,
          requestFailedMessage,
          apiEndpointMisconfiguredMessage,
          origin,
        })
      );
    }

    return fallbackResult.payload;
  }

  if (!primaryResult.response.ok) {
    throw new Error(
      formatApiErrorMessage({
        message: primaryResult.payload?.message,
        baseUrl: primaryBaseUrl,
        requestFailedMessage,
        apiEndpointMisconfiguredMessage,
        origin,
      })
    );
  }

  return primaryResult.payload;
}

export { LOCAL_API_BASE_URL };
