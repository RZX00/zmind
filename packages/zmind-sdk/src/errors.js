class ZMindError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'ZMindError';
    this.code = code;
    this.statusCode = options.statusCode || null;
    this.details = options.details || null;
    this.cause = options.cause;
  }
}

const ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  CONFIG_MISSING: 'CONFIG_MISSING',
  HTTP_ERROR: 'HTTP_ERROR',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
};

module.exports = {
  ERROR_CODES,
  ZMindError,
};
