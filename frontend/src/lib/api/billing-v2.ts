import { backendApi } from "../api-client";
import { createClient } from '@/lib/supabase/client';

export type PaymentGatewayId = 'alipay' | 'stripe';
export type TopupCurrency = 'CNY' | 'USD';

export interface TopupCheckoutRequest {
  gateway: PaymentGatewayId;
  currency: TopupCurrency;
  amount: number;
  offer_id: string | null;
  return_url: string; // 对齐 Plan 1 后端 CreateOrderRequest.return_url(非 success_url)
}

export interface TopupCheckoutResponse {
  order_id: string;
  gateway: PaymentGatewayId;
  checkout_url: string;
  qr_payload: string | null;
  gateway_payment_id: string | null;
}

export interface OrderStatusResponse {
  order_id: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired';
  credit_amount_usd: number;
  credited_at: string | null;
}

export interface CreditBalance {
  balance: number;
  expiring_credits: number;
  non_expiring_credits: number;
  tier: string;
  next_credit_grant?: string;
  can_purchase_credits: boolean;
  breakdown?: {
    expiring: number;
    non_expiring: number;
    total: number;
  };
  lifetime_granted?: number;
  lifetime_purchased?: number;
  lifetime_used?: number;
}

export interface SubscriptionInfo {
  status: string;
  plan_name: string;
  display_plan_name?: string;
  price_id: string;
  subscription: {
    id: string;
    status: string;
    price_id: string;
    current_period_end: string | number | null;
    cancel_at?: string | number | null;
    canceled_at?: string | number | null;
  } | null;
  tier: {
    name: string;
    credits: number;
  };
  credits: {
    balance: number;
    tier_credits: number;
    lifetime_granted: number;
    lifetime_purchased: number;
    lifetime_used: number;
    can_purchase_credits: boolean;
  };
  invite_access_expires_at?: string | null;
  subscription_source?: 'creem' | 'invite';
  has_purchase_qualification?: boolean;
}

export interface BillingStatus {
  can_run: boolean;
  balance: number;
  tier: string;
  message: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  model: string;
  thread_id?: string;
  message_id?: string;
}

export interface DeductResult {
  success: boolean;
  cost: number;
  new_balance: number;
  transaction_id?: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: 'credit' | 'debit';
  amount: number;
  description: string;
  reference_id?: string;
  reference_type?: string;
  created_at: string;
}

export interface UsageHistory {
  daily_usage: Record<string, {
    credits: number;
    debits: number;
    count: number;
  }>;
  total_period_usage: number;
  total_period_credits: number;
}

export interface TestRenewalResponse {
  success: boolean;
  message?: string;
  credits_granted?: number;
  new_balance?: number;
}

export interface RedeemInviteRequest {
  code: string;
}

export interface RedeemInviteResponse {
  success: boolean;
  message: string;
  new_balance: number;
  credit_expires_at: string;
  invite_access_expires_at?: string | null;
}

export interface DailyLoginClaimResponse {
  granted: boolean;
  points: number;
  new_balance?: number;
  already_claimed?: boolean;
  message?: string;
}

export interface InviteCode {
  id: string;
  code: string;
  redeemed_count: number;
  max_redemptions: number;
  status: 'available' | 'used';
  created_at?: string | null;
}

export interface InviteCodesResponse {
  eligible: boolean;
  total: number;
  remaining: number;
  codes: InviteCode[];
}

const getSessionAccessToken = async (): Promise<string | null> => {
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
};

