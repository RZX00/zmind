'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  ShoppingCart, 
  Clock, 
  Infinity,
  Coins,
  AlertCircle
} from 'lucide-react';
import {useTranslations, useFormatter} from 'next-intl';
import { useCreditBalance, useSubscription } from '@/hooks/react-query/use-billing-v2';
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { CreditPurchaseModal } from '@/components/billing/credit-purchase';

interface CreditBalanceCardProps {
  showPurchaseButton?: boolean;
  compact?: boolean;
}

export function CreditBalanceCard({ 
  showPurchaseButton = true, 
  compact = false
}: CreditBalanceCardProps) {
  const { user } = useAuth();
  const { data: balance, isLoading, error } = useCreditBalance(!!user);
  const { data: subscriptionData } = useSubscription(!!user);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const t = useTranslations();
  const format = useFormatter();
  const toPoints = (amount: number) => Math.round(amount * 100);
  const formatPointsValue = (value: number) =>
    format.number(value, { maximumFractionDigits: 0, minimumFractionDigits: 0 });
  const formatPointsFromAmount = (amount: number) => formatPointsValue(toPoints(amount));

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{t('billing.balanceCard.failedLoad', {default: 'Failed to load credits'})}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-2 w-full mb-2" />
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    );
  }

  if (!balance) return null;
  const tierName = subscriptionData?.tier?.name || balance.tier;
  const isUnlimitedPlan = tierName === 'tier_25_200';
  const monthlyCredits = subscriptionData?.tier?.credits || 0;
  const canPurchaseCredits = !isUnlimitedPlan && (
    balance.can_purchase_credits || subscriptionData?.credits?.can_purchase_credits || false
  );
  const balanceDisplay = isUnlimitedPlan
    ? t('billing.unlimited', { default: 'Unlimited' })
    : formatPointsFromAmount(balance.balance);

  // Ensure we have the credit breakdown values (backwards compatibility)
  const expiringCredits = balance.expiring_credits ?? balance.balance;
  const nonExpiringCredits = balance.non_expiring_credits ?? 0;
  const hasBreakdown = balance.expiring_credits !== undefined && balance.non_expiring_credits !== undefined;

  if (compact) {
    return (
      <div className="flex items-center gap-4 p-4 rounded-lg border bg-card">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            <div>
            <p className="text-sm text-muted-foreground">{t('billing.balanceCard.creditBalance', {default: 'Credits'})}</p>
            <p className="text-2xl font-bold">
              {balanceDisplay}
              {!isUnlimitedPlan && (
                <span className="ml-1 text-xs text-muted-foreground">
                  {t('billing.balanceCard.pointsUnit', { default: 'points' })}
                </span>
              )}
            </p>
            {!isUnlimitedPlan && hasBreakdown && showPurchaseButton && canPurchaseCredits && (expiringCredits > 0 || nonExpiringCredits > 0) && (
              <div className="flex gap-3 mt-1">
                <span className="text-xs text-muted-foreground">
                  <Clock className="h-3 w-3 inline mr-1 text-orange-500" />
                  {formatPointsFromAmount(expiringCredits)}
                </span>
                <span className="text-xs text-muted-foreground">
                  <Infinity className="h-3 w-3 inline mr-1 text-green-500" />
                  {formatPointsFromAmount(nonExpiringCredits)}
                </span>
              </div>
            )}
          </div>
        </div>
        {showPurchaseButton && canPurchaseCredits && (
          <Button
            onClick={() => setShowPurchaseModal(true)}
            size="sm"
            variant="outline"
          >
            <ShoppingCart className="h-4 w-4 mr-1" />
            {t('billing.balanceCard.buyCredits', {default: 'Restore credits'})}
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <Card className='border-0 shadow-none bg-transparent p-0 mt-2'>
        <CardContent className="space-y-4 p-0">
          <div>
            <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">
                  {balanceDisplay}
                  {!isUnlimitedPlan && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {t('billing.balanceCard.pointsUnit', { default: 'points' })}
                    </span>
                  )}
              </span>
                <span className="text-sm text-muted-foreground">{t('billing.balanceCard.totalAvailable', {default: 'total available'})}</span>
              </div>
            </div>
          </div>
          {showPurchaseButton && canPurchaseCredits && (
            <div className="pt-2">
              <Button 
                onClick={() => setShowPurchaseModal(true)} 
                className="w-full"
                variant="outline"
              >
                <ShoppingCart className="h-4 w-4" />
                {t('billing.balanceCard.purchaseAdditional', {default: 'Restore monthly credits'})}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <CreditPurchaseModal
        open={showPurchaseModal}
        onOpenChange={setShowPurchaseModal}
        currentBalance={balance.balance}
        canPurchase={canPurchaseCredits}
        tierName={tierName}
        monthlyCredits={monthlyCredits}
      />
    </>
  );
} 
