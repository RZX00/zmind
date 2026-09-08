"use client";

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';

const ModelPricingClient = dynamic(() => import('@/components/pricing/ModelPricingClient'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-10">
      <div className="animate-pulse h-4 w-24 rounded bg-muted" />
      <span className="sr-only">loading</span>
    </div>
  ),
});

export function BillingModelPricingSection({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const t = useTranslations();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div id="model-pricing" className="pt-2">
      <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base sm:text-lg font-semibold">
              {t('pricing.model.title', { default: 'Model pricing' })}
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {t('pricing.model.desc', { default: 'See per-model pricing and examples' })}
            </p>
          </div>
          <Button
            variant={open ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setOpen((v) => !v)}
            className="whitespace-nowrap"
          >
            {open
              ? t('pricing.model.hideDetails', { default: 'Hide details' })
              : t('pricing.model.viewDetails', { default: 'View details' })}
          </Button>
        </div>
        {open && (
          <div className="mt-4">
            <ModelPricingClient />
          </div>
        )}
      </div>
    </div>
  );
}
