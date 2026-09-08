const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function atomicWriteJson(targetPath, payload) {
  const dirPath = path.dirname(targetPath);
  const tmpPath = `${targetPath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const encoded = `${JSON.stringify(payload, null, 2)}\n`;

  await fs.promises.mkdir(dirPath, { recursive: true });

  let fileHandle = null;
  try {
    fileHandle = await fs.promises.open(tmpPath, 'w');
    await fileHandle.writeFile(encoded, 'utf8');
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = null;

    await fs.promises.rename(tmpPath, targetPath);
    await fsyncDirectory(dirPath);
  } catch (error) {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
    await fs.promises.unlink(tmpPath).catch(() => {});
    throw error;
  }
}

async function fsyncDirectory(dirPath) {
  let dirHandle = null;
  try {
    dirHandle = await fs.promises.open(dirPath, 'r');
    await dirHandle.sync();
  } catch (_error) {
    // Directory sync may not be supported on all environments.
  } finally {
    if (dirHandle) {
      await dirHandle.close().catch(() => {});
    }
  }
}

module.exports = {
  atomicWriteJson,
};
