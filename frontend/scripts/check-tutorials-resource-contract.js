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
  const tutorialsPage = read('src/app/(home)/tutorials/page.tsx');

  assertAbsent(
    tutorialsPage,
    /href="\s*\/support\s*"/m,
    'tutorials/page.tsx: Resources panel must not link to the non-existent /support route.',
    errors,
  );

  assertMatch(
    tutorialsPage,
    /<Link[\s\S]*href="\/docs\/introduction"[\s\S]*Documentation[\s\S]*<\/Link>/m,
    'tutorials/page.tsx: Resources panel must expose the real documentation entry.',
    errors,
  );

  assertMatch(
    tutorialsPage,
    /href="mailto:team@zmind\.so"/m,
    'tutorials/page.tsx: Resources panel must keep the mailto contact path.',
    errors,
  );

  if (errors.length > 0) {
    console.error('Tutorials resource contract check failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Tutorials resource contract check passed.');
}

run();
