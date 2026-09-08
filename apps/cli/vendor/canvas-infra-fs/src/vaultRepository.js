const fs = require('fs');

const { atomicWriteJson } = require('./atomicWrite');
const {
  getVaultMetaPath,
  getCanvasesDir,
  getCanvasPath,
  getLocksDir,
  getJournalDir,
  getBackupsDir,
} = require('./paths');

async function ensureVaultStructure(vaultPath) {
  await fs.promises.mkdir(vaultPath, { recursive: true });
  await fs.promises.mkdir(getCanvasesDir(vaultPath), { recursive: true });
  await fs.promises.mkdir(getLocksDir(vaultPath), { recursive: true });
  await fs.promises.mkdir(getJournalDir(vaultPath), { recursive: true });
  await fs.promises.mkdir(getBackupsDir(vaultPath), { recursive: true });
}

async function initVault(vaultPath, name, nowProvider) {
  await ensureVaultStructure(vaultPath);
  const now = (typeof nowProvider === 'function' ? nowProvider() : new Date()).toISOString();

  const metaPath = getVaultMetaPath(vaultPath);
  const metadata = {
    vaultVersion: 1,
    name,
    createdAt: now,
    updatedAt: now,
  };

  await atomicWriteJson(metaPath, metadata);
  return metadata;
}

async function loadVaultMetadata(vaultPath) {
  const metaPath = getVaultMetaPath(vaultPath);
  const raw = await fs.promises.readFile(metaPath, 'utf8');
  return JSON.parse(raw);
}

async function saveVaultMetadata(vaultPath, metadata) {
  const metaPath = getVaultMetaPath(vaultPath);
  await atomicWriteJson(metaPath, metadata);
}

async function listCanvasIds(vaultPath) {
  const canvasDir = getCanvasesDir(vaultPath);
  const entries = await fs.promises.readdir(canvasDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.canvas.json'))
    .map((entry) => entry.name.replace(/\.canvas\.json$/u, ''))
    .sort();
}

async function hasCanvas(vaultPath, canvasId) {
  const canvasPath = getCanvasPath(vaultPath, canvasId);
  try {
    await fs.promises.access(canvasPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadCanvas(vaultPath, canvasId) {
  const canvasPath = getCanvasPath(vaultPath, canvasId);
  const raw = await fs.promises.readFile(canvasPath, 'utf8');
  return JSON.parse(raw);
}

async function saveCanvasAtomic(vaultPath, snapshot) {
  const canvasPath = getCanvasPath(vaultPath, snapshot.canvasId);
  await atomicWriteJson(canvasPath, snapshot);
}

async function deleteCanvas(vaultPath, canvasId) {
  const canvasPath = getCanvasPath(vaultPath, canvasId);
  await fs.promises.rm(canvasPath, { force: true });
}

module.exports = {
  ensureVaultStructure,
  initVault,
  loadVaultMetadata,
  saveVaultMetadata,
  listCanvasIds,
  hasCanvas,
  loadCanvas,
  saveCanvasAtomic,
  deleteCanvas,
};
