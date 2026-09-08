const fs = require('fs');
const path = require('path');

const { dispatchLocal } = require('./local');
const { loadZMindSdk } = require('./load-sdk');
const { loadApplicationModule } = require('./load-application');

const { ZMindClient, ZMindError, ERROR_CODES } = loadZMindSdk();
const { AppError, APP_ERROR_CODES, APP_EXIT_CODES } = loadApplicationModule();

const REMOTE_EXIT_CODES = {
  [ERROR_CODES.AUTH_REQUIRED]: 30,
  [ERROR_CODES.CONFIG_MISSING]: 31,
  [ERROR_CODES.NOT_FOUND]: 32,
  [ERROR_CODES.VALIDATION_ERROR]: 33,
  [ERROR_CODES.VERSION_CONFLICT]: 34,
  [ERROR_CODES.FEATURE_DISABLED]: 35,
  [ERROR_CODES.HTTP_ERROR]: 36,
};

async function runCli(argv, io, dependencies = {}) {
  const out = io && io.stdout ? io.stdout : process.stdout;
  const err = io && io.stderr ? io.stderr : process.stderr;
  const exit = io && io.exit ? io.exit : (code) => {
    process.exitCode = code;
  };

  try {
    if (isHelpArg(argv)) {
      out.write(`${buildHelpText()}\n`);
      exit(0);
      return 0;
    }
    if (isVersionArg(argv)) {
      out.write(`${readVersion()}\n`);
      exit(0);
      return 0;
    }

    const parsed = parseArgv(argv);
    const clientFactory = dependencies.remoteClientFactory || (() => new ZMindClient());
    const localDispatcher = dependencies.localDispatcher || dispatchLocal;

    const result = isLocalCommand(parsed)
      ? await localDispatcher(parsed)
      : await dispatchRemote(parsed, clientFactory());

    if (parsed.flags.json) {
      out.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
    } else {
      out.write(`${formatHumanResult(parsed, result)}\n`);
    }
    exit(0);
    return 0;
  } catch (error) {
    const normalized = normalizeCliError(error);
    const payload = {
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details || null,
      },
    };

    if (argv.includes('--json')) {
      err.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      err.write(`[${normalized.code}] ${normalized.message}\n`);
      if (normalized.details) {
        err.write(`${JSON.stringify(normalized.details)}\n`);
      }
    }

    const code = APP_EXIT_CODES[normalized.code]
      || REMOTE_EXIT_CODES[normalized.code]
      || APP_EXIT_CODES[APP_ERROR_CODES.E_INTERNAL]
      || 99;
    exit(code);
    return code;
  }
}

function parseArgv(argv) {
  if (!Array.isArray(argv) || argv.length < 1) {
    throw new AppError(APP_ERROR_CODES.E_USAGE, 'command is required');
  }

  const [group, maybeAction, ...tail] = argv;
  if (!group) {
    throw new AppError(APP_ERROR_CODES.E_USAGE, 'command group is required');
  }

  const action = maybeAction && !String(maybeAction).startsWith('--') ? maybeAction : '';
  const rest = action ? tail : argv.slice(1);

  const flags = {};
  const positionals = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (!String(token).startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = String(token).slice(2);
    const next = rest[index + 1];
    if (!next || String(next).startsWith('--')) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }

  return {
    group,
    action,
    command: `${group} ${action}`.trim(),
    flags,
    positionals,
  };
}

function isLocalCommand(parsed) {
  if (['vault', 'node', 'edge', 'validate', 'migrate', 'sync'].includes(parsed.group)) {
    return true;
  }
  return Boolean(parsed.flags.vault);
}

