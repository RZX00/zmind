import { apiClient } from '@/lib/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type OpenClawRole = 'owner' | 'member';
export type OpenClawCapability =
  | 'canvas.read'
  | 'canvas.create'
  | 'canvas.write'
  | 'doc.read'
  | 'doc.create'
  | 'doc.write'
  | 'rollback.execute';

export interface OpenClawSettings {
  workspace_id: string;
  enabled: boolean;
  allowed_roles: OpenClawRole[];
  allowed_capabilities: OpenClawCapability[];
  linked_at?: string | null;
  linked_by?: string | null;
  last_verified_at?: string | null;
  last_verified_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  metadata: Record<string, any>;
  workspace_role?: OpenClawRole | null;
}

export interface OpenClawActivity {
  id: string;
  workspace_id: string;
  actor_id?: string | null;
  client?: string | null;
  tool_name?: string | null;
  operation_key?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  status: 'succeeded' | 'rolled_back' | 'failed';
  summary?: string | null;
  request_id?: string | null;
  metadata: Record<string, any>;
  rollback_payload?: Record<string, any> | null;
  rollback_status: 'available' | 'completed' | 'failed' | 'not_supported';
  rollback_error?: string | null;
  created_at?: string | null;
  rolled_back_at?: string | null;
  rolled_back_by?: string | null;
  can_rollback: boolean;
}

export interface OpenClawState {
  settings: OpenClawSettings;
  stats: {
    recent_activity_count: number;
    pending_rollbacks: number;
    last_activity?: OpenClawActivity | null;
  };
  available_roles: OpenClawRole[];
  available_capabilities: OpenClawCapability[];
}

export interface OpenClawActivityList {
  items: OpenClawActivity[];
  total: number;
}

export interface OpenClawRollbackResult {
  activity: OpenClawActivity;
  result: any;
}

export interface UpdateOpenClawSettingsPayload {
  enabled: boolean;
  allowed_roles: OpenClawRole[];
  allowed_capabilities: OpenClawCapability[];
  metadata?: Record<string, any>;
}

const STATE_KEY = ['integrations', 'openclaw', 'state'];
const ACTIVITY_KEY = ['integrations', 'openclaw', 'activity'];

async function expectSuccess<T>(promise: Promise<{ success: boolean; data?: T; error?: Error }>) {
  const response = await promise;
  if (!response.success || response.error) {
    throw new Error(response.error?.message || 'Request failed');
  }
  return response.data as T;
}

export function useOpenClawState() {
  return useQuery({
    queryKey: STATE_KEY,
    queryFn: async () => expectSuccess<OpenClawState>(apiClient.get('/api/integrations/openclaw/state')),
    staleTime: 15_000,
  });
}

export function useOpenClawActivity(limit = 20) {
  return useQuery({
    queryKey: [...ACTIVITY_KEY, limit],
    queryFn: async () =>
      expectSuccess<OpenClawActivityList>(
        apiClient.get('/api/integrations/openclaw/activity', {
          params: { limit },
        }),
      ),
    staleTime: 10_000,
  });
}

export function useUpdateOpenClawSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateOpenClawSettingsPayload) =>
      expectSuccess<OpenClawSettings>(apiClient.put('/api/integrations/openclaw/state', payload)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: STATE_KEY }),
        queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY }),
      ]);
    },
  });
}

export function useRollbackOpenClawActivity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (activityId: string) =>
      expectSuccess<OpenClawRollbackResult>(
        apiClient.post(`/api/integrations/openclaw/activity/${activityId}/rollback`),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: STATE_KEY }),
        queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY }),
      ]);
    },
  });
}
