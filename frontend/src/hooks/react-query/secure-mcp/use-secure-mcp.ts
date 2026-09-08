import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { requiredEnv } from '@/lib/env-utils';

const API_URL = requiredEnv('NEXT_PUBLIC_BACKEND_URL');

export interface MCPCredential {
  credential_id: string;
  mcp_qualified_name: string;
  display_name: string;
  config_keys: string[];
  is_active: boolean;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
}

export interface StoreCredentialRequest {
  mcp_qualified_name: string;
  display_name: string;
  config: Record<string, any>;
}

export interface TestCredentialResponse {
  success: boolean;
  message: string;
  error_details?: string;
}

// Template marketplace functionality removed

// =====================================================
// CREDENTIAL MANAGEMENT HOOKS
// =====================================================

export function useUserCredentials() {
  return useQuery({
    queryKey: ['secure-mcp', 'credentials'],
    queryFn: async (): Promise<MCPCredential[]> => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('You must be logged in to view credentials');
      }

      const response = await fetch(`${API_URL}/secure-mcp/credentials`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    },
  });
}

export function useStoreCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: StoreCredentialRequest): Promise<MCPCredential> => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('You must be logged in to store credentials');
      }

      const response = await fetch(`${API_URL}/secure-mcp/credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secure-mcp', 'credentials'] });
    },
  });
}

export function useDeleteCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mcp_qualified_name: string): Promise<void> => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('You must be logged in to delete credentials');
      }

      const response = await fetch(`${API_URL}/secure-mcp/credentials/${encodeURIComponent(mcp_qualified_name)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secure-mcp', 'credentials'] });
    },
  });
}

// Template marketplace hooks removed
