import {getRequestConfig} from 'next-intl/server';

const SUPPORTED_LOCALES = ['en', 'zh'] as const;

export default getRequestConfig(async ({requestLocale}) => {
  // Avoid reading the deprecated `locale` getter to prevent sync headers usage.
  // In next-intl >=3.22, `requestLocale` is a Promise<string> (not a function).
  const locale = await requestLocale;
  const safeLocale = SUPPORTED_LOCALES.includes(locale as any) ? (locale as any) : 'en';
  const fileLocale = safeLocale === 'zh' ? 'zh-CN' : 'en';
  let messages: Record<string, any> = {};
  try {
    messages = (await import(`../messages/${fileLocale}.json`)).default;
  } catch (e) {
    messages = (await import(`../messages/en.json`)).default;
  }

  // Provide locale explicitly to avoid notFound when middleware is skipped.
  return {locale: safeLocale, messages};
});
