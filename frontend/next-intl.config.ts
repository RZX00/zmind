import {defineRouting} from 'next-intl/routing';

export default defineRouting({
  locales: ['en', 'zh'],
  defaultLocale: 'en',
  localePrefix: 'as-needed'
});
