const { ERROR_CODES, ZMindError } = require('./errors');

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function normalizeUrl(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text.replace(/\/+$/u, '');
}

function normalizeBackendUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) {
    return '';
  }
  return normalized.replace(/\/api$/u, '');
}

function resolveRuntimeConfig(state, overrides = {}, env = process.env) {
  return {
    backendUrl: normalizeBackendUrl(
      pickFirst(
        overrides.backendUrl,
        state && state.config && state.config.backendUrl,
        env.ZMIND_BACKEND_URL,
        env.NEXT_PUBLIC_BACKEND_URL,
        env.EXPO_PUBLIC_BACKEND_URL
      )
    ),
    supabaseUrl: normalizeUrl(
      pickFirst(
        overrides.supabaseUrl,
        state && state.config && state.config.supabaseUrl,
        env.ZMIND_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.EXPO_PUBLIC_SUPABASE_URL
      )
    ),
    supabaseAnonKey: pickFirst(
      overrides.supabaseAnonKey,
      state && state.config && state.config.supabaseAnonKey,
      env.ZMIND_SUPABASE_ANON_KEY,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ),
  };
}

function assertConfig(config, fields) {
  const missing = fields.filter((field) => !config[field]);
  if (missing.length > 0) {
    throw new ZMindError(
      ERROR_CODES.CONFIG_MISSING,
      `Missing required configuration: ${missing.join(', ')}`,
      {
        details: {
          missing,
        },
      }
    );
  }
  return config;
}

module.exports = {
  assertConfig,
  normalizeBackendUrl,
  normalizeUrl,
  resolveRuntimeConfig,
};
