// Migrate legacy localStorage keys to the new Zmind namespace.
// Safe: copies values to new keys if not present; does not delete old keys.

const NEW_PREFIX = 'zmind-';

const LEGACY_SUFFIXES = [
  'preferred-model-v3',
  'model-selection-v2',
  'model-selection-v3',
  'upgrade_dialog_displayed',
];

export function migrateLegacyLocalStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const FLAG = 'zmind_migration_done_v1';
    if (localStorage.getItem(FLAG)) return;

    const ensureCopied = (oldKey: string, newKey: string) => {
      const val = localStorage.getItem(oldKey);
      if (val !== null && localStorage.getItem(newKey) === null) {
        try { localStorage.setItem(newKey, val); } catch { /* ignore */ }
      }
    };

    // Generic suffix-based migration (covers any legacy prefix)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const suffix = LEGACY_SUFFIXES.find((s) => key.endsWith(s));
      if (!suffix) continue;
      const newKey = `${NEW_PREFIX}${suffix}`;
      ensureCopied(key, newKey);
    }

    localStorage.setItem(FLAG, '1');
  } catch {
    // ignore failures (private mode, quota, etc.)
  }
}

