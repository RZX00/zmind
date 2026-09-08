import { createNavigation } from 'next-intl/navigation';

export const locales = ['en', 'zh'] as const;
export type Locale = (typeof locales)[number];

// Prefix only non-default locale
export const localePrefix = 'as-needed';
export const defaultLocale: Locale = 'en';

export const {Link, redirect, usePathname, useRouter} = createNavigation({
  locales,
  localePrefix,
  defaultLocale,
});