async function dispatchRemote(parsed, client) {
  if (parsed.group === 'auth' && parsed.action === 'login') {
    return client.loginWithPassword({
      email: required(parsed.flags.email || parsed.positionals[0], '--email is required'),
      password: required(parsed.flags.password, '--password is required'),
      backendUrl: parsed.flags['backend-url'],
      supabaseUrl: parsed.flags['supabase-url'],
      supabaseAnonKey: parsed.flags['supabase-anon-key'],
    });
  }

  if (parsed.group === 'auth' && parsed.action === 'status') {
    return client.getStatus();
  }

  if (parsed.group === 'auth' && parsed.action === 'logout') {
    return client.logout();
  }

  if (parsed.group === 'workspace' && parsed.action === 'list') {
    return client.listWorkspaces();
  }

  if (parsed.group === 'workspace' && ['use', 'select'].includes(parsed.action)) {
    return client.useWorkspace({
      workspaceId: required(parsed.flags.id || parsed.positionals[0], '--id is required'),
    });
  }

  if (parsed.group === 'workspace' && ['current', 'status'].includes(parsed.action)) {
    return client.getWorkspaceMeta();
  }

  if (parsed.group === 'canvas' && parsed.action === 'list') {
    return client.listCanvases({
      limit: parsed.flags.limit,
      offset: parsed.flags.offset,
      deleted: parsed.flags.deleted,
      workspaceId: parsed.flags.workspace,
    });
  }

  if (parsed.group === 'canvas' && ['get', 'show'].includes(parsed.action)) {
    return client.getCanvas({
      canvasId: required(parsed.flags.id || parsed.positionals[0], '--id is required'),
      workspaceId: parsed.flags.workspace,
    });
  }

  if (parsed.group === 'canvas' && parsed.action === 'create') {
    const input = loadOptionalJsonFile(parsed.flags.input);
    return client.createCanvas({
      title: required(parsed.flags.title, '--title is required'),
      nodes: input && Array.isArray(input.nodes) ? input.nodes : [],
      connections: input && Array.isArray(input.connections) ? input.connections : [],
      workspaceId: parsed.flags.workspace,
    });
  }

  if (parsed.group === 'canvas' && parsed.action === 'apply') {
    return client.applyCanvasOperations({
      canvasId: required(parsed.flags.id || parsed.positionals[0], '--id is required'),
      operations: loadRequiredJsonArray(parsed.flags['ops-file'], parsed.flags['ops-json'], 'operations', 'ops'),
      expectedVersion: parsed.flags['expected-version'],
      workspaceId: parsed.flags.workspace,
    });
  }

  if (parsed.group === 'canvas' && parsed.action === 'share-status') {
    return client.getCanvasShareStatus({
      canvasId: required(parsed.flags.id || parsed.positionals[0], '--id is required'),
      workspaceId: parsed.flags.workspace,
    });
  }

  if (parsed.group === 'canvas' && parsed.action === 'share-update') {
    return client.updateCanvasShare({
      canvasId: required(parsed.flags.id || parsed.positionals[0], '--id is required'),
      workspaceId: parsed.flags.workspace,
      isPublic: parseOptionalBoolean(parsed.flags.public),
      isListed: parseOptionalBoolean(parsed.flags.listed),
      timelineEnabled: parseOptionalBoolean(parsed.flags['timeline-enabled']),
      publicShowsTimeline: parseOptionalBoolean(parsed.flags['public-shows-timeline']),
    });
  }

  if (parsed.group === 'docs' && parsed.action === 'list') {
    return client.listDocs({
      workspaceId: parsed.flags.workspace,
    });
  }

  if (parsed.group === 'docs' && ['get', 'show'].includes(parsed.action)) {
    return client.getDoc({
      itemId: required(parsed.flags.id || parsed.positionals[0], '--id is required'),
      workspaceId: parsed.flags.workspace,
    });
  }

  if (parsed.group === 'docs' && parsed.action === 'create') {
    return client.createDoc({
      title: required(parsed.flags.title, '--title is required'),
      contentMd: loadOptionalText(parsed.flags['content-file']) || parsed.flags['content-md'] || '',
      workspaceId: parsed.flags.workspace,
      folderId: parsed.flags['folder-id'],
      parentItemId: parsed.flags['parent-item-id'],
    });
  }

  if (parsed.group === 'docs' && parsed.action === 'apply') {
    return client.applyDocOperations({
      itemId: required(parsed.flags.id || parsed.positionals[0], '--id is required'),
      baseVersion: required(parsed.flags['base-version'], '--base-version is required'),
      ops: loadRequiredJsonArray(parsed.flags['ops-file'], parsed.flags['ops-json'], 'ops'),
      summary: parsed.flags.summary,
      workspaceId: parsed.flags.workspace,
    });
  }

  throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, `unsupported remote command: ${parsed.command}`);
}

