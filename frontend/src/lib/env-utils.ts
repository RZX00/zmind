const warned = new Set<string>();

const warnOnce = (key: string, message: string) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
};

const PUBLIC_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
  NEXT_PUBLIC_CANVAS_REALTIME_URL: process.env.NEXT_PUBLIC_CANVAS_REALTIME_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
};

const readEnvRaw = (key: string): string | undefined => {
  if (key.startsWith('NEXT_PUBLIC_')) {
    return PUBLIC_ENV[key];
  }
  if (typeof window !== 'undefined') {
    return undefined;
  }
  return process.env[key];
};

export const requiredEnv = (key: string): string => {
  const value = readEnvRaw(key);
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
};

export const requiredOneOf = (keys: string[]): string => {
  for (const key of keys) {
    const value = readEnvRaw(key);
    if (value && value.trim()) return value.trim();
  }
  throw new Error(`Missing required environment variable. Set one of: ${keys.join(', ')}`);
};

export const optionalEnv = (key: string): string | undefined => {
  const value = readEnvRaw(key);
  if (!value || !value.trim()) {
    warnOnce(key, `Optional environment variable ${key} is not set.`);
    return undefined;
  }
  return value.trim();
};

export const requiredServerEnv = (key: string): string => {
  if (typeof window !== 'undefined') {
    throw new Error(`Environment variable ${key} is server-only and cannot be read in the browser.`);
  }
  return requiredEnv(key);
};
