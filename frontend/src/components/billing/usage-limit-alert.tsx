'use client';

import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BillingModal } from './billing-modal';
import { CreditPurchaseModal } from './credit-purchase';
import { useState } from 'react';

interface BillingErrorAlertProps {
  title?: string;
  message?: string;
  creditBalance?: number;
  canPurchaseCredits?: boolean;
  tierName?: string;
  tierCredits?: number;
  primaryAction?: 'purchase_credits' | 'upgrade';
  includeSavedPrefix?: boolean;
  onDismiss: () => void;
  isOpen: boolean;
}

export function BillingErrorAlert({
  title,
  message,
  creditBalance,
  canPurchaseCredits,
  tierName,
  tierCredits,
  primaryAction,
  includeSavedPrefix = true,
  onDismiss,
  isOpen,
}: BillingErrorAlertProps) {
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);

  if (!isOpen) return null;

  const resolvedAction =
    primaryAction ?? (canPurchaseCredits ? 'purchase_credits' : 'upgrade');
  const action =
    resolvedAction === 'purchase_credits' && canPurchaseCredits === false
      ? 'upgrade'
      : resolvedAction;
  const resolvedTitle =
    title ||
    (action === 'purchase_credits' ? 'Out of credits' : 'Upgrade required');
  const baseMessage =
    message ||
    (action === 'purchase_credits'
      ? 'Add credits to continue.'
      : 'Upgrade to continue.');
  const resolvedMessage = includeSavedPrefix
    ? baseMessage.toLowerCase().includes('saved')
      ? baseMessage
      : `Your message is saved. ${baseMessage}`
    : baseMessage;
  const balanceValue =
    typeof creditBalance === 'number' && Number.isFinite(creditBalance)
      ? creditBalance
      : null;
  const balanceText =
    balanceValue !== null ? `Balance: $${balanceValue.toFixed(2)}` : null;
  const messageClass = balanceText ? 'mb-1' : 'mb-3';

  return (
    <>
      <BillingModal 
        open={showBillingModal} 
        onOpenChange={setShowBillingModal}
        showUsageLimitAlert={true}
      />
      <CreditPurchaseModal
        open={showCreditModal}
        onOpenChange={setShowCreditModal}
        currentBalance={creditBalance || 0}
        canPurchase={Boolean(canPurchaseCredits)}
        tierName={tierName}
        monthlyCredits={tierCredits || 0}
        onPurchaseComplete={() => {
          setShowCreditModal(false);
          onDismiss();
        }}
      />
      <div className="fixed bottom-4 right-4 z-[9999]">
      <div className="bg-destructive/15 backdrop-blur-sm border border-destructive/30 rounded-lg p-5 shadow-lg max-w-md">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 bg-destructive/20 p-2 rounded-full">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-start mb-2">
              <h3 className="text-sm font-semibold text-destructive">
                {resolvedTitle}
              </h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={onDismiss}
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className={`text-sm text-muted-foreground ${messageClass}`}>
              {resolvedMessage}
            </p>
            {balanceText && (
              <p className="text-xs text-muted-foreground mb-3">
                {balanceText}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onDismiss}
                className="text-xs"
              >
                Dismiss
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (action === 'purchase_credits') {
                    setShowCreditModal(true);
                  } else {
                    setShowBillingModal(true);
                  }
                }}
                className="text-xs bg-destructive hover:bg-destructive/90"
              >
                {action === 'purchase_credits' ? 'Buy credits' : 'View plans'}
              </Button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
