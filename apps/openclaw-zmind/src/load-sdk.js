const path = require('path');

function loadZMindSdk() {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'packages', 'zmind-sdk', 'src'),
    '@zmind/sdk',
  ];

  const errors = [];
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      return require(candidate);
    } catch (error) {
      errors.push(`${candidate}: ${error && error.message ? error.message : String(error)}`);
    }
  }

  throw new Error(`Failed to load ZMind SDK.\n${errors.join('\n')}`);
}

module.exports = {
  loadZMindSdk,
};
