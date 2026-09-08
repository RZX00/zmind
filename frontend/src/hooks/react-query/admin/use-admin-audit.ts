import { apiClient } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';

export interface PaginationMeta {
  current_page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
  next_cursor?: string | null;
  previous_cursor?: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface AuditEvent {
  event_id: string;
  event_type: string;
  schema_version: number;
  occurred_at: string;
  aggregate_id: string;
  aggregate_type: string;
  tenant_id?: string | null;
  actor_id?: string | null;
  payload: Record<string, any>;
  ingested_at: string;
}

export interface ProjectionFailure {
  projection_name: string;
  event_id: string;
  event_type: string;
  schema_version: number;
  occurred_at: string;
  aggregate_id: string;
  aggregate_type: string;
  tenant_id?: string | null;
  actor_id?: string | null;
  payload: Record<string, any>;
  failure_count: number;
  first_failed_at: string;
  last_failed_at: string;
  last_error?: string | null;
}

interface AuditEventListParams {
  page?: number;
  page_size?: number;
  event_type?: string;
  aggregate_id?: string;
  tenant_id?: string;
  actor_id?: string;
  since?: string;
  until?: string;
}

interface ProjectionFailureListParams {
  page?: number;
  page_size?: number;
  projection_name?: string;
  event_type?: string;
  tenant_id?: string;
  since?: string;
  until?: string;
}

const buildQueryString = (params: Record<string, string | number | undefined>) => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    searchParams.append(key, String(value));
  });
  return searchParams.toString();
};

export function useAdminAuditEvents(params: AuditEventListParams) {
  return useQuery({
    queryKey: ['admin', 'audit', 'events', params],
    queryFn: async (): Promise<PaginatedResponse<AuditEvent>> => {
      const queryString = buildQueryString({
        page: params.page,
        page_size: params.page_size,
        event_type: params.event_type,
        aggregate_id: params.aggregate_id,
        tenant_id: params.tenant_id,
        actor_id: params.actor_id,
        since: params.since,
        until: params.until,
      });

      const url = `/api/admin/audit/events?${queryString}`;
      const response = await apiClient.get(url);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as PaginatedResponse<AuditEvent>;
    },
    staleTime: 15000,
  });
}

export function useAdminProjectionFailures(params: ProjectionFailureListParams) {
  return useQuery({
    queryKey: ['admin', 'audit', 'failures', params],
    queryFn: async (): Promise<PaginatedResponse<ProjectionFailure>> => {
      const queryString = buildQueryString({
        page: params.page,
        page_size: params.page_size,
        projection_name: params.projection_name,
        event_type: params.event_type,
        tenant_id: params.tenant_id,
        since: params.since,
        until: params.until,
      });

      const url = `/api/admin/audit/failures?${queryString}`;
      const response = await apiClient.get(url);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as PaginatedResponse<ProjectionFailure>;
    },
    staleTime: 15000,
  });
}
