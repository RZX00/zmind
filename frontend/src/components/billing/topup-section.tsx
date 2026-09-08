'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { PaymentPendingDialog } from '@/components/billing/payment-pending-dialog';
import { useCreateTopupOrder, useOrderStatus } from '@/hooks/react-query/use-billing-v2';
import type { PaymentGatewayId, TopupCurrency } from '@/lib/api/billing-v2';
import {
  offersForGateway,
  defaultGatewayForLocale,
  isCustomAmountValid,
  CUSTOM_BOUNDS,
  GATEWAY_CURRENCY,
} from '@/lib/billing/topup-catalog';
import { formatPointsFromUsd } from '@/lib/billing/format';

const PAYMENT_POLL_TIMEOUT_MS = 2 * 60 * 1000;
// USD 充值 1:1 → 信用;CNY 充值的最终信用由后端按快照汇率换算,这里仅做粗略展示。
const STATIC_USD_CNY = 7;

interface TopupSectionProps {
  returnUrl: string;
  onTopupComplete?: () => void;
}

const estimateUsd = (currency: TopupCurrency, amount: number): number =>
  currency === 'USD' ? amount : amount / STATIC_USD_CNY;

export function TopupSection({ returnUrl, onTopupComplete }: TopupSectionProps) {
  const t = useTranslations();
  const locale = useLocale();

  const [gateway, setGateway] = useState<PaymentGatewayId>(() => defaultGatewayForLocale(locale));
  const currency = GATEWAY_CURRENCY[gateway];
  const offers = useMemo(() => offersForGateway(gateway), [gateway]);

  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(offers[0]?.id ?? null);
  const [customAmount, setCustomAmount] = useState<string>('');
  const isCustom = selectedOfferId === null;

  const customNumber = Number(customAmount);
  const effectiveAmount = isCustom
    ? customNumber
    : offers.find((o) => o.id === selectedOfferId)?.amount ?? 0;
  const customValid = isCustom ? isCustomAmountValid(currency, customNumber) : true;

  // 订单 / 轮询状态
  const [orderId, setOrderId] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentChecking, setPaymentChecking] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const startRef = useRef<number>(0);

  const createOrder = useCreateTopupOrder();
  const { data: orderStatus, refetch: refetchOrder } = useOrderStatus(orderId, paymentDialogOpen);

  // 当网关切换:重置选档/自定义。
  useEffect(() => {
    setSelectedOfferId(offers[0]?.id ?? null);
    setCustomAmount('');
  }, [offers]);

  const resetPayment = useCallback(() => {
    setPaymentDialogOpen(false);
    setPaymentChecking(false);
    setPaymentError(null);
    setOrderId(null);
    setQrPayload(null);
  }, []);

  // 订单到账 → 收尾。
  useEffect(() => {
    if (!paymentDialogOpen || !orderStatus) return;
    if (orderStatus.status === 'paid') {
      resetPayment();
      toast.success(
        t('billing.paymentPending.successToast', {
          default: 'Payment confirmed. Updating your account.',
        }),
      );
      onTopupComplete?.();
    } else if (orderStatus.status === 'failed' || orderStatus.status === 'cancelled' || orderStatus.status === 'expired') {
      setPaymentError(
        t('billing.paymentPending.error', {
          default: "We couldn't verify the payment yet. Please try again.",
        }),
      );
    }
  }, [orderStatus, paymentDialogOpen, resetPayment, onTopupComplete, t]);

  // focus/visibility 复查。
  useEffect(() => {
    if (!paymentDialogOpen) return;
    startRef.current = Date.now();
    const handleFocus = () => {
      if (Date.now() - startRef.current <= PAYMENT_POLL_TIMEOUT_MS) refetchOrder();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleFocus();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [paymentDialogOpen, refetchOrder]);

  const handleConfirmCheck = useCallback(async () => {
    setPaymentChecking(true);
    setPaymentError(null);
    try {
      await refetchOrder();
    } finally {
      setPaymentChecking(false);
    }
  }, [refetchOrder]);

  const handleTopup = async () => {
    if (!customValid || effectiveAmount <= 0) {
      const b = CUSTOM_BOUNDS[currency];
      setPaymentError(
        t('billing.topup.amountOutOfRange', {
          min: b.min,
          max: b.max,
          currency,
          default: `Amount must be between ${b.min} and ${b.max} ${currency}`,
        }),
      );
      return;
    }
    setPaymentError(null);
    try {
      const res = await createOrder.mutateAsync({
        gateway,
        currency,
        amount: effectiveAmount,
        offer_id: selectedOfferId,
        return_url: returnUrl,
      });
      setOrderId(res.order_id);
      if (res.gateway === 'alipay') {
        setQrPayload(res.qr_payload ?? res.checkout_url ?? null);
      }
      setPaymentDialogOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start payment';
      setPaymentError(message);
      toast.error(message);
    }
  };

  return (
    <section className="flex w-full flex-col gap-6">
      {/* 网关切换 */}
      <div className="flex items-center gap-2">
        {(['alipay', 'stripe'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGateway(g)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm transition-colors',
              gateway === g
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {g === 'alipay'
              ? t('billing.topup.gateway.alipay', { default: 'Alipay (CNY)' })
              : t('billing.topup.gateway.stripe', { default: 'Card (USD)' })}
          </button>
        ))}
      </div>

      {/* 预设档位 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {offers.map((offer) => {
          const active = selectedOfferId === offer.id;
          return (
            <Card
              key={offer.id}
              onClick={() => setSelectedOfferId(offer.id)}
              className={cn(
                'cursor-pointer transition-all',
                active ? 'ring-2 ring-primary' : 'hover:-translate-y-0.5',
              )}
            >
              <CardContent className="flex flex-col gap-1 p-4">
                <span className="text-2xl font-semibold">
                  {currency === 'USD' ? `$${offer.amount}` : `¥${offer.amount}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  ≈ {formatPointsFromUsd(estimateUsd(currency, offer.amount))}{' '}
                  {t('billing.balanceCard.pointsUnit', { default: 'points' })}
                </span>
              </CardContent>
            </Card>
          );
        })}
        {/* 自定义额度 */}
        <Card
          onClick={() => setSelectedOfferId(null)}
          className={cn('cursor-pointer transition-all', isCustom ? 'ring-2 ring-primary' : 'hover:-translate-y-0.5')}
        >
          <CardContent className="flex flex-col gap-2 p-4">
            <span className="text-xs text-muted-foreground">
              {t('billing.topup.custom', { default: 'Custom amount' })}
            </span>
            <Input
              type="number"
              inputMode="decimal"
              value={customAmount}
              onChange={(e) => {
                setSelectedOfferId(null);
                setCustomAmount(e.target.value);
              }}
              placeholder={`${CUSTOM_BOUNDS[currency].min} – ${CUSTOM_BOUNDS[currency].max}`}
            />
            {isCustom && customAmount.length > 0 && !customValid && (
              <span className="text-xs text-destructive">
                {t('billing.topup.amountOutOfRange', {
                  min: CUSTOM_BOUNDS[currency].min,
                  max: CUSTOM_BOUNDS[currency].max,
                  currency,
                  default: `Amount must be between ${CUSTOM_BOUNDS[currency].min} and ${CUSTOM_BOUNDS[currency].max} ${currency}`,
                })}
              </span>
            )}
          </CardContent>
        </Card>
      </div>

      {paymentError && !paymentDialogOpen && (
        <Alert variant="destructive">
          <AlertDescription>{paymentError}</AlertDescription>
        </Alert>
      )}

      <Button
        className="w-full sm:w-auto"
        disabled={createOrder.isPending || !customValid || effectiveAmount <= 0}
        onClick={handleTopup}
      >
        {createOrder.isPending
          ? t('billing.topup.processing', { default: 'Processing…' })
          : t('billing.topup.pay', {
              amount: currency === 'USD' ? `$${effectiveAmount}` : `¥${effectiveAmount}`,
              default: `Pay ${currency === 'USD' ? '$' : '¥'}${effectiveAmount}`,
            })}
      </Button>

      <PaymentPendingDialog
        open={paymentDialogOpen}
        title={t('billing.paymentPending.title', { default: 'Payment in progress' })}
        description={
          gateway === 'alipay'
            ? t('billing.topup.alipayScan', { default: 'Scan the QR code with Alipay to complete payment.' })
            : t('billing.paymentPending.description', {
                default: 'Complete payment in the new tab. We will update this page when it is confirmed.',
              })
        }
        statusText={
          orderStatus?.status === 'pending'
            ? t('billing.paymentPending.status.waiting', { default: 'Waiting for payment confirmation...' })
            : undefined
        }
        errorText={paymentError}
        checking={paymentChecking}
        confirmLabel={t('billing.paymentPending.actions.confirm', { default: 'I have completed payment' })}
        cancelLabel={t('billing.paymentPending.actions.cancel', { default: 'Cancel payment' })}
        onConfirm={handleConfirmCheck}
        onCancel={resetPayment}
      />

      {/* Alipay 二维码渲染在对话框打开且有 payload 时 */}
      {paymentDialogOpen && gateway === 'alipay' && qrPayload && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
          <div className="rounded-lg bg-background p-4 shadow-lg pointer-events-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrPayload)}`}
              alt="Alipay QR"
              width={220}
              height={220}
            />
          </div>
        </div>
      )}
    </section>
  );
}
