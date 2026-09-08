export type RunMode = 'agent' | 'chat';

export const RUN_MODE_STORAGE_KEY = 'zmind:run-mode';
export const RUN_MODE_EVENT = 'zmind:run-mode-change';

export function normalizeRunMode(value?: string | null): RunMode {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'chat' ? 'chat' : 'agent';
}

export function getStoredRunMode(): RunMode {
  if (typeof window === 'undefined') return 'agent';
  try {
    return normalizeRunMode(window.localStorage.getItem(RUN_MODE_STORAGE_KEY));
  } catch {
    return 'agent';
  }
}

export function setStoredRunMode(mode: RunMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RUN_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore persistence failures (private mode, storage disabled).
  }
  try {
    window.dispatchEvent(new CustomEvent(RUN_MODE_EVENT, { detail: { mode } }));
  } catch {
    // Ignore event dispatch failures.
  }
}