function normalizeCliError(error) {
  if (error instanceof AppError || error instanceof ZMindError) {
    return error;
  }

  return new AppError(
    APP_ERROR_CODES.E_INTERNAL,
    error && error.message ? error.message : 'internal error'
  );
}

function required(value, message) {
  const text = String(value || '').trim();
  if (!text) {
    throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, message);
  }
  return text;
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, `Invalid boolean value: ${value}`);
}

function loadOptionalJsonFile(filePath) {
  if (!filePath) {
    return null;
  }
  return parseJson(fs.readFileSync(path.resolve(String(filePath)), 'utf8'));
}

function loadRequiredJsonArray(filePath, inlineJson, fieldName, optionBaseName = fieldName) {
  if (!filePath && !inlineJson) {
    throw new ZMindError(
      ERROR_CODES.VALIDATION_ERROR,
      `Provide --${optionBaseName}-file or --${optionBaseName}-json`
    );
  }
  const raw = filePath
    ? fs.readFileSync(path.resolve(String(filePath)), 'utf8')
    : String(inlineJson);
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) {
    throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, `${fieldName} payload must be an array`);
  }
  return parsed;
}

function loadOptionalText(filePath) {
  if (!filePath) {
    return '';
  }
  return fs.readFileSync(path.resolve(String(filePath)), 'utf8');
}

function parseJson(raw) {
  try {
    return JSON.parse(String(raw));
  } catch (error) {
    throw new ZMindError(ERROR_CODES.VALIDATION_ERROR, 'Invalid JSON payload', {
      details: {
        message: error.message,
      },
    });
  }
}

function formatHumanResult(parsed, result) {
  const command = parsed.command;
  if (isLocalCommand(parsed)) {
    return formatLocalHumanResult(command, result);
  }

  if (command === 'auth login') {
    return `Signed in as ${result.user && result.user.email ? result.user.email : 'unknown user'}`;
  }
  if (command === 'auth status') {
    if (!result.loggedIn) {
      return 'Not signed in';
    }
    const workspaceId = result.workspace && result.workspace.id ? result.workspace.id : 'not selected';
    const email = result.session && result.session.user ? result.session.user.email : 'unknown';
    return `Signed in as ${email} (workspace=${workspaceId})`;
  }
  if (command === 'auth logout') {
    return 'Signed out from ZMind';
  }
  if (command === 'workspace list') {
    if (!Array.isArray(result) || result.length === 0) {
      return 'No workspaces found';
    }
    return `Workspaces: ${result.map((workspace) => workspace.name).join(', ')}`;
  }
  if (command === 'workspace use') {
    return `Using workspace ${result.name} (${result.id})`;
  }
  if (['workspace current', 'workspace status'].includes(command)) {
    return `Workspace ready (version=${result.version || 'n/a'})`;
  }
  if (command === 'canvas list') {
    return `Canvases: ${(result || []).map((item) => item.title || item.id).join(', ')}`;
  }
  if (['canvas get', 'canvas show'].includes(command)) {
    return `Canvas "${result.title}" loaded (${(result.nodes || []).length} nodes)`;
  }
  if (command === 'canvas create') {
    return `Created canvas "${result.title}" (${result.id})`;
  }
  if (command === 'canvas apply') {
    return `Applied ${(result.operations || result.appliedOperations || []).length || 'requested'} canvas operations`;
  }
  if (command === 'canvas share-status') {
    return `Canvas share status loaded`;
  }
  if (command === 'canvas share-update') {
    return 'Canvas share settings updated';
  }
  if (command === 'docs list') {
    const items = (result && result.items) || [];
    return `Docs: ${items.map((item) => item.title || item.id).join(', ')}`;
  }
  if (['docs get', 'docs show'].includes(command)) {
    return `Doc "${result.title}" loaded (version=${result.version})`;
  }
  if (command === 'docs create') {
    return `Created doc "${result.title}" (${result.itemId})`;
  }
  if (command === 'docs apply') {
    return `Applied ${result.appliedOps} doc operations (version=${result.version})`;
  }
  return `${command} ok`;
}

