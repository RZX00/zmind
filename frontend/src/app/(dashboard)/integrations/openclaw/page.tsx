'use client';

import { useTranslations } from 'next-intl';
import OpenClawHub from '@/components/integrations/openclaw/OpenClawHub';

export default function OpenClawIntegrationPage() {
  const t = useTranslations('openclawIntegration.page');

  return (
    <div className="h-full w-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <OpenClawHub />
      </div>
    </div>
  );
}
