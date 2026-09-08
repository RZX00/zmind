'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CreditCard, AlertCircle, Zap, AlertCircleIcon } from 'lucide-react';
import { toast } from 'sonner';
import { PaymentPendingDialog } from '@/components/billing/payment-pending-dialog';
import { formatPointsFromUsd, resolvePlanLabel } from '@/lib/billing/format';
import { useCreateTopupOrder, useOrderStatus } from '@/hooks/react-query/use-billing-v2';
import { defaultGatewayForLocale, GATEWAY_CURRENCY } from '@/lib/billing/topup-catalog';

interface CreditPurchaseProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentBalance?: number;
    canPurchase: boolean;
    tierName?: string;
    monthlyCredits?: number;
    onPurchaseComplete?: () => void;
}

export function CreditPurchaseModal({
    open, 
    onOpenChange, 
    currentBalance = 0,
    canPurchase,
    tierName,
    onPurchaseComplete
}: CreditPurchaseProps) {
    const t = useTranslations();
    const locale = useLocale();
    const [error, setError] = useState<string | null>(null);
    const [orderId, setOrderId] = useState<string | null>(null);
    const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
    const [paymentChecking, setPaymentChecking] = useState(false);

    const gateway = defaultGatewayForLocale(locale);
    const currency = GATEWAY_CURRENCY[gateway];
    const createOrder = useCreateTopupOrder();
    const { data: orderStatus, refetch: refetchOrder } = useOrderStatus(orderId, paymentDialogOpen);

    const planLabel = resolvePlanLabel(tierName);
    // 用所在网关的最小预设档位作为「快速充值」金额(替代旧的 monthlyCredits*0.6)。
    const quickAmount = currency === 'USD' ? 5 : 30;
    const refillPoints = formatPointsFromUsd(currency === 'USD' ? quickAmount : quickAmount / 7);

    const resetPayment = useCallback(() => {
        setPaymentDialogOpen(false);
        setPaymentChecking(false);
        setOrderId(null);
    }, []);

    useEffect(() => {
        if (!paymentDialogOpen || !orderStatus) return;
        if (orderStatus.status === 'paid') {
            resetPayment();
            toast.success(
                t('billing.paymentPending.successToast', { default: 'Payment confirmed. Updating your account.' }),
            );
            onPurchaseComplete?.();
        }
    }, [orderStatus, paymentDialogOpen, resetPayment, onPurchaseComplete, t]);

    const handleConfirmPurchase = async () => {
        setError(null);
        try {
            const buildReturnUrl = (status: string) => {
                if (typeof window === 'undefined') return `/dashboard?credit_refill=${status}`;
                const url = new URL(window.location.href);
                url.searchParams.set('credit_refill', status);
                return url.toString();
            };
            const res = await createOrder.mutateAsync({
                gateway,
                currency,
                amount: quickAmount,
                offer_id: null,
                return_url: buildReturnUrl('success'),
            });
            setOrderId(res.order_id);
            onOpenChange(false);
            setPaymentDialogOpen(true);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to create checkout session';
            setError(message);
            toast.error(message);
        }
    };

    if (!canPurchase) {
        const isUnlimitedPlan = tierName === 'tier_25_200';
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {isUnlimitedPlan ? 'Unlimited plan' : 'Invite Required'}
                        </DialogTitle>
                        <DialogDescription>
                            {isUnlimitedPlan
                                ? 'Your plan includes unlimited points, so refills are not needed.'
                                : 'Redeem an invite code to unlock purchases.'}
                        </DialogDescription>
                    </DialogHeader>
                    {!isUnlimitedPlan && (
                        <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                You need an invite to buy points or subscribe.
                            </AlertDescription>
                        </Alert>
                    )}
                    <div className="flex justify-end gap-2">
                        {!isUnlimitedPlan && (
                            <Button variant="default" onClick={() => (window.location.href = '/invite')}>
                                Redeem Invite
                            </Button>
                        )}
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Close
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Zap className="h-5 w-5 text-amber-500 dark:text-amber-400" />
                            Restore monthly credits
                        </DialogTitle>
                        <DialogDescription>
                            Add one full month of your plan credits at 60% of the monthly price.
                        </DialogDescription>
                    </DialogHeader>

                    {currentBalance > 0 && (
                        <Alert className="text-purple-600 dark:text-purple-400 bg-purple-50 border-purple-200 dark:bg-purple-950 dark:border-purple-800">
                            <AlertCircleIcon className="h-4 w-4" />
                            <AlertDescription className="text-purple-600 dark:text-purple-400">
                                Current credits: <strong>{formatPointsFromUsd(currentBalance)} points</strong>
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Plan</span>
                            <span className="font-medium">{planLabel}</span>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                            <span className="text-muted-foreground">Credits added</span>
                            <span className="font-medium">{refillPoints} points</span>
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground">
                            Adds on top of your balance. Limit: 2 refills per month.
                        </div>
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                    <div className="flex justify-end gap-3 mt-6">
                        <Button
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={createOrder.isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleConfirmPurchase}
                            disabled={createOrder.isPending}
                        >
                            {createOrder.isPending ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <CreditCard className="h-4 w-4" />
                                    Pay {currency === 'USD' ? '$' : '¥'}{quickAmount}
                                </>
                            )}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
            <PaymentPendingDialog
                open={paymentDialogOpen}
                title={t('billing.paymentPending.title', { default: 'Payment in progress' })}
                description={t('billing.paymentPending.description', {
                    default: 'Complete payment in the new tab. We will update this page when it is confirmed.',
                })}
                statusText={orderStatus?.status === 'pending' ? t('billing.paymentPending.status.waiting', { default: 'Waiting for payment confirmation...' }) : undefined}
                errorText={error}
                checking={paymentChecking}
                confirmLabel={t('billing.paymentPending.actions.confirm', { default: 'I have completed payment' })}
                cancelLabel={t('billing.paymentPending.actions.cancel', { default: 'Cancel payment' })}
                onConfirm={async () => { setPaymentChecking(true); await refetchOrder(); setPaymentChecking(false); }}
                onCancel={resetPayment}
            />
        </>
    );
}

export function CreditBalanceDisplay({ balance, canPurchase, onPurchaseClick }: {
    balance: number;
    canPurchase: boolean;
    onPurchaseClick?: () => void;
}) {
    const points = formatPointsFromUsd(balance);

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                    <span className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-yellow-500" />
                        Credits
                    </span>
                    {canPurchase && onPurchaseClick && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={onPurchaseClick}
                        >
                            Restore Credits
                        </Button>
                    )}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">
                    {points} points
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                    {canPurchase
                        ? 'Add a month of plan credits at 60% price'
                        : 'Redeem an invite code to unlock purchases'}
                </p>
            </CardContent>
        </Card>
    );
}
