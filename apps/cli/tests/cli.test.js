const test = require('node:test');
const assert = require('node:assert/strict');

const { runCli, parseArgv, isLocalCommand } = require('../src/cli');

function createIo() {
  const chunks = {
    stdout: '',
    stderr: '',
    code: null,
  };
  return {
    io: {
      stdout: {
        write(text) {
          chunks.stdout += text;
        },
      },
      stderr: {
        write(text) {
          chunks.stderr += text;
        },
      },
      exit(code) {
        chunks.code = code;
      },
    },
    chunks,
  };
}

test('parseArgv collects flags and positionals', () => {
  const parsed = parseArgv(['canvas', 'get', '--id', 'c1', '--json']);
  assert.equal(parsed.group, 'canvas');
  assert.equal(parsed.action, 'get');
  assert.equal(parsed.flags.id, 'c1');
  assert.equal(parsed.flags.json, true);
});

test('isLocalCommand keeps vault flows local', () => {
  assert.equal(isLocalCommand(parseArgv(['canvas', 'list', '--vault', './vault'])), true);
  assert.equal(isLocalCommand(parseArgv(['canvas', 'list'])), false);
  assert.equal(isLocalCommand(parseArgv(['node', 'add', '--vault', './vault'])), true);
});

test('auth login uses remote client and prints human output', async () => {
  const { io, chunks } = createIo();
  const calls = [];
  const remoteClientFactory = () => ({
    async loginWithPassword(input) {
      calls.push(input);
      return {
        user: {
          email: 'demo@zmind.so',
        },
      };
    },
  });

  await runCli(
    ['auth', 'login', '--email', 'demo@zmind.so', '--password', 'secret'],
    io,
    { remoteClientFactory }
  );

  assert.equal(calls.length, 1);
  assert.match(chunks.stdout, /Signed in as demo@zmind\.so/);
  assert.equal(chunks.code, 0);
});

test('canvas list without vault uses remote client', async () => {
  const { io, chunks } = createIo();
  let called = false;
  const remoteClientFactory = () => ({
    async listCanvases() {
      called = true;
      return [{ title: 'Roadmap' }];
    },
  });

  await runCli(['canvas', 'list'], io, { remoteClientFactory });

  assert.equal(called, true);
  assert.match(chunks.stdout, /Roadmap/);
});

test('canvas list with vault uses local dispatcher', async () => {
  const { io, chunks } = createIo();
  let called = false;
  const localDispatcher = async () => {
    called = true;
    return { canvases: ['local-1'] };
  };

  await runCli(['canvas', 'list', '--vault', './vault'], io, { localDispatcher });

  assert.equal(called, true);
  assert.match(chunks.stdout, /local-1/);
});
