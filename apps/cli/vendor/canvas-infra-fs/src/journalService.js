const fs = require('fs');
const crypto = require('crypto');

const { getJournalPath } = require('./paths');

async function appendJournalEntry(options) {
  const {
    vaultPath,
    canvasId,
    kind,
    operation,
    expectedRevision,
    nextRevision,
    payload,
    nowProvider,
  } = options;

  const entry = {
    journalVersion: 1,
    entryId: crypto.randomUUID(),
    canvasId,
    kind,
    operation: operation || null,
    expectedRevision: expectedRevision || null,
    nextRevision: nextRevision || null,
    payload: payload || null,
    createdAt: (typeof nowProvider === 'function' ? nowProvider() : new Date()).toISOString(),
  };

  const journalPath = getJournalPath(vaultPath, canvasId);
  await fs.promises.mkdir(require('path').dirname(journalPath), { recursive: true });
  await fs.promises.appendFile(journalPath, `${JSON.stringify(entry)}\n`, 'utf8');

  return entry;
}

async function readJournalEntries(vaultPath, canvasId) {
  const journalPath = getJournalPath(vaultPath, canvasId);
  try {
    const raw = await fs.promises.readFile(journalPath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

module.exports = {
  appendJournalEntry,
  readJournalEntries,
};
