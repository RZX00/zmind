const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function get(obj, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value?.[key], obj);
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function assertIncludes(source, snippet, message, errors) {
  assert(source.includes(snippet), message, errors);
}

function assertExcludes(source, snippet, message, errors) {
  assert(!source.includes(snippet), message, errors);
}

function parseJson(relPath, errors) {
  const raw = read(relPath);
  try {
    return { raw, value: JSON.parse(raw) };
  } catch (error) {
    errors.push(`${relPath}: invalid JSON (${error.message})`);
    return { raw, value: null };
  }
}

function run() {
  const errors = [];

  const zhMessages = parseJson('src/messages/zh-CN.json', errors);
  const enMessages = parseJson('src/messages/en.json', errors);
  const canvasGuide = read('src/app/docs/canvas-guide/page.tsx');
  const navbar = read('src/components/home/sections/navbar.tsx');

  for (const [file, source] of [
    ['src/messages/zh-CN.json', zhMessages.raw],
    ['src/messages/en.json', enMessages.raw],
    ['src/app/docs/canvas-guide/page.tsx', canvasGuide],
    ['src/components/home/sections/navbar.tsx', navbar],
  ]) {
    assertExcludes(
      source,
      '\uFFFD',
      `${file}: contains Unicode replacement characters.`,
      errors,
    );
  }

  if (zhMessages.value) {
    assert(
      get(zhMessages.value, 'userMenu.languageToggle') === '中文 / English',
      'src/messages/zh-CN.json: userMenu.languageToggle must stay readable.',
      errors,
    );
    assert(
      get(zhMessages.value, 'tutorialsBanner.title') === '第一次使用 Zmind？从这里开始',
      'src/messages/zh-CN.json: tutorialsBanner.title must stay readable.',
      errors,
    );
    assert(
      get(zhMessages.value, 'teamSettings.url.copySuccess') === '链接已复制',
      'src/messages/zh-CN.json: teamSettings.url.copySuccess must stay readable.',
      errors,
    );
  }

  if (enMessages.value) {
    assert(
      get(enMessages.value, 'userMenu.languageToggle') === '中文 / English',
      'src/messages/en.json: userMenu.languageToggle must stay readable.',
      errors,
    );
    assert(
      get(enMessages.value, 'tutorialsBanner.title') === 'New to Zmind? Start here',
      'src/messages/en.json: tutorialsBanner.title must stay readable.',
      errors,
    );
    assert(
      get(enMessages.value, 'teamSettings.url.copySuccess') === 'Link copied',
      'src/messages/en.json: teamSettings.url.copySuccess must stay readable.',
      errors,
    );
  }

  assertIncludes(
    canvasGuide,
    "title=\"画布使用指南\"",
    'src/app/docs/canvas-guide/page.tsx: title must stay readable.',
    errors,
  );
  assertIncludes(
    canvasGuide,
    "subtitle=\"用最少的步骤完成最多的事\"",
    'src/app/docs/canvas-guide/page.tsx: subtitle must stay readable.',
    errors,
  );
  assertIncludes(
    canvasGuide,
    '<h2 id="quick-start">快速上手</h2>',
    'src/app/docs/canvas-guide/page.tsx: quick-start heading must stay readable.',
    errors,
  );
  for (const snippet of [
    '鐢诲竷浣跨敤鎸囧崡',
    '蹇€熶笂鎵',
    '缂栬緫涓庢暣鐞',
    '鑷姩淇濆瓨',
  ]) {
    assertExcludes(
      canvasGuide,
      snippet,
      `src/app/docs/canvas-guide/page.tsx: found known mojibake fragment "${snippet}".`,
      errors,
    );
  }

  assertIncludes(
    navbar,
    '<span className="text-xs">中文</span>',
    'src/components/home/sections/navbar.tsx: Chinese locale label must stay readable.',
    errors,
  );
  assertIncludes(
    navbar,
    '<span className="text-xs">English</span>',
    'src/components/home/sections/navbar.tsx: English locale label must stay readable.',
    errors,
  );

  if (errors.length > 0) {
    console.error('Public copy integrity check failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Public copy integrity check passed.');
}

run();
