export function normalizeStoragePath(rawPath: string): string {
  if (!rawPath) return '';
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    decoded = rawPath;
  }
  return decoded.replace(/^\/+/, '');
}

export function encodeStoragePath(rawPath: string): string {
  const normalized = normalizeStoragePath(rawPath);
  if (!normalized) return '';
  return normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
