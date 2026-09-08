const path = require('path');

function getVaultMetaPath(vaultPath) {
  return path.join(vaultPath, 'zmind.vault.json');
}

function getCanvasesDir(vaultPath) {
  return path.join(vaultPath, 'canvases');
}

function getCanvasPath(vaultPath, canvasId) {
  return path.join(getCanvasesDir(vaultPath), `${canvasId}.canvas.json`);
}

function getInternalDir(vaultPath) {
  return path.join(vaultPath, '.zmind');
}

function getLocksDir(vaultPath) {
  return path.join(getInternalDir(vaultPath), 'locks');
}

function getJournalDir(vaultPath) {
  return path.join(getInternalDir(vaultPath), 'journal');
}

function getBackupsDir(vaultPath) {
  return path.join(getInternalDir(vaultPath), 'backups');
}

function getLockPath(vaultPath, resourceId) {
  return path.join(getLocksDir(vaultPath), `${resourceId}.lock`);
}

function getJournalPath(vaultPath, canvasId) {
  return path.join(getJournalDir(vaultPath), `${canvasId}.journal.ndjson`);
}

module.exports = {
  getVaultMetaPath,
  getCanvasesDir,
  getCanvasPath,
  getInternalDir,
  getLocksDir,
  getJournalDir,
  getBackupsDir,
  getLockPath,
  getJournalPath,
};
