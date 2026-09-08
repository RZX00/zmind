const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function assertMatch(source, pattern, message, errors) {
  if (!pattern.test(source)) {
    errors.push(message);
  }
}

function assertAbsent(source, pattern, message, errors) {
  if (pattern.test(source)) {
    errors.push(message);
  }
}

function run() {
  const errors = [];
  const chatApi = read('api/chat-api.ts');
  const chatHooks = read('hooks/useChatHooks.tsx');

  assertMatch(
    chatApi,
    /onClose:\s*\(finalStatus\?:\s*AgentTerminalStatus\)\s*=>\s*void/m,
    'chat-api.ts: stream close callbacks must preserve an optional terminal status.',
    errors,
  );

  assertMatch(
    chatApi,
    /export const getTerminalStatusFromStreamPayload = \(/m,
    'chat-api.ts: stream payloads must be normalized into terminal statuses.',
    errors,
  );

  assertMatch(
    chatApi,
    /resolveAgentRunTerminalStatus\(agentRunId\)/m,
    'chat-api.ts: EventSource error recovery must reconcile backend terminal status before closing.',
    errors,
  );

  assertMatch(
    chatHooks,
    /const handleStreamClose = useCallback\(\(finalStatus\?: AgentTerminalStatus\)/m,
    'useChatHooks.tsx: hook close handling must accept the transport terminal status.',
    errors,
  );

  assertMatch(
    chatHooks,
    /case 'run_failed':/m,
    'useChatHooks.tsx: hook must preserve failed terminal status from stream status events.',
    errors,
  );

  assertMatch(
    chatHooks,
    /case 'run_stopped':/m,
    'useChatHooks.tsx: hook must preserve stopped terminal status from stream status events.',
    errors,
  );

  assertAbsent(
    chatHooks,
    /const handleStreamClose[\s\S]*finalizeStream\('completed',\s*currentRunIdRef\.current\)/m,
    'useChatHooks.tsx: close handler must not collapse connecting/streaming closes into completed.',
    errors,
  );

  assertAbsent(
    chatHooks,
    /case 'thread_run_end':[\s\S]*finalizeStream\('completed',\s*currentRunIdRef\.current\)/m,
    'useChatHooks.tsx: thread_run_end must not hardcode completed without terminal-status reconciliation.',
    errors,
  );

  if (errors.length > 0) {
    console.error('Mobile stream recovery contract check failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Mobile stream recovery contract check passed.');
}

run();
