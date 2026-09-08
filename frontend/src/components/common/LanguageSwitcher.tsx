"use client";

import {useCallback, useMemo} from 'react';
import {usePathname} from '@/i18n/routing';
import {useLocale, useTranslations} from 'next-intl';
import {persistLocalePreference, localizePathname, AppLocale} from '@/i18n/locales';
import {useRouter as useNextRouter} from 'next/navigation';

const SUPPORTED = ['en', 'zh'] as const;

export default function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useNextRouter();
  const t = useTranslations('common.language');

  const current = useMemo(() => (SUPPORTED.includes(locale as any) ? locale : 'en'), [locale]);

  const switchTo = useCallback((target: AppLocale) => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const currentPathname =
      typeof window !== 'undefined' ? window.location.pathname : pathname;
    persistLocalePreference(target);
    const nextPath = localizePathname(currentPathname, target);
    router.replace(`${nextPath}${search}${hash}`);
  }, [pathname, router]);
	
  const isEN = current === 'en';

  return (
    <div className="inline-flex items-center gap-2 rounded-md border px-2 py-1 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <button
        type="button"
        onClick={() => switchTo('en')}
        className={`text-xs ${isEN ? 'font-semibold' : 'opacity-70 hover:opacity-100'} `}
        aria-pressed={isEN}
      >
        {t('english')}
      </button>
      <span className="text-muted-foreground/70">|</span>
      <button
        type="button"
        onClick={() => switchTo('zh')}
        className={`text-xs ${!isEN ? 'font-semibold' : 'opacity-70 hover:opacity-100'} `}
        aria-pressed={!isEN}
      >
        {t('chinese')}
      </button>
    </div>
  );
}
