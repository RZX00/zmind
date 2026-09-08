import {defineRouting} from 'next-intl/routing';

// Root-level next-intl config to ensure discovery even when Next runs from a different CWD
export default defineRouting({
  locales: ['en', 'zh'],
  defaultLocale: 'en',
  localePrefix: 'as-needed'
});
