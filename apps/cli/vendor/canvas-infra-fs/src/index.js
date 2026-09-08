const vaultRepository = require('./vaultRepository');
const lockService = require('./lockService');
const journalService = require('./journalService');
const backupService = require('./backupService');
const recoveryService = require('./recoveryService');
const paths = require('./paths');

module.exports = {
  ...vaultRepository,
  ...lockService,
  ...journalService,
  ...backupService,
  ...recoveryService,
  ...paths,
};
