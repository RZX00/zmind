const fs = require('fs');

const { getLockPath } = require('./paths');

function getNow(nowProvider) {
  return typeof nowProvider === 'function' ? nowProvider() : new Date();
}

async function acquireLock(options) {
  const {
    vaultPath,
    resourceId,
    ownerId,
    timeoutMs = 3000,
    ttlMs = 30000,
    pollMs = 50,
    nowProvider,
  } = options;

  const deadline = Date.now() + timeoutMs;
  const lockPath = getLockPath(vaultPath, resourceId);

  while (Date.now() <= deadline) {
    const now = getNow(nowProvider);
    const record = {
      lockVersion: 1,
      resourceId,
      ownerId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };

    try {
      const content = `${JSON.stringify(record)}\n`;
      await fs.promises.writeFile(lockPath, content, { encoding: 'utf8', flag: 'wx' });
      return { lockPath, resourceId, ownerId };
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      const replaced = await tryRecoverExpiredLock(lockPath, nowProvider);
      if (!replaced) {
        await sleep(pollMs);
      }
    }
  }

  const timeoutError = new Error(`lock timeout for resource ${resourceId}`);
  timeoutError.code = 'E_LOCK_TIMEOUT';
  throw timeoutError;
}

async function releaseLock(token) {
  if (!token || !token.lockPath) {
    return;
  }
  await fs.promises.unlink(token.lockPath).catch(() => {});
}

async function tryRecoverExpiredLock(lockPath, nowProvider) {
  try {
    const raw = await fs.promises.readFile(lockPath, 'utf8');
    const record = JSON.parse(raw);
    const expiresAt = new Date(record.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt > getNow(nowProvider)) {
      return false;
    }

    await fs.promises.unlink(lockPath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  acquireLock,
  releaseLock,
};
