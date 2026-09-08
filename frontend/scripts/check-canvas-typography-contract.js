/* Guardrail for edit/render typography parity in canvas text nodes. */
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

  const globalsCss = read('src/app/globals.css');
  const markdownRenderer = read('src/canvas/components/shared/CanvasMarkdownRenderer.tsx');
  const textNodeCore = read('src/canvas/components/nodes/shared/TextNodeCore.tsx');
  const typographyTokens = read('src/canvas/domain/text-layout/textTypographyTokens.ts');
  const rhythmTokens = read('src/canvas/domain/text-layout/textMarkdownRhythm.ts');

  assertMatch(
    globalsCss,
    /\.novel-editor-shell\s+\.novel-editor-content\.canvas-inline-content\s*\{[\s\S]*?font-feature-settings:\s*'palt'\s*1,\s*'liga'\s*1;/m,
    'globals.css: canvas-inline-content must enforce font-feature-settings palt+liga.',
    errors,
  );

  assertMatch(
    globalsCss,
    /\.novel-editor-shell\s+\.novel-editor-content\.canvas-inline-content\.ProseMirror\s*\{[\s\S]*?font-feature-settings:\s*'palt'\s*1,\s*'liga'\s*1;/m,
    'globals.css: ProseMirror override for canvas-inline-content must enforce palt+liga.',
    errors,
  );

  assertMatch(
    globalsCss,
    /\.novel-editor-shell\s+\.novel-editor-content\.canvas-inline-content\s+hr\s*\{[\s\S]*?--canvas-inline-hr-margin-top[\s\S]*?--canvas-inline-hr-margin-bottom[\s\S]*?\}/m,
    'globals.css: inline hr margins must use rhythm variables.',
    errors,
  );

  assertMatch(
    markdownRenderer,
    /interface\s+CanvasMarkdownRendererProps[\s\S]*?letterSpacing\?:\s*string;/m,
    'CanvasMarkdownRenderer.tsx: renderer props must expose letterSpacing.',
    errors,
  );

  assertMatch(
    markdownRenderer,
    /\.canvas-markdown-renderer\s*\{[\s\S]*?font-feature-settings:\s*'palt'\s*1,\s*'liga'\s*1;/m,
    'CanvasMarkdownRenderer.tsx: renderer root must enforce palt+liga.',
    errors,
  );

  assertMatch(
    markdownRenderer,
    /\.canvas-markdown-renderer\s+\.canvas-markdown-hr\s*\{[\s\S]*?rhythm\.horizontalRule\.marginTopRem[\s\S]*?rhythm\.horizontalRule\.marginBottomRem[\s\S]*?\}/m,
    'CanvasMarkdownRenderer.tsx: hr spacing must be sourced from rhythm.horizontalRule.',
    errors,
  );

  assertAbsent(
    markdownRenderer,
    /hr:\s*\(\{\s*\.\.\.props\s*\}\)\s*=>\s*<hr\s+className="my-4"/m,
    'CanvasMarkdownRenderer.tsx: hr must not use hardcoded my-4 spacing.',
    errors,
  );

  assertMatch(
    textNodeCore,
    /letterSpacing=\{typography\.letterSpacing\}/m,
    'TextNodeCore.tsx: display renderer must receive typography.letterSpacing.',
    errors,
  );

  assertMatch(
    typographyTokens,
    /letterSpacing:\s*'normal'/m,
    "textTypographyTokens.ts: default letterSpacing must be 'normal'.",
    errors,
  );

  assertMatch(
    rhythmTokens,
    /horizontalRule:\s*\{\s*marginTopRem:\s*0\.6,\s*marginBottomRem:\s*0\.6,\s*\}/m,
    'textMarkdownRhythm.ts: horizontalRule rhythm token must exist and stay at 0.6/0.6.',
    errors,
  );

  assertMatch(
    rhythmTokens,
    /--canvas-inline-hr-margin-top[\s\S]*--canvas-inline-hr-margin-bottom/m,
    'textMarkdownRhythm.ts: inline hr rhythm CSS variables must be exported.',
    errors,
  );

  if (errors.length > 0) {
    console.error('Canvas typography contract check failed:');
    for (const err of errors) {
      console.error(`- ${err}`);
    }
    process.exit(1);
  }

  console.log('Canvas typography contract check passed.');
}

run();
