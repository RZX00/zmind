'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TopupSection } from '@/components/billing/topup-section';
import { isLocalMode } from '@/lib/config';
import { useTranslations } from 'next-intl';

interface BillingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnUrl?: string;
  showUsageLimitAlert?: boolean;
}

export function BillingModal({
  open,
  onOpenChange,
  returnUrl = typeof window !== 'undefined' ? window?.location?.href || '/' : '/',
}: BillingModalProps) {
  const t = useTranslations();

  if (isLocalMode()) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('billing.modal.title')}</DialogTitle>
          </DialogHeader>
          <div className="p-4 bg-muted/30 border border-border rounded-lg text-center">
            <p className="text-sm text-muted-foreground">
              Running in local development mode - billing features are disabled
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('billing.modal.title')}</DialogTitle>
        </DialogHeader>
        <TopupSection returnUrl={returnUrl} onTopupComplete={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
