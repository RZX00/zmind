import { SERVER_URL } from './Server';

const EXPLICIT_PUBLIC_WEB_URL =
  process.env.EXPO_PUBLIC_PUBLIC_WEB_URL || process.env.EXPO_PUBLIC_FRONTEND_URL;

function normalizeUrl(url: string) {
  return url.replace(/\/$/, '');
}

function stripApiSuffix(url: string) {
  return normalizeUrl(url).replace(/\/api\/?$/, '');
}

export function getPublicWebUrl() {
  if (EXPLICIT_PUBLIC_WEB_URL) {
    return normalizeUrl(EXPLICIT_PUBLIC_WEB_URL);
  }

  if (__DEV__) {
    return 'http://localhost:3000';
  }

  return stripApiSuffix(SERVER_URL);
}
