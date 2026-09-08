const STORAGE_KEY = 'canvas_client_session_id';

const makeClientRequestId = (prefix: string): string => {
  try {
    const cryptoObj: any = (globalThis as any).crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
      return `${prefix}_${cryptoObj.randomUUID()}`;
    }
  } catch {}
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

export const getCanvasClientSessionId = (): string | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    const existing = window.sessionStorage.getItem(STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const next = makeClientRequestId('canvas_session');
    window.sessionStorage.setItem(STORAGE_KEY, next);
    return next;
  } catch {
    return makeClientRequestId('canvas_session');
  }
};
