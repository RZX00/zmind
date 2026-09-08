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

function run() {
  const errors = [];

  const docsScroll = read('src/lib/docs-scroll.ts');
  const scrollArea = read('src/components/ui/scroll-area.tsx');
  const docsLayout = read('src/app/docs/layout.tsx');
  const toc = read('src/components/ui/table-of-contents.tsx');

  assertMatch(
    docsScroll,
    /DOCS_SCROLL_VIEWPORT_ID\s*=\s*'docs-scroll-viewport'/m,
    'docs-scroll.ts: DOCS_SCROLL_VIEWPORT_ID must stay stable.',
    errors,
  );

  assertMatch(
    scrollArea,
    /viewportProps\?:\s*React\.ComponentProps<typeof ScrollAreaPrimitive\.Viewport>/m,
    'scroll-area.tsx: ScrollArea must expose viewportProps for viewport wiring.',
    errors,
  );

  assertMatch(
    docsLayout,
    /viewportProps=\{\{\s*id:\s*DOCS_SCROLL_VIEWPORT_ID\s*\}\}/m,
    'docs/layout.tsx: docs ScrollArea must label the viewport with DOCS_SCROLL_VIEWPORT_ID.',
    errors,
  );

  assertMatch(
    toc,
    /document\.getElementById\(DOCS_SCROLL_VIEWPORT_ID\)/m,
    'table-of-contents.tsx: TOC must resolve the docs viewport by DOCS_SCROLL_VIEWPORT_ID.',
    errors,
  );

  assertMatch(
    toc,
    /if\s*\(scrollViewport\)\s*\{[\s\S]*scrollViewport\.addEventListener\('scroll',\s*throttledScroll,\s*\{\s*passive:\s*true\s*\}\);[\s\S]*\}\s*else\s*\{[\s\S]*window\.addEventListener\('scroll',\s*throttledScroll,\s*\{\s*passive:\s*true\s*\}\);[\s\S]*\}/m,
    'table-of-contents.tsx: TOC scroll subscription must prefer the viewport and only fall back to window.',
    errors,
  );

  assertMatch(
    toc,
    /if\s*\(scrollViewport\)\s*\{[\s\S]*scrollViewport\.scrollTo\(\{\s*top:\s*Math\.max\(targetPosition,\s*0\),\s*behavior:\s*'smooth',\s*\}\);[\s\S]*\}\s*else\s*\{[\s\S]*window\.scrollTo\(\{\s*top:\s*targetPosition,\s*behavior:\s*'smooth',\s*\}\);[\s\S]*\}/m,
    'table-of-contents.tsx: TOC section jumps must prefer the viewport and only fall back to window.',
    errors,
  );

  if (errors.length > 0) {
    console.error('Docs TOC scroll contract check failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Docs TOC scroll contract check passed.');
}

run();