export const billingApiV2 = {
  async getSubscription() {
    const token = await getSessionAccessToken();
    if (!token) {
      return {
        status: 'inactive',
        plan_name: 'free',
        price_id: '',
        subscription: null,
        tier: {
          name: 'free',
          credits: 0,
        },
        credits: {
          balance: 0,
          tier_credits: 0,
          lifetime_granted: 0,
          lifetime_purchased: 0,
          lifetime_used: 0,
          can_purchase_credits: false,
        },
      } as SubscriptionInfo;
    }
    const response = await backendApi.get<SubscriptionInfo>('/billing/subscription', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.error) throw response.error;
    return response.data!;
  },

  async checkBillingStatus() {
    const response = await backendApi.post<BillingStatus>('/billing/check');
    if (response.error) throw response.error;
    return response.data!;
  },

  async getCreditBalance() {
    // Avoid unauthenticated calls on public pages (e.g., home)
    const token = await getSessionAccessToken();
    if (!token) {
      // return a safe default instead of triggering 401 noise
      return {
        balance: 0,
        expiring_credits: 0,
        non_expiring_credits: 0,
        tier: 'free',
        can_purchase_credits: false
      } as CreditBalance;
    }

    const response = await backendApi.get<CreditBalance>('/billing/balance', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.error) throw response.error;
    return response.data!;
  },

  async deductTokenUsage(usage: TokenUsage) {
    const response = await backendApi.post<DeductResult>('/billing/deduct', usage);
    if (response.error) throw response.error;
    return response.data!;
  },

  async getTransactions(limit = 50, offset = 0) {
    const response = await backendApi.get<{ transactions: Transaction[]; count: number }>(
      `/billing/transactions?limit=${limit}&offset=${offset}`
    );
    if (response.error) throw response.error;
    return response.data!;
  },

  async getUsageHistory(days = 30) {
    const response = await backendApi.get<UsageHistory>(
      `/billing/usage-history?days=${days}`
    );
    if (response.error) throw response.error;
    return response.data!;
  },

  async triggerTestRenewal() {
    const response = await backendApi.post<TestRenewalResponse>('/billing/test/trigger-renewal');
    if (response.error) throw response.error;
    return response.data!;
  },
  
  async getInviteCodes() {
    const token = await getSessionAccessToken();
    if (!token) {
      return {
        eligible: false,
        total: 0,
        remaining: 0,
        codes: [],
      } as InviteCodesResponse;
    }
    const response = await backendApi.get<InviteCodesResponse>(
      '/billing/invite/codes',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (response.error) throw response.error;
    return response.data!;
  },

  async redeemInvite(request: RedeemInviteRequest) {
    // Suppress global error handler to avoid duplicate toasts; page will handle messaging
    const response = await backendApi.post<RedeemInviteResponse>(
      '/billing/invite/redeem',
      request,
      { showErrors: false }
    );
    if (response.error) throw response.error;
    return response.data!;
  },

  async claimDailyLogin() {
    const token = await getSessionAccessToken();
    if (!token) {
      return {
        granted: false,
        points: 0,
        message: 'No active session',
      } as DailyLoginClaimResponse;
    }
    const response = await backendApi.post<DailyLoginClaimResponse>(
      '/billing/claim-daily-login',
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (response.error) throw response.error;
    return response.data!;
  },

  async createTopupOrder(request: TopupCheckoutRequest) {
    const token = await getSessionAccessToken();
    const response = await backendApi.post<TopupCheckoutResponse>(
      '/billing/orders/checkout',
      request,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    );
    if (response.error) throw response.error;
    return response.data!;
  },

  async getOrderStatus(orderId: string) {
    const token = await getSessionAccessToken();
    const response = await backendApi.get<OrderStatusResponse>(
      `/billing/orders/${encodeURIComponent(orderId)}`,
      {
        showErrors: false,
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      },
    );
    if (response.error) throw response.error;
    return response.data!;
  }
};

export const getSubscription = () => billingApiV2.getSubscription();
export const checkBillingStatus = () => billingApiV2.checkBillingStatus();
export const getCreditBalance = () => billingApiV2.getCreditBalance();
export const deductTokenUsage = (usage: TokenUsage) => billingApiV2.deductTokenUsage(usage);
export const getTransactions = (limit?: number, offset?: number) =>
  billingApiV2.getTransactions(limit, offset);
export const getUsageHistory = (days?: number) => billingApiV2.getUsageHistory(days);
export const triggerTestRenewal = () => billingApiV2.triggerTestRenewal();
export const getInviteCodes = () => billingApiV2.getInviteCodes();
export const redeemInvite = (request: RedeemInviteRequest) => billingApiV2.redeemInvite(request);
export const claimDailyLogin = () => billingApiV2.claimDailyLogin();
export const createTopupOrder = (request: TopupCheckoutRequest) =>
  billingApiV2.createTopupOrder(request);
export const getOrderStatus = (orderId: string) => billingApiV2.getOrderStatus(orderId);
