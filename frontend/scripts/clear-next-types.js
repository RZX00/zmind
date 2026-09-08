const fs = require('fs');
const path = require('path');

const nextTypesDir = path.join(__dirname, '..', '.next', 'types');

try {
  fs.rmSync(nextTypesDir, { recursive: true, force: true });
  console.log('Removed stale .next/types before running TypeScript checks.');
} catch (error) {
  if (error && error.code !== 'ENOENT') {
    throw error;
  }
}
