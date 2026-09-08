"use client";

import React, { useMemo } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { TopupSection } from '@/components/billing/topup-section';
import CreditTransactions from '@/components/billing/credit-transactions';
import { BillingModelPricingSection } from '@/components/billing/model-pricing-section';
import { useSubscriptionContext } from '@/contexts/SubscriptionContext';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccountBySlug } from '@/hooks/react-query';
import { buildTeamScopedPath } from '@/lib/workspace-path';
import { toPoints, formatPoints as formatPointsValue } from '@/lib/billing/format';

const normalizePlanName = (value?: string | null) => {
  if (!value) return 'Free';
  const key = value.toLowerCase();
  if (key.includes('plus') || key === 'tier_2_20') return 'Plus';
  if (key.includes('pro') || key === 'tier_6_50') return 'Pro';
  if (
    key.includes('max') ||
    key.includes('ultra') ||
    ['tier_12_100', 'tier_25_200', 'tier_50_400', 'tier_125_800', 'tier_200_1000'].includes(key)
  ) {
    return 'MAX';
  }
  if (key.includes('free') || key === 'none') return 'Free';
  return value;
};

const parseDate = (value?: string | number | null) => {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value * 1000);
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return new Date(numeric * 1000);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

export default function PricingPageClient() {
  const format = useFormatter();
  const t = useTranslations('billing.page');
  const tBilling = useTranslations('billing');
  const params = useParams<{ accountSlug?: string }>();
  const accountSlug = typeof params?.accountSlug === 'string' ? params.accountSlug : undefined;
  const isTeamWorkspace = Boolean(accountSlug);
  const { subscriptionData, creditBalance, isLoading, error, refetch, refetchBalance } = useSubscriptionContext();
  const {
    data: teamAccount,
    isLoading: isTeamAccountLoading,
    error: teamAccountError,
  } = useAccountBySlug(accountSlug ?? '');

  const returnUrl = useMemo(() => {
    const fallbackReturnUrl = accountSlug ? buildTeamScopedPath('/subscription', accountSlug) : '/subscription';
    if (typeof window === 'undefined') return fallbackReturnUrl;
    try {
      return window.location.href || fallbackReturnUrl;
    } catch {
      return fallbackReturnUrl;
    }
  }, [accountSlug]);

  const isTeamOwner =
    !isTeamWorkspace ||
    Boolean(teamAccount) &&
      (teamAccount.account_role === 'owner' || teamAccount.is_primary_owner === true);
  const canManageBillingMutations = !isTeamWorkspace || (Boolean(teamAccount) && isTeamOwner);
  const showOwnerOnlyNotice = isTeamWorkspace && !isTeamAccountLoading && !canManageBillingMutations;

  const summary = useMemo(() => {
    if (!subscriptionData) return null;
    const plan = normalizePlanName(
      subscriptionData.display_plan_name || subscriptionData.plan_name || subscriptionData.tier?.name,
    );
    const nextRefresh =
      parseDate(creditBalance?.next_credit_grant) ||
      parseDate(subscriptionData.subscription?.current_period_end);
    return {
      plan,
      nextRefresh,
      tierCredits: subscriptionData.credits?.tier_credits ?? subscriptionData.tier?.credits ?? 0,
    };
  }, [subscriptionData, creditBalance]);

  const isUnlimitedPlan = subscriptionData?.tier?.name === 'tier_25_200';
  const expiringCredits = creditBalance?.expiring_credits ?? subscriptionData?.credits?.balance ?? 0;
  const nonExpiringCredits = creditBalance?.non_expiring_credits ?? 0;
  const totalAvailable = creditBalance?.balance ?? expiringCredits + nonExpiringCredits;
  const periodTotal = summary?.tierCredits ?? 0;
  const periodRemaining = periodTotal > 0 ? Math.min(expiringCredits, periodTotal) : expiringCredits;
  const usedCredits = Math.max(periodTotal - periodRemaining, 0);
  const progressValue = periodTotal > 0 ? Math.min((usedCredits / periodTotal) * 100, 100) : 0;
  const nextRefreshText = summary?.nextRefresh
    ? format.dateTime(summary.nextRefresh, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <div className="dashboard-page">
      <div className="dashboard-container-wide space-y-10">
        {canManageBillingMutations && (
          <div className="w-full max-w-5xl mx-auto">
            <TopupSection
              returnUrl={returnUrl}
              onTopupComplete={() => {
                refetch();
                refetchBalance();
              }}
            />
          </div>
        )}

        <div className="w-full max-w-5xl mx-auto space-y-10">
          {showOwnerOnlyNotice && (
            <Alert>
              <AlertTitle>
                {t('teamOwnerOnlyTitle', { default: 'Owner-only billing controls' })}
              </AlertTitle>
              <AlertDescription>
                {teamAccountError
                  ? t('teamRoleCheckFailed', {
                      default: 'Billing actions are hidden because your team role could not be verified.',
                    })
                  : t('teamOwnerOnlyDescription', {
                      default: 'You can review team billing status, but only workspace owners can buy points.',
                    })}
              </AlertDescription>
            </Alert>
          )}

          {isLoading ? (
            <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
              <div className="dashboard-panel p-6 space-y-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
              <div className="dashboard-panel p-6 space-y-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-10 w-40" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertTitle>{t('error', { default: 'Error' })}</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
              <div className="dashboard-panel p-6 flex flex-col justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('currentPlan', { default: 'Current plan' })}
                  </p>
                  <p className="text-2xl font-semibold text-foreground">
                    {summary?.plan || 'Free'}
                  </p>
                  {nextRefreshText && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t('nextRefresh', {
                        date: nextRefreshText,
                        default: 'Next refresh: {date}',
                      })}
                    </p>
                  )}
                </div>
              </div>
              <div className="dashboard-panel p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('availableCredits', { default: 'Available credits' })}
                    </p>
                    <p className="text-3xl font-semibold text-foreground">
                      {isUnlimitedPlan ? tBilling('unlimited', { default: 'Unlimited' }) : formatPointsValue(toPoints(totalAvailable))}
                      {!isUnlimitedPlan && (
                        <span className="ml-1 text-sm text-muted-foreground">
                          {t('pointsUnit', { default: 'points' })}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('totalCredits', { default: 'Plan total' })}{' '}
                      {isUnlimitedPlan
                        ? tBilling('unlimited', { default: 'Unlimited' })
                        : `${formatPointsValue(toPoints(periodTotal))} ${t('pointsUnit', { default: 'points' })}`}
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {isUnlimitedPlan ? (
                    <p className="text-xs text-muted-foreground">
                      {tBilling('unlimited', { default: 'Unlimited' })} {t('pointsUnit', { default: 'points' })}
                    </p>
                  ) : (
                    <>
                      <Progress value={progressValue} />
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          {t('usedCredits', {
                            used: formatPointsValue(toPoints(usedCredits)),
                            total: formatPointsValue(toPoints(periodTotal)),
                            default: 'Used {used} / {total}',
                          })}
                        </span>
                        {nonExpiringCredits > 0 && (
                          <span>
                            {t('extraCredits', {
                              amount: formatPointsValue(toPoints(nonExpiringCredits)),
                              default: 'Extra credits {amount}',
                            })}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          <CreditTransactions collapsedDefault collapsedCount={5} hideBalanceSummary />

          <BillingModelPricingSection />
        </div>
      </div>
    </div>
  );
}
