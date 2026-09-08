import { useQuery } from '@tanstack/react-query';
import { backendApi } from '@/lib/api-client';
import { useWorkspace } from '@/contexts/workspace-context';

export interface CreditTransaction {
  id: string;
  created_at: string;
  amount: number;
  balance_after: number;
  type: 'tier_grant' | 'purchase' | 'admin_grant' | 'promotional' | 'usage' | 'refund' | 'adjustment' | 'expired' | 'expiration' | 'daily_login' | 'welcome_bonus' | 'initial';
  description: string;
  is_expiring?: boolean;
  expires_at?: string;
  metadata?: Record<string, any>;
}

export interface TransactionsResponse {
  transactions: CreditTransaction[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
  current_balance: {
    total: number;
    expiring: number;
    non_expiring: number;
    tier: string;
  };
}

export interface TransactionsSummary {
  period_days: number;
  since_date: string;
  current_balance: {
    total: number;
    expiring: number;
    non_expiring: number;
    tier: string;
  };
  summary: {
    total_added: number;
    total_used: number;
    total_refunded: number;
    total_expired: number;
    net_change: number;
  };
  transaction_counts: Record<string, number>;
  total_transactions: number;
}

export function useTransactions(
  limit: number = 50,
  offset: number = 0,
  typeFilter?: string
) {
  const { workspaceId, isReady } = useWorkspace();
  return useQuery<TransactionsResponse>({
    queryKey: ['billing', 'transactions', workspaceId ?? 'unknown', limit, offset, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });
      
      if (typeFilter) {
        params.append('type_filter', typeFilter);
      }
      
      const response = await backendApi.get(`/billing/transactions?${params.toString()}`);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    staleTime: 30000,
    enabled: isReady,
  });
}

export function useTransactionsSummary(days: number = 30) {
  const { workspaceId, isReady } = useWorkspace();
  return useQuery<TransactionsSummary>({
    queryKey: ['billing', 'transactions', 'summary', workspaceId ?? 'unknown', days],
    queryFn: async () => {
      const response = await backendApi.get(`/billing/transactions/summary?days=${days}`);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    staleTime: 60000, // 1 minute
    enabled: isReady,
  });
} 
