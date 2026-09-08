import { useCallback, useEffect, useRef, useState } from 'react';
import { isLocalMode } from '@/lib/config';
import { useBillingStatusQuery } from '@/hooks/react-query/threads/use-billing-status';
import { BillingData, AgentStatus } from '../_types';

interface UseBillingReturn {
  showBillingAlert: boolean;
  setShowBillingAlert: React.Dispatch<React.SetStateAction<boolean>>;
  billingData: BillingData;
  setBillingData: React.Dispatch<React.SetStateAction<BillingData>>;
  checkBillingLimits: () => Promise<boolean>;
  billingStatusQuery: ReturnType<typeof useBillingStatusQuery>;
}

export function useBilling(
  projectAccountId: string | null | undefined,
  agentStatus: AgentStatus,
  initialLoadCompleted: boolean
): UseBillingReturn {
  const [showBillingAlert, setShowBillingAlert] = useState(false);
  const [billingData, setBillingData] = useState<BillingData>({});
  const previousAgentStatus = useRef<AgentStatus>('idle');
  const billingStatusQuery = useBillingStatusQuery();

  const checkBillingLimits = useCallback(async () => {
    if (isLocalMode()) {
      return false;
    }

    try {
      const refreshResult = await billingStatusQuery.refetch();
      const result = refreshResult.data ?? billingStatusQuery.data;

      if (result && !result.can_run) {
        const canPurchaseCredits = Boolean(
          result.can_purchase_credits ?? result.tier_info?.can_purchase_credits,
        );
        const creditBalanceRaw = result.credit_balance;
        const creditBalance =
          typeof creditBalanceRaw === 'number'
            ? creditBalanceRaw
            : creditBalanceRaw !== undefined && creditBalanceRaw !== null
              ? Number(creditBalanceRaw)
              : undefined;
        const tierName =
          result.tier_info?.name ||
          result.subscription?.tier ||
          result.subscription?.plan_name;
        const tierCredits =
          typeof result.tier_info?.credits === 'number'
            ? result.tier_info.credits
            : undefined;
        const title = canPurchaseCredits ? 'Out of credits' : 'Upgrade required';
        const message =
          result.message ||
          (canPurchaseCredits
            ? 'Add credits to continue.'
            : 'Upgrade to continue.');
        setBillingData({
          title,
          message,
          creditBalance,
          canPurchaseCredits,
          tierName,
          tierCredits,
          primaryAction: canPurchaseCredits ? 'purchase_credits' : 'upgrade',
          accountId: projectAccountId || null,
        });
        setShowBillingAlert(true);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error checking billing status:', err);
      return false;
    }
  }, [projectAccountId, billingStatusQuery]);

  useEffect(() => {
    const previousStatus = previousAgentStatus.current;
    if (previousStatus === 'running' && agentStatus === 'idle') {
      checkBillingLimits();
    }
    previousAgentStatus.current = agentStatus;
  }, [agentStatus, checkBillingLimits]);

  useEffect(() => {
    if (projectAccountId && initialLoadCompleted && !billingStatusQuery.data) {
      checkBillingLimits();
    }
  }, [projectAccountId, checkBillingLimits, initialLoadCompleted, billingStatusQuery.data]);

  return {
    showBillingAlert,
    setShowBillingAlert,
    billingData,
    setBillingData,
    checkBillingLimits,
    billingStatusQuery,
  };
} 
