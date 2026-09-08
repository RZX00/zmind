'use client';

import { useState } from 'react';
import {useFormatter, useTranslations} from 'next-intl';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertCircle,
  Clock,
  Infinity,
  Plus,
  Minus,
} from 'lucide-react';
import { useTransactions } from '@/hooks/react-query/billing/use-transactions';
import { cn } from '@/lib/utils';

interface Props {
  accountId?: string;
  collapsedDefault?: boolean; // if true, show only a few rows with a Show more button
  collapsedCount?: number; // how many rows to show when collapsed (default 5)
  hideBalanceSummary?: boolean;
}

export default function CreditTransactions({
  accountId,
  collapsedDefault = false,
  collapsedCount = 5,
  hideBalanceSummary = false,
}: Props) {
  const format = useFormatter();
  const t = useTranslations();
  const [offset, setOffset] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [showAll, setShowAll] = useState(!collapsedDefault);
  const limit = 50;

  const { data, isLoading, error } = useTransactions(limit, offset, typeFilter);

  const formatDate = (dateString: string) => format.dateTime(new Date(dateString), {year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});

  const toPoints = (amount: number) => Math.round(amount * 100);
  const formatPoints = (amount: number) =>
    format.number(toPoints(amount), { maximumFractionDigits: 0, minimumFractionDigits: 0 });

  const formatAmount = (amount: number) => {
    const points = toPoints(amount);
    const formatted = format.number(Math.abs(points), {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
    return points >= 0 ? `+${formatted}` : `-${formatted}`;
  };

  const formatBalance = (balance: number) => formatPoints(balance);

  const normalizeModelId = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return trimmed;
    const parts = trimmed.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : trimmed;
  };

  const replaceFirstModelToken = (text: string, modelId?: string) => {
    if (!text) return text;
    if (modelId && text.includes(modelId)) {
      return text.replace(modelId, normalizeModelId(modelId));
    }
    const match = text.match(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/);
    if (!match) return text;
    const token = match[1];
    if (token.startsWith('http') || token.includes('://')) return text;
    return text.replace(token, normalizeModelId(token));
  };

  const formatUsageDescription = (tx: { description?: string; type?: string; metadata?: Record<string, any> }) => {
    const description = tx.description;
    if (!description) return description;
    if (tx.type !== 'usage') return description;
    const modelFromMeta = typeof tx.metadata?.model === 'string' ? tx.metadata.model : undefined;
    const match = description.match(/^(Usage:\s*)([^\s(]+)(.*)$/i);
    if (match) {
      const [, prefix, modelId, rest] = match;
      return `${prefix}${normalizeModelId(modelId)}${rest}`;
    }
    return replaceFirstModelToken(description, modelFromMeta);
  };

  const getTransactionIcon = (type: string, amount: number) => {
    if (amount > 0) {
      return <Plus className="h-4 w-4 text-green-500" />;
    }
    if (type === 'usage') {
      return <Minus className="h-4 w-4 text-orange-500" />;
    }
    if (type === 'expired') {
      return <Clock className="h-4 w-4 text-red-500" />;
    }
    return <Minus className="h-4 w-4 text-red-500" />;
  };

  const getTransactionBadge = (type: string) => {
    const labels: Record<string, string> = {
      'tier_grant': t('billing.transactions.badges.tier_grant', { default: 'Tier Grant' }),
      'purchase': t('billing.transactions.badges.purchase', { default: 'Purchase' }),
      'admin_grant': t('billing.transactions.badges.admin_grant', { default: 'Admin Grant' }),
      'promotional': t('billing.transactions.badges.promotional', { default: 'Promotional' }),
      'welcome_bonus': t('billing.transactions.badges.welcome_bonus', { default: 'Welcome Bonus' }),
      'daily_login': t('billing.transactions.badges.daily_login', { default: 'Daily Login' }),
      'usage': t('billing.transactions.badges.usage', { default: 'Usage' }),
      'refund': t('billing.transactions.badges.refund', { default: 'Refund' }),
      'adjustment': t('billing.transactions.badges.adjustment', { default: 'Adjustment' }),
      'expired': t('billing.transactions.badges.expired', { default: 'Expired' }),
      'expiration': t('billing.transactions.badges.expired', { default: 'Expired' }),
      'initial': t('billing.transactions.badges.initial', { default: 'Initial' }),
    };
    const badges: Record<string, { label: string; variant: any }> = {
      'tier_grant': { label: labels.tier_grant, variant: 'default' },
      'purchase': { label: labels.purchase, variant: 'default' },
      'admin_grant': { label: labels.admin_grant, variant: 'secondary' },
      'promotional': { label: labels.promotional, variant: 'secondary' },
      'welcome_bonus': { label: labels.welcome_bonus, variant: 'secondary' },
      'daily_login': { label: labels.daily_login, variant: 'secondary' },
      'usage': { label: labels.usage, variant: 'outline' },
      'refund': { label: labels.refund, variant: 'secondary' },
      'adjustment': { label: labels.adjustment, variant: 'outline' },
      'expired': { label: labels.expired, variant: 'destructive' },
      'expiration': { label: labels.expired, variant: 'destructive' },
      'initial': { label: labels.initial, variant: 'secondary' },
    };

    const badge = badges[type] || { label: type, variant: 'outline' };
    return <Badge variant={badge.variant as any}>{badge.label}</Badge>;
  };

  const handlePrevPage = () => {
    setOffset(Math.max(0, offset - limit));
  };

  const handleNextPage = () => {
    if (data?.pagination.has_more) {
      setOffset(offset + limit);
    }
  };

  if (isLoading && offset === 0) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('billing.transactions.title', {default: 'Credits Activity'})}</CardTitle>
            <CardDescription>{t('billing.transactions.loading', {default: 'Loading your transaction history...'})}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('billing.transactions.title', {default: 'Credits Activity'})}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t('billing.transactions.error', {default: 'Error'})}</AlertTitle>
            <AlertDescription>
              {error.message || t('billing.transactions.failedLoad', {default: 'Failed to load transactions'})}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const currentBalance = data?.current_balance;
  const transactions = data?.transactions || [];
  const displayedTransactions = showAll ? transactions : transactions.slice(0, collapsedCount);
  const isUnlimitedPlan = currentBalance?.tier === 'tier_25_200';
  const unlimitedLabel = t('billing.unlimited', { default: 'Unlimited' });

  return (
    <div className="space-y-6">
      {currentBalance && !hideBalanceSummary && (
        <Card>
          <CardHeader>
            <CardTitle>{t('billing.transactions.currentBalanceTitle', {default: 'Credits Overview'})}</CardTitle>
            <CardDescription>{t('billing.transactions.breakdown', {default: 'Your credits breakdown'})}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-2xl font-bold">
                  {isUnlimitedPlan ? unlimitedLabel : formatBalance(currentBalance.total)}
                </div>
                <p className="text-xs text-muted-foreground">{t('billing.transactions.totalBalance', {default: 'Total Credits'})}</p>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-orange-500" />
                  <span className="text-lg font-semibold">
                    {isUnlimitedPlan ? unlimitedLabel : formatBalance(currentBalance.expiring)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{t('billing.transactions.expiringCredits', {default: 'Expiring Credits'})}</p>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Infinity className="h-4 w-4 text-brand-500" />
                  <span className="text-lg font-semibold">
                    {isUnlimitedPlan ? unlimitedLabel : formatBalance(currentBalance.non_expiring)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{t('billing.transactions.nonExpiringCredits', {default: 'Non-Expiring Credits'})}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <Card className='p-0 px-0 bg-transparent shadow-none border-none'>
        <CardHeader className='px-0'>
          <CardTitle>{t('billing.transactions.historyTitle', {default: 'Transaction History'})}</CardTitle>
          <CardDescription>
            {t('billing.transactions.historyDesc', {default: 'All credit additions and deductions'})}
          </CardDescription>
        </CardHeader>
        <CardContent className='px-0'>
          {transactions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                {typeFilter ? t('billing.transactions.noneFiltered', {type: typeFilter, default: `No ${typeFilter} transactions found.`}) : t('billing.transactions.none', {default: 'No transactions found.'})}
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">{t('billing.transactions.table.date', {default: 'Date'})}</TableHead>
                      <TableHead>{t('billing.transactions.table.type', {default: 'Type'})}</TableHead>
                      <TableHead>{t('billing.transactions.table.description', {default: 'Description'})}</TableHead>
                      <TableHead className="text-center">{t('billing.transactions.table.creditType', {default: 'Credit Type'})}</TableHead>
                      <TableHead className="text-right">{t('billing.transactions.table.amount', {default: 'Amount'})}</TableHead>
                      <TableHead className="text-right">{t('billing.transactions.table.balanceAfter', {default: 'Remaining credits'})}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedTransactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="font-mono text-xs">
                          {formatDate(tx.created_at)}
                        </TableCell>
                        <TableCell>
                          {getTransactionBadge(tx.type)}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-2">
                            {getTransactionIcon(tx.type, tx.amount)}
                            {formatUsageDescription(tx) ||
                              t('billing.transactions.table.noDescription', {default: 'No description'})}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {tx.is_expiring !== undefined && (
                            <div className="flex items-center justify-center gap-1">
                              {tx.is_expiring ? (
                                <>
                                  <Clock className="h-3 w-3 text-orange-500" />
                                  <span className="text-xs text-muted-foreground">{t('billing.transactions.table.expiring', {default: 'Expiring'})}</span>
                                </>
                              ) : (
                                <>
                                  <Infinity className="h-3 w-3 text-brand-500" />
                                  <span className="text-xs text-muted-foreground">{t('billing.transactions.table.permanent', {default: 'Permanent'})}</span>
                                </>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className={cn(
                          "text-right font-mono font-semibold",
                          tx.amount >= 0 ? "text-green-600" : "text-red-600"
                        )}>
                          {formatAmount(tx.amount)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatBalance(tx.balance_after)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Collapsed footer or full pagination */}
              {!showAll ? (
                <div className="flex items-center justify-center mt-4">
                  <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
                    {t('billing.transactions.showMore', {default: 'Show more'})}
                  </Button>
                </div>
              ) : (
                data?.pagination && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      {t('billing.transactions.showing', {from: offset + 1, to: Math.min(offset + limit, data.pagination.total), total: data.pagination.total, default: `Showing ${offset + 1}-${Math.min(offset + limit, data.pagination.total)} of ${data.pagination.total} transactions`})}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePrevPage}
                        disabled={offset === 0}
                      >
                        {t('billing.transactions.previous', {default: 'Previous'})}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleNextPage}
                        disabled={!data.pagination.has_more}
                      >
                        {t('billing.transactions.next', {default: 'Next'})}
                      </Button>
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
