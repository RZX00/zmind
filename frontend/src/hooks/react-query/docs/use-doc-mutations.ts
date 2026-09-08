import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useWorkspace } from '@/contexts/workspace-context';
import { workspaceKeys } from '@/hooks/react-query/workspace/keys';
import { docsKeys } from './keys';
import type { DocContent, DocUpdateResponse } from '@/types/doc';
import type { WorkspaceItem } from '@/types/workspace-item';

interface CreateDocPayload {
  title: string;
  contentMd?: string;
  frontmatter?: Record<string, unknown>;
  folderId?: string | null;
  parentItemId?: string | null;
}

interface UpdateDocPayload {
  itemId: string;
  contentMd: string;
  frontmatter?: Record<string, unknown>;
  ifMatchVersion?: number;
}

interface RenameDocPayload {
  itemId: string;
  title: string;
}

export function useDocMutations() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();

  const createDocMutation = useMutation({
    mutationFn: async (payload: CreateDocPayload) => {
      const response = await apiClient.post<DocContent>('/api/docs', payload, {
        showErrors: false,
      });
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to create doc');
      }
      return response.data;
    },
    onSuccess: (createdDoc) => {
      queryClient.setQueryData(docsKeys.detail(createdDoc.itemId), createdDoc);
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) });
      }
    },
  });

  const updateDocMutation = useMutation({
    mutationFn: async (payload: UpdateDocPayload) => {
      const headers: Record<string, string> = {};
      if (typeof payload.ifMatchVersion === 'number') {
        headers['If-Match'] = `W/"v${payload.ifMatchVersion}"`;
      }
      const response = await apiClient.request<DocUpdateResponse>(`/api/docs/${payload.itemId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          contentMd: payload.contentMd,
          frontmatter: payload.frontmatter,
        }),
        showErrors: false,
      });
      if (!response.success || !response.data) {
        const error = response.error || new Error('Failed to update doc');
        if (Number((error as any)?.status || 0) === 409) {
          // Version conflicts are expected in collaborative edits.
          // Caller-level logic handles merge/reload behavior.
          (error as any).suppressGlobalError = true;
          (error as any).isExpectedConflict = true;
        }
        throw error;
      }
      return response.data;
    },
    onSuccess: (updated, variables) => {
      queryClient.setQueryData<DocContent | undefined>(docsKeys.detail(variables.itemId), (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          contentMd: variables.contentMd,
          frontmatter: variables.frontmatter ?? prev.frontmatter,
          version: updated.version,
          updatedAt: updated.updatedAt,
        };
      });
      queryClient.invalidateQueries({ queryKey: docsKeys.blocks(variables.itemId) });
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) });
      }
    },
  });

  const renameDocMutation = useMutation({
    mutationFn: async (payload: RenameDocPayload) => {
      const response = await apiClient.put<WorkspaceItem>(
        `/api/items/${payload.itemId}`,
        { title: payload.title },
        { showErrors: false },
      );
      if (!response.success || !response.data) {
        throw response.error || new Error('Failed to rename doc');
      }
      return response.data;
    },
    onSuccess: (updatedItem, variables) => {
      queryClient.setQueryData<DocContent | undefined>(docsKeys.detail(variables.itemId), (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          title: updatedItem.title || prev.title,
        };
      });
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) });
      }
    },
  });

  return {
    createDoc: createDocMutation.mutateAsync,
    creatingDoc: createDocMutation.isPending,
    updateDoc: updateDocMutation.mutateAsync,
    updatingDoc: updateDocMutation.isPending,
    renameDoc: renameDocMutation.mutateAsync,
    renamingDoc: renameDocMutation.isPending,
  };
}
