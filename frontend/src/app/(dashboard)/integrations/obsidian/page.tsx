'use client';

import { useTranslations } from 'next-intl';
import ObsidianHub from '@/components/integrations/obsidian/ObsidianHub';

export default function ObsidianIntegrationPage() {
  const t = useTranslations('obsidianIntegration.page');

  return (
    <div className="h-full w-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <ObsidianHub />
      </div>
    </div>
  );
}
