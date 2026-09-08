const path = require('path');

function loadApplicationModule() {
  const candidates = [
    path.resolve(__dirname, '..', 'vendor', 'canvas-application', 'src'),
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

  throw new Error(`Failed to load local canvas application module.\n${errors.join('\n')}`);
}

module.exports = {
  loadApplicationModule,
};
