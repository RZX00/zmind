'use client';

import { ThemeSwitcher } from '@/components/theme/theme-switcher';
import { useTranslations } from 'next-intl';

export function ThemeToggle() {
  const t = useTranslations('common');

  return (
    <ThemeSwitcher
      variant="outline"
      size="icon"
      className="cursor-pointer rounded-full h-8 w-8 text-primary"
      tooltip={t('theme', { default: 'Theme' })}
    />
  );
}
