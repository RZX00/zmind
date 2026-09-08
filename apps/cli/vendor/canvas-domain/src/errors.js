class DomainError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details || null;
  }
}

const DOMAIN_ERROR_CODES = {
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  DUPLICATE_NODE_ID: 'DUPLICATE_NODE_ID',
  DUPLICATE_EDGE_ID: 'DUPLICATE_EDGE_ID',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  EDGE_NOT_FOUND: 'EDGE_NOT_FOUND',
  EDGE_ENDPOINT_INVALID: 'EDGE_ENDPOINT_INVALID',
};

module.exports = {
  DomainError,
  DOMAIN_ERROR_CODES,
};
