'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {useTranslations} from 'next-intl';

export default function EnterpriseRedirectPage() {
  const router = useRouter();
  const t = useTranslations();

  useEffect(() => {
    router.replace('/subscription');
  }, [router]);

  return (
    <main className="flex flex-col items-center justify-center min-h-[60vh] w-full p-8 text-center">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{t('enterprise.redirecting')}</h1>
        <p className="text-muted-foreground">{t('enterprise.moved')}</p>
        <Button onClick={() => router.push('/subscription')}>{t('enterprise.goPricing')}</Button>
      </div>
    </main>
  );
}

