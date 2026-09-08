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
  const projectApi = read('api/project-api.ts');
  const leftPanel = read('components/LeftPanel.tsx');
  const shareModal = read('components/ShareModal.tsx');
  const publicWeb = read('constants/PublicWeb.ts');

  assertMatch(
    projectApi,
    /thread_id:\s*project\.threads\?\.\[0\]\?\.thread_id\s*\|\|\s*project\.threads\?\.thread_id/m,
    'project-api.ts: projects list must map thread_id from the joined threads relation.',
    errors,
  );

  assertMatch(
    projectApi,
    /is_public:\s*Boolean\(project\.is_public\)/m,
    'project-api.ts: projects list must preserve is_public for reopening the mobile share shell.',
    errors,
  );

  assertMatch(
    leftPanel,
    /threadId:\s*project\.thread_id/m,
    'LeftPanel.tsx: share modal payload must carry threadId.',
    errors,
  );

  assertMatch(
    shareModal,
    /return `\$\{getPublicWebUrl\(\)\}\/share\/\$\{threadId\}`;/m,
    'ShareModal.tsx: share links must be built from the public web host and threadId.',
    errors,
  );

  assertMatch(
    shareModal,
    /await updateThreadMutation\.mutateAsync\(\{\s*threadId,\s*updates:\s*\{\s*is_public:\s*true\s*\},\s*\}\);/m,
    'ShareModal.tsx: create flow must publish thread.is_public.',
    errors,
  );

  assertMatch(
    shareModal,
    /await updateThreadMutation\.mutateAsync\(\{\s*threadId,\s*updates:\s*\{\s*is_public:\s*false\s*\},\s*\}\);/m,
    'ShareModal.tsx: remove flow must revoke thread.is_public.',
    errors,
  );

  assertAbsent(
    shareModal,
    /yourdomain\.com|\/share\/\$\{projectId\}/m,
    'ShareModal.tsx: mobile share must not use fake hosts or projectId-based share routes.',
    errors,
  );

  assertMatch(
    publicWeb,
    /EXPO_PUBLIC_PUBLIC_WEB_URL\s*\|\|\s*process\.env\.EXPO_PUBLIC_FRONTEND_URL/m,
    'PublicWeb.ts: public host resolution must allow explicit mobile frontend URL configuration.',
    errors,
  );

  if (errors.length > 0) {
    console.error('Mobile share contract check failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Mobile share contract check passed.');
}

run();
