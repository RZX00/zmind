const { ERROR_CODES, ZMindError } = require('./errors');

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildErrorCode(response, payload) {
  const payloadText = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  if (response.status === 401) {
    return ERROR_CODES.AUTH_REQUIRED;
  }
  if ((response.status === 403 || response.status === 404) && /disabled/i.test(payloadText)) {
    return ERROR_CODES.FEATURE_DISABLED;
  }
  if (response.status === 404) {
    return ERROR_CODES.NOT_FOUND;
  }
  if (response.status === 409) {
    return ERROR_CODES.VERSION_CONFLICT;
  }
  if (response.status === 400 || response.status === 422) {
    return ERROR_CODES.VALIDATION_ERROR;
  }
  return ERROR_CODES.HTTP_ERROR;
}

async function requestJson(fetchImpl, url, options = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new ZMindError(
      ERROR_CODES.CONFIG_MISSING,
      'No fetch implementation is available in this runtime'
    );
  }

  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    throw new ZMindError(
      ERROR_CODES.HTTP_ERROR,
      `Network request failed for ${url}`,
      {
        cause: error,
        details: {
          url,
          message: error && error.message ? error.message : String(error),
        },
      }
    );
  }
  const payload = await parseResponseBody(response);

  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'detail')
      ? payload.detail
      : payload;
    throw new ZMindError(
      buildErrorCode(response, payload),
      `Request failed with status ${response.status}`,
      {
        statusCode: response.status,
        details: detail,
      }
    );
  }

  return payload;
}

module.exports = {
  requestJson,
};
