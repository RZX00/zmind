/* Simple checker for duplicate top-level namespaces in messages */
const fs = require('fs');
const path = require('path');

function checkFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  // naive parse to find top-level keys; not a full JSON parser
  // works well for our formatted files
  const stack = [];
  const re = /\{|\}|"([^"]+)"\s*:/g;
  let m;
  let depth = 0;
  const keys = [];
  while ((m = re.exec(text))) {
    if (m[0] === '{') { depth++; continue; }
    if (m[0] === '}') { depth--; continue; }
    if (depth === 1) { keys.push(m[1]); }
  }
  const seen = new Map();
  const dupes = new Set();
  for (const k of keys) {
    if (seen.has(k)) dupes.add(k);
    else seen.set(k, 1);
  }
  if (dupes.size > 0) {
    console.warn(`Duplicate top-level namespaces in ${file}: ${Array.from(dupes).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`No duplicates in ${file}`);
  }
}

const base = path.join(__dirname, '..', 'src', 'messages');
checkFile(path.join(base, 'en.json'));
checkFile(path.join(base, 'zh-CN.json'));

