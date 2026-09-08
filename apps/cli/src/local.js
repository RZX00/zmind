const path = require('path');
const { loadApplicationModule } = require('./load-application');

const {
  CanvasApplicationService,
  AppError,
  APP_ERROR_CODES,
} = loadApplicationModule();

async function dispatchLocal(parsed) {
  const service = new CanvasApplicationService({
    ownerId: `cli-${process.pid}`,
  });

  const vaultPath = parsed.flags.vault
    ? path.resolve(String(parsed.flags.vault))
    : null;

  if (parsed.group === 'vault' && parsed.action === 'init') {
    return service.initVault({
      vaultPath: required(vaultPath, 'vault path is required (--vault)'),
      name: parsed.flags.name ? String(parsed.flags.name) : 'Zmind Vault',
    });
  }

  if (parsed.group === 'canvas' && parsed.action === 'list') {
    return service.listCanvases({
      vaultPath: required(vaultPath, 'vault path is required (--vault)'),
    });
  }

  if (parsed.group === 'canvas' && parsed.action === 'create') {
    return service.createCanvas({
      vaultPath: required(vaultPath, 'vault path is required (--vault)'),
      canvasId: parsed.flags.id || parsed.flags.canvas || generatedCanvasId(),
      title: required(parsed.flags.title, '--title is required'),
    });
  }

  if (parsed.group === 'canvas' && ['show', 'get'].includes(parsed.action)) {
    return service.getCanvas({
      vaultPath: required(vaultPath, 'vault path is required (--vault)'),
      canvasId: required(parsed.flags.id, '--id is required'),
    });
  }

  if (parsed.group === 'node' && parsed.action === 'add') {
    const data = parsed.flags.text ? { text: String(parsed.flags.text) } : {};
    return service.addNode({
      vaultPath: required(vaultPath, 'vault path is required (--vault)'),
      canvasId: required(parsed.flags.canvas, '--canvas is required'),
      nodeId: parsed.flags.id || generatedNodeId(),
      nodeType: parsed.flags.type || 'text',
      x: requiredNumber(parsed.flags.x, '--x is required'),
      y: requiredNumber(parsed.flags.y, '--y is required'),
      data,
      expectedRevision: parsed.flags['expected-revision'] || null,
    });
  }

  if (parsed.group === 'node' && parsed.action === 'update') {
    return service.updateNode({
      vaultPath: required(vaultPath, 'vault path is required (--vault)'),
      canvasId: required(parsed.flags.canvas, '--canvas is required'),
      nodeId: required(parsed.flags.node, '--node is required'),
      patch: parseSetExpression(required(parsed.flags.set, '--set path=value is required')),
      expectedRevision: parsed.flags['expected-revision'] || null,
    });
  }

  if (parsed.group === 'edge' && parsed.action === 'add') {
    return service.addEdge({
      vaultPath: required(vaultPath, 'vault path is required (--vault)'),
      canvasId: required(parsed.flags.canvas, '--canvas is required'),
      edgeId: parsed.flags.id || generatedEdgeId(),
      from: required(parsed.flags.from, '--from is required'),
      to: required(parsed.flags.to, '--to is required'),
      edgeType: parsed.flags.type || 'arrow',
      expectedRevision: parsed.flags['expected-revision'] || null,
    });
  }

  if (parsed.group === 'validate') {
    return service.validate({
      vaultPath: required(vaultPath, 'vault path is required (--vault)'),
      canvasId: parsed.flags.canvas || null,
    });
  }

  if (parsed.group === 'migrate') {
    return service.migrate({
      vaultPath: required(vaultPath, 'vault path is required (--vault)'),
      to: parsed.flags.to || 'latest',
    });
  }

  if (parsed.group === 'sync' && parsed.action === 'push') {
    return service.syncPush({
      vaultPath: required(vaultPath, 'vault path is required (--vault)'),
      canvasId: required(parsed.flags.canvas, '--canvas is required'),
    });
  }

  if (parsed.group === 'sync' && parsed.action === 'pull') {
    return service.syncPull({
      vaultPath: required(vaultPath, 'vault path is required (--vault)'),
      canvasId: required(parsed.flags.canvas, '--canvas is required'),
    });
  }

  if (parsed.group === 'sync' && parsed.action === 'resolve') {
    return service.syncResolve({
      vaultPath: required(vaultPath, 'vault path is required (--vault)'),
      canvasId: required(parsed.flags.canvas, '--canvas is required'),
      strategy: parsed.flags.strategy || 'manual',
    });
  }

  throw new AppError(APP_ERROR_CODES.E_USAGE, `unsupported local command: ${parsed.command}`);
}

function required(value, message) {
  const text = String(value || '').trim();
  if (!text) {
    throw new AppError(APP_ERROR_CODES.E_USAGE, message);
  }
  return text;
}

function requiredNumber(value, message) {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new AppError(APP_ERROR_CODES.E_USAGE, message);
  }
  return n;
}

function parseSetExpression(expression) {
  const raw = String(expression);
  const separatorIndex = raw.indexOf('=');
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    throw new AppError(APP_ERROR_CODES.E_USAGE, '--set must be in path=value form');
  }

  const pathExpression = raw.slice(0, separatorIndex).trim();
  const valueExpression = raw.slice(separatorIndex + 1);
  const segments = pathExpression.split('.').map((item) => item.trim()).filter(Boolean);

  if (segments.length === 0) {
    throw new AppError(APP_ERROR_CODES.E_USAGE, '--set path is empty');
  }

  const patch = {};
  let cursor = patch;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (index === segments.length - 1) {
      cursor[segment] = parsePrimitive(valueExpression);
      break;
    }
    cursor[segment] = {};
    cursor = cursor[segment];
  }

  return patch;
}

function parsePrimitive(value) {
  const normalized = String(value).trim();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  if (normalized === 'null') return null;
  if (/^-?\d+(\.\d+)?$/u.test(normalized)) {
    return Number(normalized);
  }
  return normalized;
}

function generatedCanvasId() {
  return `canvas_${Date.now()}`;
}

function generatedNodeId() {
  return `node_${Date.now()}`;
}

function generatedEdgeId() {
  return `edge_${Date.now()}`;
}

module.exports = {
  dispatchLocal,
};
