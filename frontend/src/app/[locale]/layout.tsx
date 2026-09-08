import {setRequestLocale} from 'next-intl/server';
import {NextIntlClientProvider} from 'next-intl';
import {normalizeLocale, AppLocale} from '@/i18n/locales';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export function generateStaticParams() {
  return [{locale: 'en'}, {locale: 'zh'}];
}

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{locale: 'en' | 'zh'}>;
}) {
  // Next 15 dynamic APIs require awaiting params
  const {locale: rawLocale} = await params;
  const locale: AppLocale = normalizeLocale(rawLocale);
  setRequestLocale(locale);
  const messages = locale === 'zh'
    ? (await import('../../messages/zh-CN.json')).default
    : (await import('../../messages/en.json')).default;
  
  // Type assertion to make TypeScript happy without affecting runtime
  const typedMessages = messages as {[key: string]: any};
  
  return (
    <NextIntlClientProvider locale={locale} messages={typedMessages}>
      {children}
    </NextIntlClientProvider>
  );
}