function formatLocalHumanResult(command, result) {
  if (command === 'canvas list') {
    return `canvases: ${(result.canvases || []).join(', ')}`;
  }
  if (result && typeof result === 'object' && result.canvasId) {
    return `${command} ok (canvas=${result.canvasId}, revision=${result.revision})`;
  }
  if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'valid')) {
    return `${command} ok (valid=${result.valid})`;
  }
  return `${command} ok`;
}

function isHelpArg(argv) {
  return argv.length === 0 || argv.includes('--help') || argv.includes('-h') || argv[0] === 'help';
}

function isVersionArg(argv) {
  return argv.includes('--version') || argv.includes('-v');
}

function readVersion() {
  const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const packageJson = require(packageJsonPath);
  return packageJson.version;
}

function buildHelpText() {
  return [
    'zmind - local-first + remote workspace CLI',
    '',
    'Remote commands:',
    '  zmind auth login --email <email> --password <password> [--backend-url <url>] [--supabase-url <url>] [--supabase-anon-key <key>]',
    '  zmind auth status',
    '  zmind auth logout',
    '  zmind workspace list',
    '  zmind workspace use --id <workspaceId>',
    '  zmind workspace current',
    '  zmind canvas list [--workspace <workspaceId>] [--json]',
    '  zmind canvas get --id <canvasId> [--workspace <workspaceId>] [--json]',
    '  zmind canvas create --title <title> [--input <canvas.json>] [--workspace <workspaceId>] [--json]',
    '  zmind canvas apply --id <canvasId> (--ops-file <ops.json> | --ops-json <json>) [--expected-version <n>] [--json]',
    '  zmind canvas share-status --id <canvasId> [--json]',
    '  zmind canvas share-update --id <canvasId> [--public true|false] [--listed true|false] [--json]',
    '  zmind docs list [--workspace <workspaceId>] [--json]',
    '  zmind docs get --id <docId> [--workspace <workspaceId>] [--json]',
    '  zmind docs create --title <title> [--content-file <file.md> | --content-md <text>] [--json]',
    '  zmind docs apply --id <docId> --base-version <n> (--ops-file <ops.json> | --ops-json <json>) [--summary <text>] [--json]',
    '',
    'Local-first commands (require --vault):',
    '  zmind vault init --vault <path> [--name <name>] [--json]',
    '  zmind canvas list --vault <path> [--json]',
    '  zmind canvas create --vault <path> --id <canvasId> --title <title> [--json]',
    '  zmind canvas show --vault <path> --id <canvasId> [--json]',
    '  zmind node add --vault <path> --canvas <id> --id <nodeId> --x <n> --y <n> [--type text] [--text <s>] [--json]',
    '  zmind node update --vault <path> --canvas <id> --node <nodeId> --set path=value [--json]',
    '  zmind edge add --vault <path> --canvas <id> --id <edgeId> --from <nodeId> --to <nodeId> [--type arrow] [--json]',
    '  zmind validate --vault <path> [--canvas <id>] [--json]',
    '  zmind migrate --vault <path> --to latest [--json]',
    '  zmind sync push --vault <path> --canvas <id> [--json]',
    '  zmind sync pull --vault <path> --canvas <id> [--json]',
    '  zmind sync resolve --vault <path> --canvas <id> [--strategy manual|local|remote] [--json]',
    '',
    'Global flags:',
    '  --help, -h',
    '  --version, -v',
  ].join('\n');
}

module.exports = {
  buildHelpText,
  dispatchRemote,
  formatHumanResult,
  isLocalCommand,
  parseArgv,
  runCli,
};
