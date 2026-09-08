const { DomainError, DOMAIN_ERROR_CODES } = require('./errors');
const {
  CURRENT_CANVAS_SCHEMA_VERSION,
  createCanvas,
  validateCanvasSnapshot,
  addNode,
  updateNode,
  addEdge,
  updateEdge,
  removeNode,
  removeEdge,
  replaceCanvas,
} = require('./canvas');

module.exports = {
  DomainError,
  DOMAIN_ERROR_CODES,
  CURRENT_CANVAS_SCHEMA_VERSION,
  createCanvas,
  validateCanvasSnapshot,
  addNode,
  updateNode,
  addEdge,
  updateEdge,
  removeNode,
  removeEdge,
  replaceCanvas,
};
