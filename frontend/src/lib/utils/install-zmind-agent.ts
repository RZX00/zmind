import { apiClient } from '@/lib/api-client';

const INSTALL_DONE_KEY_PREFIX = 'zmind_agent_install_done:';
const INSTALL_RETRY_AT_KEY_PREFIX = 'zmind_agent_install_retry_at:';
const INSTALL_RETRY_COOLDOWN_MS = 15 * 60 * 1000;
const inFlightInstalls = new Map<string, Promise<boolean>>();

const safeStorageGet = (key: string): string | null => {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeStorageSet = (key: string, value: string) => {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage write failures
  }
};

const safeStorageRemove = (key: string) => {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage write failures
  }
};

async function installZmindForNewUser(_userId: string) {
  try {
    const resp = await apiClient.post(
      '/api/admin/install-zmind-agent',
      undefined,
      {
        showErrors: false,
      },
    );

    if (!resp.success) {
      console.warn(
        '[install-zmind-agent] Install request did not succeed:',
        resp.error?.message || 'Unknown error',
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[install-zmind-agent] Install request failed:', error);
    return false;
  }
}

export async function checkAndInstallZmindAgent(
  userId: string,
  _userCreatedAt: string,
) {
  const doneKey = `${INSTALL_DONE_KEY_PREFIX}${userId}`;
  const retryAtKey = `${INSTALL_RETRY_AT_KEY_PREFIX}${userId}`;

  if (safeStorageGet(doneKey) === '1') {
    return true;
  }

  const retryAtRaw = safeStorageGet(retryAtKey);
  const retryAt = retryAtRaw ? Number.parseInt(retryAtRaw, 10) : 0;
  if (Number.isFinite(retryAt) && retryAt > Date.now()) {
    return false;
  }

  const inFlight = inFlightInstalls.get(userId);
  if (inFlight) {
    return inFlight;
  }

  const run = (async () => {
    try {
      const success = await installZmindForNewUser(userId);
      if (success) {
        safeStorageSet(doneKey, '1');
        safeStorageRemove(retryAtKey);
      } else {
        safeStorageSet(
          retryAtKey,
          String(Date.now() + INSTALL_RETRY_COOLDOWN_MS),
        );
      }
      return success;
    } catch (error) {
      console.warn('[install-zmind-agent] check failed:', error);
      safeStorageSet(
        retryAtKey,
        String(Date.now() + INSTALL_RETRY_COOLDOWN_MS),
      );
      return false;
    }
  })().finally(() => {
    inFlightInstalls.delete(userId);
  });

  inFlightInstalls.set(userId, run);
  return run;
}
