const { readJournalEntries } = require('./journalService');

async function detectUncommittedIntents(vaultPath, canvasId) {
  const entries = await readJournalEntries(vaultPath, canvasId);
  const intents = entries.filter((entry) => entry.kind === 'intent');
  const commits = new Set(
    entries
      .filter((entry) => entry.kind === 'commit')
      .map((entry) => `${entry.expectedRevision || ''}:${entry.nextRevision || ''}:${entry.operation || ''}`)
  );

  return intents.filter((intent) => {
    const key = `${intent.expectedRevision || ''}:${intent.nextRevision || ''}:${intent.operation || ''}`;
    return !commits.has(key);
  });
}

module.exports = {
  detectUncommittedIntents,
};
