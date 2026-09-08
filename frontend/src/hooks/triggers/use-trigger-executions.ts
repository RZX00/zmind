import { useQuery } from '@tanstack/react-query';
import { backendApi } from '@/lib/api-client';

export interface TriggerExecution {
  execution_id: string;
  thread_id: string;
  trigger_id: string;
  agent_id: string;
  status: string;
  started_at: string;
  completed_at?: string;
  error_message?: string;
}

export interface TriggerExecutionHistoryResponse {
  executions: TriggerExecution[];
  total_count: number;
  next_run_time?: string;
  next_run_time_local?: string;
  timezone?: string;
  human_readable_schedule?: string;
}

export const useTriggerExecutions = (triggerId: string, limit: number = 20) => {
  return useQuery({
    queryKey: ['trigger-executions', triggerId, limit],
    queryFn: async (): Promise<TriggerExecutionHistoryResponse> => {
      const response = await backendApi.get<TriggerExecutionHistoryResponse>(
        `/triggers/${triggerId}/executions?limit=${limit}`,
      );
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch trigger executions');
      }
      return response.data as TriggerExecutionHistoryResponse;
    },
    enabled: !!triggerId,
    refetchInterval: 30000,
    staleTime: 15000,
  });
};
