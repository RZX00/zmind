'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  ObsidianExportJob,
  ObsidianImportJob,
  ObsidianImportReport,
  ObsidianImportUploadPayload,
} from '@/types/obsidian';

export function useCreateObsidianImportJob() {
  return useMutation({
    mutationFn: async (sourceType: 'zip' | 'directory' = 'zip') => {
      const response = await apiClient.post<ObsidianImportJob>(
        '/api/imports/obsidian/jobs',
        { sourceType },
        { showErrors: false },
      );
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to create Obsidian import job');
      }
      return response.data;
    },
  });
}

export function useUploadObsidianImportPayload() {
  return useMutation({
    mutationFn: async (payload: { jobId: string; upload: ObsidianImportUploadPayload }) => {
      const response = await apiClient.post<ObsidianImportJob>(
        `/api/imports/obsidian/jobs/${payload.jobId}/upload`,
        payload.upload,
        { showErrors: false },
      );
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to upload Obsidian payload');
      }
      return response.data;
    },
  });
}

export function useCommitObsidianImportJob() {
  return useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiClient.post<ObsidianImportJob>(
        `/api/imports/obsidian/jobs/${jobId}/commit`,
        {},
        { showErrors: false },
      );
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to commit Obsidian import job');
      }
      return response.data;
    },
  });
}

export function useObsidianImportJob(jobId: string | null) {
  return useQuery({
    queryKey: ['integrations', 'obsidian', 'import-job', jobId],
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return 3000;
      return status === 'running' || status === 'pending' ? 3000 : false;
    },
    queryFn: async () => {
      if (!jobId) throw new Error('Missing job id');
      const response = await apiClient.get<ObsidianImportJob>(
        `/api/imports/obsidian/jobs/${jobId}`,
        { showErrors: false },
      );
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to fetch Obsidian import job');
      }
      return response.data;
    },
  });
}

export function useObsidianImportReport(jobId: string | null) {
  return useQuery({
    queryKey: ['integrations', 'obsidian', 'import-report', jobId],
    enabled: Boolean(jobId),
    queryFn: async () => {
      if (!jobId) throw new Error('Missing job id');
      const response = await apiClient.get<ObsidianImportReport>(
        `/api/imports/obsidian/jobs/${jobId}/report`,
        { showErrors: false },
      );
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to fetch Obsidian import report');
      }
      return response.data;
    },
  });
}

export function useCreateObsidianExportJob() {
  return useMutation({
    mutationFn: async (payload: { scopeType?: 'workspace' | 'folder'; scopeId?: string }) => {
      const response = await apiClient.post<ObsidianExportJob>(
        '/api/exports/obsidian/jobs',
        {
          scopeType: payload.scopeType || 'workspace',
          scopeId: payload.scopeId || null,
        },
        { showErrors: false },
      );
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to create Obsidian export job');
      }
      return response.data;
    },
  });
}

export function useObsidianExportJob(jobId: string | null) {
  return useQuery({
    queryKey: ['integrations', 'obsidian', 'export-job', jobId],
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return 3000;
      return status === 'running' || status === 'pending' ? 3000 : false;
    },
    queryFn: async () => {
      if (!jobId) throw new Error('Missing export job id');
      const response = await apiClient.get<ObsidianExportJob>(
        `/api/exports/obsidian/jobs/${jobId}`,
        { showErrors: false },
      );
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to fetch Obsidian export job');
      }
      return response.data;
    },
  });
}

