const fs = require('fs');
const path = require('path');

const { getBackupsDir } = require('./paths');
const { atomicWriteJson } = require('./atomicWrite');

async function writeCanvasBackup(options) {
  const {
    vaultPath,
    snapshot,
    maxBackupsPerCanvas = 20,
    nowProvider,
  } = options;

  if (!snapshot || !snapshot.canvasId) {
    return null;
  }

  const backupDir = getBackupsDir(vaultPath);
  await fs.promises.mkdir(backupDir, { recursive: true });

  const timestamp = formatFileTimestamp(typeof nowProvider === 'function' ? nowProvider() : new Date());
  const fileBase = `${snapshot.canvasId}.${timestamp}.bak`;
  const backupPath = path.join(backupDir, `${fileBase}.json`);

  await atomicWriteJson(backupPath, snapshot);
  await pruneCanvasBackups(backupDir, snapshot.canvasId, maxBackupsPerCanvas);

  return backupPath;
}

async function pruneCanvasBackups(backupDir, canvasId, maxBackups) {
  const entries = await fs.promises.readdir(backupDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${canvasId}.`) && entry.name.endsWith('.bak.json'))
    .map((entry) => entry.name)
    .sort();

  if (files.length <= maxBackups) {
    return;
  }

  const removeCount = files.length - maxBackups;
  const toDelete = files.slice(0, removeCount);
  await Promise.all(toDelete.map((filename) => fs.promises.unlink(path.join(backupDir, filename)).catch(() => {})));
}

function formatFileTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

module.exports = {
  writeCanvasBackup,
};
