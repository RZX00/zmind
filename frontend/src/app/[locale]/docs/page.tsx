import { redirect } from 'next/navigation';
import { localizePathname, normalizeLocale } from '@/i18n/locales';

export default async function LocalizedDocsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(localizePathname('/docs/introduction', normalizeLocale(locale)));
}

