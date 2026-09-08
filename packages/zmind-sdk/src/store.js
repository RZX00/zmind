const fs = require('fs');
const os = require('os');
const path = require('path');

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultState() {
  return {
    config: {},
    session: null,
    workspace: null,
  };
}

function resolveZMindHome(env = process.env) {
  return env.ZMIND_HOME
    ? path.resolve(env.ZMIND_HOME)
    : path.join(os.homedir(), '.zmind');
}

function resolveSessionFile(env = process.env) {
  return path.join(resolveZMindHome(env), 'session.json');
}

async function readJson(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  try {
    await fs.promises.chmod(tempPath, 0o600);
  } catch {}
  await fs.promises.rename(tempPath, filePath);
  try {
    await fs.promises.chmod(filePath, 0o600);
  } catch {}
}

function createFileSessionStore(options = {}) {
  const env = options.env || process.env;
  const filePath = options.filePath || resolveSessionFile(env);

  return {
    filePath,
    async read() {
      const current = await readJson(filePath);
      return current ? current : defaultState();
    },
    async write(nextState) {
      const normalized = nextState && typeof nextState === 'object'
        ? nextState
        : defaultState();
      await writeJsonAtomic(filePath, normalized);
      return cloneState(normalized);
    },
    async patch(partialState) {
      const current = await this.read();
      const next = {
        ...current,
        ...partialState,
        config: {
          ...(current.config || {}),
          ...((partialState && partialState.config) || {}),
        },
      };
      if (Object.prototype.hasOwnProperty.call(partialState || {}, 'session')) {
        next.session = partialState.session;
      }
      if (Object.prototype.hasOwnProperty.call(partialState || {}, 'workspace')) {
        next.workspace = partialState.workspace;
      }
      await this.write(next);
      return next;
    },
    async clearSession() {
      const current = await this.read();
      const next = {
        ...current,
        session: null,
        workspace: null,
      };
      await this.write(next);
      return next;
    },
  };
}

module.exports = {
  createFileSessionStore,
  defaultState,
  resolveSessionFile,
  resolveZMindHome,
};
