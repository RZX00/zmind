'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/lib/api-client';

export type AutomationTriggerType = 'schedule' | 'event';
export type AutomationRouteType = 'agent' | 'workflow';
export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'dead_lettered';
export type AutomationRunSource = 'schedule' | 'event' | 'manual';

export interface Automation {
  id: string;
  account_id: string;
  agent_id?: string | null;
  name: string;
  description?: string | null;
  trigger_type: AutomationTriggerType;
  provider?: string | null;
  provider_binding_key?: string | null;
  route_type: AutomationRouteType;
  route_ref?: string | null;
  is_active: boolean;
  config: Record<string, any>;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationRun {
  id: string;
  automation_id: string;
  account_id: string;
  provider_event_id?: string | null;
  trigger_source: AutomationRunSource;
  triggered_at: string;
  status: AutomationRunStatus;
  retry_count: number;
  max_retries: number;
  external_run_key?: string | null;
  agent_run_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CreateAutomationPayload {
  name: string;
  description?: string;
  trigger_type: AutomationTriggerType;
  provider?: string;
  provider_binding_key?: string;
  route_type: AutomationRouteType;
  route_ref?: string;
  agent_id?: string;
  is_active?: boolean;
  config?: Record<string, any>;
}

export interface UpdateAutomationPayload {
  name?: string;
  description?: string | null;
  provider?: string | null;
  provider_binding_key?: string | null;
  route_type?: AutomationRouteType;
  route_ref?: string | null;
  agent_id?: string | null;
  is_active?: boolean;
  config?: Record<string, any>;
}

type AutomationListResponse = {
  success: boolean;
  items?: Array<Record<string, any>>;
  count?: number;
};

type AutomationItemResponse = {
  success: boolean;
  item?: Record<string, any>;
};

type AutomationRunListResponse = {
  success: boolean;
  items?: Array<Record<string, any>>;
  count?: number;
};

type AutomationTestFireResponse = {
  success: boolean;
  run_id?: string;
  duplicate?: boolean;
};

const automationKeys = {
  all: ['automations'] as const,
  list: (params: {
    trigger_type?: AutomationTriggerType;
    is_active?: boolean;
    limit?: number;
    offset?: number;
  }) => ['automations', 'list', params] as const,
  runs: (automationId: string, limit: number, offset: number) =>
    ['automations', 'runs', automationId, limit, offset] as const,
};

const toRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const normalizeAutomation = (raw: Record<string, any>): Automation => {
  const trigger_type: AutomationTriggerType =
    raw.trigger_type === 'schedule' ? 'schedule' : 'event';
  const route_type: AutomationRouteType =
    raw.route_type === 'workflow' ? 'workflow' : 'agent';

  return {
    id: String(raw.id ?? raw.automation_id ?? ''),
    account_id: String(raw.account_id ?? ''),
    agent_id: raw.agent_id ?? null,
    name: String(raw.name ?? 'Untitled automation'),
    description: raw.description ?? null,
    trigger_type,
    provider: raw.provider ?? null,
    provider_binding_key: raw.provider_binding_key ?? null,
    route_type,
    route_ref: raw.route_ref ?? null,
    is_active: Boolean(raw.is_active ?? true),
    config: toRecord(raw.config),
    created_by: raw.created_by ?? null,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  };
};

const normalizeRun = (raw: Record<string, any>): AutomationRun => {
  const status: AutomationRunStatus = (
    [
      'queued',
      'running',
      'completed',
      'failed',
      'cancelled',
      'dead_lettered',
    ] as const
  ).includes(raw.status)
    ? raw.status
    : 'queued';
  const trigger_source: AutomationRunSource = (
    ['schedule', 'event', 'manual'] as const
  ).includes(raw.trigger_source)
    ? raw.trigger_source
    : 'manual';

  return {
    id: String(raw.id ?? raw.run_id ?? ''),
    automation_id: String(raw.automation_id ?? ''),
    account_id: String(raw.account_id ?? ''),
    provider_event_id: raw.provider_event_id ?? null,
    trigger_source,
    triggered_at: String(raw.triggered_at ?? ''),
    status,
    retry_count: Number(raw.retry_count ?? 0),
    max_retries: Number(raw.max_retries ?? 0),
    external_run_key: raw.external_run_key ?? null,
    agent_run_id: raw.agent_run_id ?? null,
    error_code: raw.error_code ?? null,
    error_message: raw.error_message ?? null,
    metadata: toRecord(raw.metadata),
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  };
};

export function useAutomations(params?: {
  trigger_type?: AutomationTriggerType;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}) {
  const queryParams = {
    trigger_type: params?.trigger_type,
    is_active: params?.is_active,
    limit: params?.limit ?? 200,
    offset: params?.offset ?? 0,
  };

  return useQuery({
    queryKey: automationKeys.list(queryParams),
    queryFn: async (): Promise<Automation[]> => {
      const res = await backendApi.get<AutomationListResponse>('/automations', {
        params: queryParams,
      });
      if (!res.success) {
        throw new Error(res.error?.message || 'Failed to load automations');
      }
      const items = res.data?.items ?? [];
      return items.map((item) => normalizeAutomation(toRecord(item)));
    },
    staleTime: 30 * 1000,
  });
}

export function useAutomationRuns(
  automationId?: string,
  options?: { limit?: number; offset?: number; enabled?: boolean },
) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const enabled = Boolean(automationId) && (options?.enabled ?? true);

  return useQuery({
    queryKey: automationKeys.runs(automationId || '', limit, offset),
    queryFn: async (): Promise<AutomationRun[]> => {
      if (!automationId) return [];
      const res = await backendApi.get<AutomationRunListResponse>(
        `/automations/${automationId}/runs`,
        {
          params: { limit, offset },
        },
      );
      if (!res.success) {
        throw new Error(res.error?.message || 'Failed to load automation runs');
      }
      const items = res.data?.items ?? [];
      return items.map((item) => normalizeRun(toRecord(item)));
    },
    enabled,
    staleTime: 15 * 1000,
  });
}

export function useCreateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: CreateAutomationPayload,
    ): Promise<Automation> => {
      const res = await backendApi.post<AutomationItemResponse>(
        '/automations',
        payload,
      );
      if (!res.success) {
        throw new Error(res.error?.message || 'Failed to create automation');
      }
      return normalizeAutomation(toRecord(res.data?.item));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

export function useUpdateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      automationId: string;
      payload: UpdateAutomationPayload;
    }): Promise<Automation> => {
      const res = await backendApi.patch<AutomationItemResponse>(
        `/automations/${args.automationId}`,
        args.payload,
      );
      if (!res.success) {
        throw new Error(res.error?.message || 'Failed to update automation');
      }
      return normalizeAutomation(toRecord(res.data?.item));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

export function useToggleAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      automationId: string;
      is_active: boolean;
    }): Promise<Automation> => {
      const res = await backendApi.post<AutomationItemResponse>(
        `/automations/${args.automationId}/toggle`,
        { is_active: args.is_active },
      );
      if (!res.success) {
        throw new Error(
          res.error?.message || 'Failed to update trigger status',
        );
      }
      return normalizeAutomation(toRecord(res.data?.item));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (automationId: string): Promise<void> => {
      const res = await backendApi.delete<{ success: boolean }>(
        `/automations/${automationId}`,
      );
      if (!res.success) {
        throw new Error(res.error?.message || 'Failed to delete trigger');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

export function useTestFireAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      automationId: string;
      payload?: Record<string, any>;
    }): Promise<AutomationTestFireResponse> => {
      const res = await backendApi.post<AutomationTestFireResponse>(
        `/automations/${args.automationId}/test-fire`,
        { payload: args.payload ?? {} },
      );
      if (!res.success) {
        throw new Error(res.error?.message || 'Failed to trigger run');
      }
      return res.data || { success: true };
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
      queryClient.invalidateQueries({
        queryKey: automationKeys.runs(vars.automationId, 50, 0),
      });
    },
  });
}
