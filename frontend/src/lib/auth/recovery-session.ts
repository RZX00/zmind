import type { Session } from '@supabase/supabase-js';

const RECOVERY_SESSION_STORAGE_KEY = 'zmind.auth.password-recovery';
const DEFAULT_RECOVERY_TTL_MS = 60 * 60 * 1000;

type RecoverySessionSnapshot = {
  userId: string;
  validUntil: number;
};

function isBrowser() {
  return typeof window !== 'undefined';
}

function getFallbackValidUntil() {
  return Date.now() + DEFAULT_RECOVERY_TTL_MS;
}

function buildRecoverySnapshot(session: Session): RecoverySessionSnapshot {
  return {
    userId: session.user.id,
    validUntil: session.expires_at
      ? session.expires_at * 1000
      : getFallbackValidUntil(),
  };
}

function readSnapshot(): RecoverySessionSnapshot | null {
  if (!isBrowser()) {
    return null;
  }

  const raw = window.sessionStorage.getItem(RECOVERY_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RecoverySessionSnapshot>;
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.validUntil !== 'number'
    ) {
      window.sessionStorage.removeItem(RECOVERY_SESSION_STORAGE_KEY);
      return null;
    }

    return {
      userId: parsed.userId,
      validUntil: parsed.validUntil,
    };
  } catch {
    window.sessionStorage.removeItem(RECOVERY_SESSION_STORAGE_KEY);
    return null;
  }
}

export function hasPendingSupabaseAuthCallback() {
  if (!isBrowser()) {
    return false;
  }

  const url = new URL(window.location.href);
  return (
    url.searchParams.has('code') ||
    url.searchParams.has('token_hash') ||
    url.hash.includes('access_token=')
  );
}

export function markRecoverySession(session: Session) {
  if (!isBrowser()) {
    return;
  }

  window.sessionStorage.setItem(
    RECOVERY_SESSION_STORAGE_KEY,
    JSON.stringify(buildRecoverySnapshot(session)),
  );
}

export function clearRecoverySessionMarker() {
  if (!isBrowser()) {
    return;
  }

  window.sessionStorage.removeItem(RECOVERY_SESSION_STORAGE_KEY);
}

export function getRecoverySessionState(session: Session | null) {
  if (!session?.user) {
    clearRecoverySessionMarker();
    return false;
  }

  const snapshot = readSnapshot();
  if (!snapshot) {
    return false;
  }

  if (snapshot.userId !== session.user.id || snapshot.validUntil <= Date.now()) {
    clearRecoverySessionMarker();
    return false;
  }

  return true;
}

export function refreshRecoverySession(session: Session | null) {
  const isRecoverySession = getRecoverySessionState(session);
  if (isRecoverySession && session) {
    markRecoverySession(session);
  }

  return isRecoverySession;
}
