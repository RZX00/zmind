import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  billingApiV2,
  TokenUsage,
  TopupCheckoutRequest,
} from '@/lib/api/billing-v2';
import { useAuth } from '@/components/AuthProvider';

const openCheckoutInNewTab = (url: string) => {
  if (typeof window === 'undefined') return;
  const opened = window.open(url, '_blank');
  if (opened) {
    opened.opener = null;
    return;
  }
  // Popup blocked (common when open is triggered after an async request).
  // Fallback to same-tab redirect so the user can still pay.
  window.location.href = url;
};

const useBillingAuthGuard = (enabled: boolean) => {
  const { session, isLoading } = useAuth();
  const hasSession = !!session?.access_token;
  return { canQuery: enabled && hasSession && !isLoading };
};

export const billingKeys = {
  all: ['billing'] as const,
  subscription: () => [...billingKeys.all, 'subscription'] as const,
  balance: () => [...billingKeys.all, 'balance'] as const,
  status: () => [...billingKeys.all, 'status'] as const,
  usageHistory: (days?: number) =>
    [...billingKeys.all, 'usage-history', { days }] as const,
  inviteCodes: () => [...billingKeys.all, 'invite-codes'] as const,
  order: (orderId: string) => [...billingKeys.all, 'order', orderId] as const,
};

export const useSubscription = (enabled = true) => {
  const { canQuery } = useBillingAuthGuard(enabled);
  return useQuery({
    queryKey: billingKeys.subscription(),
    queryFn: () => billingApiV2.getSubscription(),
    staleTime: 1000 * 60,
    enabled: canQuery,
  });
};

export const useCreditBalance = (enabled = true) => {
  const { canQuery } = useBillingAuthGuard(enabled);
  return useQuery({
    queryKey: billingKeys.balance(),
    queryFn: () => billingApiV2.getCreditBalance(),
    staleTime: 1000 * 30,
    enabled: canQuery,
  });
};

export const useBillingStatus = () => {
  const { canQuery } = useBillingAuthGuard(true);
  return useQuery({
    queryKey: billingKeys.status(),
    queryFn: () => billingApiV2.checkBillingStatus(),
    staleTime: 1000 * 30,
    enabled: canQuery,
  });
};

export const useUsageHistory = (days = 30) => {
  const { canQuery } = useBillingAuthGuard(true);
  return useQuery({
    queryKey: billingKeys.usageHistory(days),
    queryFn: () => billingApiV2.getUsageHistory(days),
    staleTime: 1000 * 60 * 10,
    enabled: canQuery,
  });
};

export const useInviteCodes = (enabled = true) => {
  const { canQuery } = useBillingAuthGuard(enabled);
  return useQuery({
    queryKey: billingKeys.inviteCodes(),
    queryFn: () => billingApiV2.getInviteCodes(),
    staleTime: 1000 * 60,
    enabled: canQuery,
  });
};

export const useCreateTopupOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: TopupCheckoutRequest) => billingApiV2.createTopupOrder(request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.balance() });
      // Stripe:开新标签去 hosted Checkout。
      // Alipay:checkout_url 多为二维码串,展示交给调用方(topup-section)处理,不在此自动跳转。
      if (data.gateway === 'stripe' && data.checkout_url) {
        openCheckoutInNewTab(data.checkout_url);
      }
    },
  });
};

export const useOrderStatus = (orderId: string | null, enabled: boolean) => {
  return useQuery({
    queryKey: billingKeys.order(orderId ?? '__none__'),
    queryFn: () => billingApiV2.getOrderStatus(orderId as string),
    enabled: enabled && !!orderId,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' ? 3000 : false,
    staleTime: 0,
  });
};

export const useClaimDailyLogin = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => billingApiV2.claimDailyLogin(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.all });
      queryClient.invalidateQueries({ queryKey: ['billing', 'transactions'] });
    },
  });
};

export const useDeductTokenUsage = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (usage: TokenUsage) => billingApiV2.deductTokenUsage(usage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.balance() });
      queryClient.invalidateQueries({ queryKey: billingKeys.status() });
    },
  });
};

export const useTriggerTestRenewal = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => billingApiV2.triggerTestRenewal(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.all });
    },
  });
}; 
