export const SUPPORTED_LOCALES = ['en', 'zh'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const LOCALE_REQUEST_HEADER = 'x-next-intl-locale';

export function normalizeLocale(value?: string | null): AppLocale {
  if (!value) return 'en';
  const lower = value.toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  return 'en';
}

export function stripLocaleFromPathname(pathname?: string | null): string {
  if (!pathname || pathname === '/') return '/';

  for (const locale of SUPPORTED_LOCALES) {
    const prefix = `/${locale}`;
    if (pathname === prefix) return '/';
    if (pathname.startsWith(`${prefix}/`)) {
      const stripped = pathname.slice(prefix.length);
      return stripped.length ? stripped : '/';
    }
  }

  return pathname;
}

export function localizePathname(pathname: string, locale: AppLocale): string {
  const basePath = stripLocaleFromPathname(pathname);
  if (locale === 'en') {
    return basePath;
  }
  return basePath === '/' ? '/zh' : `/zh${basePath}`;
}

export function persistLocalePreference(locale: AppLocale) {
  if (typeof document === 'undefined') return;
  const maxAge = 60 * 60 * 24 * 365; // 1 year
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}
