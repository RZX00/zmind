import { SERVER_URL } from '@/constants/Server';
import { createSupabaseClient } from '@/constants/SupabaseConfig';
import { createStreamingQuery } from '@/stores/query-client';
import type { UploadedFile } from '@/utils/file-upload';
import { debugLog, errorLog } from '@/utils/logger';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { handleApiError } from './error-handlers';

// Import EventSource polyfill for React Native  
import { Platform } from 'react-native';

// Use global EventSource if available, otherwise try polyfill
let EventSourceClass: typeof EventSource;
if (Platform.OS === 'web' || typeof global.EventSource !== 'undefined') {
  EventSourceClass = global.EventSource || EventSource;
} else {
  // For React Native, we'll implement a simple fetch-based alternative
  debugLog('[STREAM] Using fetch-based streaming transport for React Native');
}

// Message types (aligned with existing MessageThread)
export interface Message {
  message_id: string;
  thread_id: string;
  type: 'user' | 'assistant' | 'system' | 'cost' | 'summary' | 'status';
  is_llm_message: boolean;
  content: string | Record<string, any>;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Thread {
  thread_id: string;
  project_id: string;
  account_id: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  agent_id: string | null;
  metadata: Record<string, any>;
}

export interface AgentRun {
  id: string;
  thread_id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  model_name: string;
  created_at: string;
  updated_at: string;
}

export type AgentTerminalStatus =
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'agent_not_running'
  | 'error';

export interface ParsedContent {
  type: 'tool_call' | 'text';
  name?: string;
  content: string;
  [key: string]: any;
}

// Error classes
export class NoAccessTokenAvailableError extends Error {
  constructor() {
    super('No access token available');
    this.name = 'NoAccessTokenAvailableError';
  }
}

export class BillingError extends Error {
  public status: number;
  public detail: { message: string };

  constructor(status: number, detail: { message: string }, message?: string) {
    super(message || detail.message);
    this.name = 'BillingError';
    this.status = status;
    this.detail = detail;
  }
}

// Active streams management
const activeStreams = new Map<string, EventSource>();
const nonRunningAgentRuns = new Set<string>();

const TERMINAL_STATUS_ALIASES: Record<string, AgentTerminalStatus> = {
  completed: 'completed',
  end_stream: 'completed',
  run_completed: 'completed',
  failed: 'failed',
  run_failed: 'failed',
  run_error: 'failed',
  cancelled: 'stopped',
  canceled: 'stopped',
  stopped: 'stopped',
  stop: 'stopped',
  run_stopped: 'stopped',
  agent_not_running: 'agent_not_running',
  not_running: 'agent_not_running',
  error: 'error',
};

const toLowerString = (value: unknown): string => {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
};

const parseJsonRecord = (value: unknown): Record<string, any> | null => {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    return null;
  }

  return null;
};

export const normalizeAgentTerminalStatus = (
  status: unknown,
): AgentTerminalStatus | null => {
  const normalized = toLowerString(status);
  if (!normalized) return null;
  return TERMINAL_STATUS_ALIASES[normalized] || null;
};

export const mapAgentRunStatusToTerminalStatus = (
  status: AgentRun['status'] | string,
): AgentTerminalStatus => {
  return normalizeAgentTerminalStatus(status) || 'error';
};

const isAgentRunLookupMiss = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('not found') ||
    normalized.includes('404') ||
    normalized.includes('does not exist') ||
    normalized.includes('not running')
  );
};

export const getTerminalStatusFromStreamPayload = (
  rawData: string,
): AgentTerminalStatus | null => {
  let processed = rawData.trim();
  if (!processed) return null;

  processed = processed.replace(/^data:\s*/, '').trim();
  if (!processed || processed === '[DONE]') return null;

  if (processed.includes('Run data not available for streaming')) {
    return 'completed';
  }

  const statusTail = processed.match(/Stream ended with status:\s*([A-Za-z_]+)/i);
  if (statusTail?.[1]) {
    return normalizeAgentTerminalStatus(statusTail[1]) || 'completed';
  }

  const payload = parseJsonRecord(processed);
  if (!payload) return null;

  const directCandidates = [
    payload.terminal_status,
    payload.final_status,
    payload.status,
    payload.status_type,
  ];

  for (const candidate of directCandidates) {
    const terminalStatus = normalizeAgentTerminalStatus(candidate);
    if (terminalStatus) {
      return terminalStatus;
    }
  }

  const content = parseJsonRecord(payload.content);
  const metadata = parseJsonRecord(payload.metadata);
  const nestedCandidates = [
    content?.terminal_status,
    content?.status,
    content?.status_type,
    metadata?.terminal_status,
    metadata?.status,
    metadata?.status_type,
  ];

  for (const candidate of nestedCandidates) {
    const terminalStatus = normalizeAgentTerminalStatus(candidate);
    if (terminalStatus) {
      return terminalStatus;
    }
  }

  return null;
};

// XMLHttpRequest-based streaming for React Native (better streaming support)
const setupFetchStream = async (
  url: string,
  agentRunId: string,
  callbacks: {
    onMessage: (content: string) => void;
    onError: (error: Error | string) => void;
    onClose: (finalStatus?: AgentTerminalStatus) => void;
  }
): Promise<() => void> => {
  
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let isActive = true;
    let lastResponseLength = 0;
    let terminalStatus: AgentTerminalStatus | null = null;
    let closeNotified = false;

    const notifyClose = (finalStatus?: AgentTerminalStatus) => {
      if (closeNotified) return;
      closeNotified = true;
      callbacks.onClose(finalStatus);
    };
    
    const cleanup = () => {
      isActive = false;
      if (xhr.readyState !== XMLHttpRequest.DONE) {
        xhr.abort();
      }
      debugLog('[XHR-STREAM] Cleaned up stream', { agentRunId });
    };

    xhr.open('GET', url, true);
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.setRequestHeader('Cache-Control', 'no-cache');
    
    xhr.onreadystatechange = () => {
      if (!isActive) return;
      
      debugLog('[XHR-STREAM] Ready state changed', { agentRunId, readyState: xhr.readyState });
      
      if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED) {
        debugLog('[XHR-STREAM] Response headers received', {
          agentRunId,
          status: xhr.status,
        });
        
        if (xhr.status !== 200) {
          errorLog('[XHR-STREAM] HTTP error', {
            agentRunId,
            status: xhr.status,
            statusText: xhr.statusText,
          });
          callbacks.onError(`HTTP ${xhr.status}: ${xhr.statusText}`);
          return;
        }
      }
      
      if (xhr.readyState === XMLHttpRequest.LOADING || xhr.readyState === XMLHttpRequest.DONE) {
        const newData = xhr.responseText.substring(lastResponseLength);
        lastResponseLength = xhr.responseText.length;
        
        if (newData) {
          debugLog('[XHR-STREAM] Received chunk', {
            agentRunId,
            chunkLength: newData.length,
          });
          
          // Process each line
          const lines = newData.split('\n');
          for (const line of lines) {
            if (!isActive) break;
            
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              const detectedStatus = getTerminalStatusFromStreamPayload(line);
              if (detectedStatus) {
                terminalStatus = detectedStatus;
              }
              if (data && data !== '[DONE]') {
                callbacks.onMessage(line);
              }
            }
          }
        }
        
        if (xhr.readyState === XMLHttpRequest.DONE) {
          debugLog('[XHR-STREAM] Stream completed', { agentRunId });
          notifyClose(terminalStatus || undefined);
        }
      }
    };
    
    xhr.onerror = () => {
      if (!isActive) return;
      errorLog('[XHR-STREAM] Network error', { agentRunId });
      callbacks.onError('Network error occurred');
    };
    
    xhr.onabort = () => {
      if (isActive) {
        debugLog('[XHR-STREAM] Request aborted', { agentRunId });
        notifyClose(terminalStatus || undefined);
      }
    };
    
    xhr.ontimeout = () => {
      if (!isActive) return;
      errorLog('[XHR-STREAM] Request timeout', { agentRunId });
      callbacks.onError('Request timeout');
    };
    
    debugLog('[XHR-STREAM] Starting request', { agentRunId });
    xhr.send();
    
    resolve(cleanup);
  });
};

// SSE streaming helper
export const fetchSSE = async (url: string): Promise<ReadableStream<string>> => {
  const response = await fetch(url, {
    headers: {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const stream = new ReadableStream({
    start(controller) {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      function pump(): Promise<void> {
        return reader!.read().then(({ done, value }) => {
          if (done) {
            controller.close();
            return;
          }

          const chunk = decoder.decode(value);
          controller.enqueue(chunk);
          return pump();
        });
      }

      return pump();
    },
  });

  return stream;
};

// Streaming query helper
const streamedQuery = <T>(streamPromise: Promise<ReadableStream<string>>): Promise<T[]> => {
  return new Promise(async (resolve, reject) => {
    try {
      const stream = await streamPromise;
      const reader = stream.getReader();
      const results: T[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Parse SSE data
        const lines = value.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              results.push(data);
            } catch (e) {
              // Skip malformed JSON
            }
          }
        }
      }

      resolve(results);
    } catch (error) {
      reject(error);
    }
  });
};

// Chat queries following your guidelines
export const useChat = (sessionId: string) => {
  return useQuery({
    ...createStreamingQuery(
      ['chat', 'messages'],
      () => streamedQuery<Message>(fetchSSE(`/api/chat/${sessionId}/stream`)),
      sessionId
    ),
    enabled: !!sessionId,
  });
};

// Regular chat session query (persisted)
export const useChatSession = (sessionId: string) => {
  return useQuery({
    queryKey: ['chat', 'session', sessionId],
    queryFn: async (): Promise<ChatSession> => {
      const response = await fetch(`/api/chat/sessions/${sessionId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch chat session');
      }
      return response.json();
    },
    enabled: !!sessionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes for session data
  });
};

// Chat sessions list (persisted)
export const useChatSessions = () => {
  return useQuery({
    queryKey: ['chat', 'sessions'],
    queryFn: async (): Promise<ChatSession[]> => {
      const response = await fetch('/api/chat/sessions');
      if (!response.ok) {
        throw new Error('Failed to fetch chat sessions');
      }
      return response.json();
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
};

// Send message mutation
export const useSendMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sessionId, message }: { sessionId: string; message: string }) => {
      const response = await fetch(`/api/chat/${sessionId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      return response.json();
    },
    onSuccess: (_, { sessionId }) => {
      // Invalidate chat queries to trigger refetch
      queryClient.invalidateQueries({ queryKey: ['chat', 'messages', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['chat', 'session', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] });
    },
  });
};

// Create new chat session
export const useCreateChatSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ title }: { title?: string } = {}): Promise<ChatSession> => {
      const response = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: title || 'New Chat' }),
      });

      if (!response.ok) {
        throw new Error('Failed to create chat session');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate sessions list
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] });
    },
  });
};

// Delete chat session
export const useDeleteChatSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete chat session');
      }
    },
    onSuccess: (_, sessionId) => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: ['chat', 'messages', sessionId] });
      queryClient.removeQueries({ queryKey: ['chat', 'session', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] });
    },
  });
};

// API Functions
export const addUserMessage = async (
  threadId: string,
  content: string,
  attachments?: UploadedFile[],
): Promise<void> => {
  try {
    const supabase = createSupabaseClient();

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.access_token) {
      throw new Error('User not authenticated');
    }

    const attachmentPayload = (attachments || [])
      .map((file) => {
        if (!file?.fileId) return null;
        return { file_id: file.fileId, name: file.name };
      })
      .filter(Boolean);

    const response = await fetch(`${SERVER_URL}/threads/${threadId}/messages/add`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: content,
        attachments: attachmentPayload.length > 0 ? attachmentPayload : undefined,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Failed to add message');
      handleApiError(new Error(errorText), { operation: 'add message', resource: 'message' });
      throw new Error(errorText || `Error adding message: ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to add user message:', error);
    throw error;
  }
};

export const getMessages = async (threadId: string): Promise<Message[]> => {
  try {
    const supabase = createSupabaseClient();

    // Check auth
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      console.log('[API] No user logged in for messages');
      return [];
    }

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .neq('type', 'cost')
      .neq('type', 'summary')
      .neq('type', 'status') // Filter out status messages
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching messages:', error);
      handleApiError(error, { operation: 'load messages', resource: `messages for thread ${threadId}` });
      throw new Error(`Error getting messages: ${error.message}`);
    }

    console.log('[API] Messages fetched:', data?.length || 0);
    return data || [];
  } catch (error) {
    console.error('Failed to get messages:', error);
    throw error;
  }
};

export const getThreadForProject = async (projectId: string): Promise<Thread | null> => {
  try {
    const supabase = createSupabaseClient();

    // Check auth
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      console.log('[API] No user logged in for thread');
      return null;
    }

    const { data, error } = await supabase
      .from('threads')
      .select('*')
      .eq('project_id', projectId)
      .eq('account_id', userData.user.id) // Filter by user's account
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No thread found, this is ok
        return null;
      }
      console.error('Error fetching thread:', error);
      handleApiError(error, { operation: 'load thread', resource: `thread for project ${projectId}` });
      throw new Error(`Error getting thread: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Failed to get thread:', error);
    throw error;
  }
};

export const createThreadForProject = async (projectId: string): Promise<Thread> => {
  try {
    const supabase = createSupabaseClient();

    // Check auth
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      throw new Error('User not authenticated');
    }

    const { data, error } = await supabase
      .from('threads')
      .insert({
        project_id: projectId,
        account_id: userData.user.id, // Set the account_id for RLS
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating thread:', error);
      handleApiError(error, { operation: 'create thread', resource: 'thread' });
      throw new Error(`Error creating thread: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Failed to create thread:', error);
    throw error;
  }
};

export const updateThread = async (
  threadId: string,
  updates: Partial<Thread>,
): Promise<Thread> => {
  try {
    const supabase = createSupabaseClient();

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      throw new Error('User not authenticated');
    }

    const { data, error } = await supabase
      .from('threads')
      .update(updates)
      .eq('thread_id', threadId)
      .eq('account_id', userData.user.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating thread:', error);
      handleApiError(error, { operation: 'update thread', resource: `thread ${threadId}` });
      throw new Error(`Error updating thread: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Failed to update thread:', error);
    throw error;
  }
};

export const startAgent = async (
  threadId: string,
  options?: {
    model_name?: string;
    enable_thinking?: boolean;
    reasoning_effort?: string;
    stream?: boolean;
    agent_id?: string;
  },
): Promise<{ agent_run_id: string }> => {
  try {
    const supabase = createSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new NoAccessTokenAvailableError();
    }

    if (!SERVER_URL) {
      throw new Error(
        'Backend URL is not configured. Set EXPO_PUBLIC_SERVER_URL in your environment.',
      );
    }

    console.log(`[API] Starting agent for thread ${threadId}`);

    const defaultOptions = {
      model_name: 'leaflow/claude-sonnet-4-6',
      enable_thinking: false,
      reasoning_effort: 'low',
      stream: true,
      agent_id: undefined,
    };

    const finalOptions = { ...defaultOptions, ...options };

    const body: any = {
      model_name: finalOptions.model_name,
      enable_thinking: finalOptions.enable_thinking,
      reasoning_effort: finalOptions.reasoning_effort,
      stream: finalOptions.stream,
    };
    
    if (finalOptions.agent_id) {
      body.agent_id = finalOptions.agent_id;
    }

    const response = await fetch(`${SERVER_URL}/thread/${threadId}/agent/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 402) {
        try {
          const errorData = await response.json();
          console.error(`[API] Billing error starting agent (402):`, errorData);
          const detail = errorData?.detail || { message: 'Payment Required' };
          if (typeof detail.message !== 'string') {
            detail.message = 'Payment Required';
          }
          throw new BillingError(response.status, detail);
        } catch (parseError) {
          console.error('[API] Could not parse 402 error response body:', parseError);
          throw new BillingError(
            response.status,
            { message: 'Payment Required' },
            `Error starting agent: ${response.statusText} (402)`,
          );
        }
      }

      const errorText = await response.text().catch(() => 'No error details available');
      console.error(`[API] Error starting agent: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Error starting agent: ${response.statusText} (${response.status})`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    if (error instanceof BillingError || error instanceof NoAccessTokenAvailableError) {
      throw error;
    }

    console.error('[API] Failed to start agent:', error);
    
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      const networkError = new Error(
        `Cannot connect to backend server. Please check your internet connection and make sure the backend is running.`,
      );
      handleApiError(networkError, { operation: 'start agent', resource: 'AI assistant' });
      throw networkError;
    }

    handleApiError(error, { operation: 'start agent', resource: 'AI assistant' });
    throw error;
  }
};

export const stopAgent = async (agentRunId: string): Promise<void> => {
  nonRunningAgentRuns.add(agentRunId);

  const existingStream = activeStreams.get(agentRunId);
  if (existingStream) {
    console.log(`[API] Closing existing stream for ${agentRunId}`);
    existingStream.close();
    activeStreams.delete(agentRunId);
  }

  try {
    const supabase = createSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      const authError = new NoAccessTokenAvailableError();
      handleApiError(authError, { operation: 'stop agent', resource: 'AI assistant' });
      throw authError;
    }

    const response = await fetch(`${SERVER_URL}/agent-run/${agentRunId}/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) {
      const stopError = new Error(`Error stopping agent: ${response.statusText}`);
      handleApiError(stopError, { operation: 'stop agent', resource: 'AI assistant' });
      throw stopError;
    }
  } catch (error) {
    console.error('Failed to stop agent:', error);
    throw error;
  }
};

export const getAgentStatus = async (
  agentRunId: string,
  options?: { bypassNonRunningCache?: boolean },
): Promise<AgentRun> => {
  console.log(`[API] Requesting agent status for ${agentRunId}`);

  if (!options?.bypassNonRunningCache && nonRunningAgentRuns.has(agentRunId)) {
    console.log(`[API] Agent run ${agentRunId} is known to be non-running`);
    throw new Error(`Agent run ${agentRunId} is not running`);
  }

  try {
    const supabase = createSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      console.error('[API] No access token available for getAgentStatus');
      throw new NoAccessTokenAvailableError();
    }

    const response = await fetch(`${SERVER_URL}/agent-run/${agentRunId}`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details available');
      console.error(`[API] Error getting agent status: ${response.status} ${response.statusText}`, errorText);

      if (response.status === 404) {
        nonRunningAgentRuns.add(agentRunId);
      }

      throw new Error(`Error getting agent status: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();
    console.log(`[API] Successfully got agent status:`, data);

    if (data.status !== 'running') {
      nonRunningAgentRuns.add(agentRunId);
    }

    return data;
  } catch (error) {
    console.error('[API] Failed to get agent status:', error);
    handleApiError(error, { operation: 'get agent status', resource: 'AI assistant status' });
    throw error;
  }
};

export const resolveAgentRunTerminalStatus = async (
  agentRunId: string,
): Promise<AgentTerminalStatus> => {
  try {
    const status = await getAgentStatus(agentRunId, { bypassNonRunningCache: true });
    if (status.status === 'running') {
      return 'error';
    }

    return mapAgentRunStatusToTerminalStatus(status.status);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (isAgentRunLookupMiss(errorMessage)) {
      return 'agent_not_running';
    }

    return 'error';
  }
};

export const getAgentRuns = async (threadId: string): Promise<AgentRun[]> => {
  try {
    const supabase = createSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new NoAccessTokenAvailableError();
    }

    const response = await fetch(`${SERVER_URL}/thread/${threadId}/agent-runs`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Error getting agent runs: ${response.statusText}`);
    }

    const data = await response.json();
    return data.agent_runs || [];
  } catch (error) {
    if (error instanceof NoAccessTokenAvailableError) {
      throw error;
    }

    console.error('Failed to get agent runs:', error);
    handleApiError(error, { operation: 'load agent runs', resource: 'conversation history' });
    throw error;
  }
};

export const streamAgent = (
  agentRunId: string,
  callbacks: {
    onMessage: (content: string) => void;
    onError: (error: Error | string) => void;
    onClose: (finalStatus?: AgentTerminalStatus) => void;
  },
): (() => void) => {
  console.log(`[STREAM] streamAgent called for ${agentRunId}`);

  let isDisposed = false;
  let closeNotified = false;
  let transportCleanup: (() => void) | null = null;
  let terminalStatus: AgentTerminalStatus | null = null;

  const setTerminalStatus = (nextStatus?: AgentTerminalStatus | null) => {
    if (nextStatus) {
      terminalStatus = nextStatus;
    }

    return terminalStatus;
  };

  const notifyError = (error: Error | string) => {
    if (isDisposed) return;
    callbacks.onError(error);
  };

  const notifyClose = (finalStatus?: AgentTerminalStatus) => {
    if (isDisposed || closeNotified) return;
    closeNotified = true;
    callbacks.onClose(finalStatus);
  };

  if (nonRunningAgentRuns.has(agentRunId)) {
    console.log(`[STREAM] Agent run ${agentRunId} is known to be non-running`);
    setTimeout(() => {
      notifyClose('agent_not_running');
    }, 0);
    return () => {
      isDisposed = true;
    };
  }

  const existingStream = activeStreams.get(agentRunId);
  if (existingStream) {
    console.log(`[STREAM] Stream already exists for ${agentRunId}, closing it first`);
    existingStream.close();
    activeStreams.delete(agentRunId);
  }

  const setupStream = async () => {
    try {
      const status = await getAgentStatus(agentRunId, { bypassNonRunningCache: true });
      if (isDisposed) return;

      if (status.status !== 'running') {
        const finalStatus = mapAgentRunStatusToTerminalStatus(status.status);
        nonRunningAgentRuns.add(agentRunId);
        setTerminalStatus(finalStatus);
        notifyClose(finalStatus);
        return;
      }
    } catch (err) {
      if (isDisposed) return;

      console.error(`[STREAM] Error verifying agent run ${agentRunId}:`, err);
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (isAgentRunLookupMiss(errorMessage)) {
        console.log(`[STREAM] Agent run ${agentRunId} is unavailable during verification`);
        nonRunningAgentRuns.add(agentRunId);
        setTerminalStatus('agent_not_running');
        notifyClose('agent_not_running');
        return;
      }

      notifyError(errorMessage);
      notifyClose('error');
      return;
    }

    const supabase = createSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      const authError = new NoAccessTokenAvailableError();
      console.error('[STREAM] No auth token available');
      notifyError(authError);
      notifyClose('error');
      return;
    }

    const url = new URL(`${SERVER_URL}/agent-run/${agentRunId}/stream`);
    url.searchParams.append('token', session.access_token);

    debugLog('[STREAM] Preparing stream transport', {
      agentRunId,
      platform: Platform.OS,
      eventSourceAvailable: typeof global.EventSource !== 'undefined',
      serverUrlConfigured: Boolean(SERVER_URL),
    });

    if (Platform.OS !== 'web' && typeof global.EventSource === 'undefined') {
      debugLog('[STREAM] Using XHR transport', { agentRunId });
      const xhrCleanup = await setupFetchStream(url.toString(), agentRunId, {
        onMessage: callbacks.onMessage,
        onError: notifyError,
        onClose: (finalStatus) => {
          const resolvedStatus = finalStatus || terminalStatus || undefined;
          if (resolvedStatus && resolvedStatus !== 'error') {
            nonRunningAgentRuns.add(agentRunId);
          }
          setTerminalStatus(resolvedStatus || null);
          notifyClose(resolvedStatus);
        },
      });

      if (isDisposed) {
        xhrCleanup();
        return;
      }

      transportCleanup = xhrCleanup;
      return;
    }

    const eventSource = new EventSource(url.toString());
    debugLog('[STREAM] EventSource created', {
      agentRunId,
      readyState: eventSource.readyState,
    });

    activeStreams.set(agentRunId, eventSource);

    const closeEventSource = () => {
      clearTimeout(connectionTimeout);
      eventSource.close();
      activeStreams.delete(agentRunId);
    };

    const connectionTimeout = setTimeout(() => {
      if (eventSource.readyState === EventSource.CONNECTING) {
        errorLog('[STREAM] EventSource connection timeout', { agentRunId });
        closeEventSource();
        notifyError('Connection timeout - check network and backend availability');
        notifyClose('error');
      }
    }, 10000);

    if (isDisposed) {
      closeEventSource();
      return;
    }

    transportCleanup = closeEventSource;

    eventSource.onopen = () => {
      debugLog('[STREAM] Connection opened', {
        agentRunId,
        readyState: eventSource.readyState,
      });
      clearTimeout(connectionTimeout);
    };

    eventSource.onmessage = (event) => {
      try {
        const rawData = event.data;

        if (rawData.includes('"type":"ping"')) {
          debugLog('[STREAM] Ping received', { agentRunId });
          return;
        }

        if (!rawData || rawData.trim() === '') {
          debugLog('[STREAM] Empty event payload received', { agentRunId });
          return;
        }

        const detectedStatus = getTerminalStatusFromStreamPayload(rawData);
        if (detectedStatus) {
          setTerminalStatus(detectedStatus);
        }

        try {
          const jsonData = JSON.parse(rawData);
          debugLog('[STREAM] Parsed stream payload', {
            agentRunId,
            type: jsonData.type,
            sequence: jsonData.sequence,
            hasContent: Boolean(jsonData.content),
            hasMetadata: Boolean(jsonData.metadata),
          });
        } catch (jsonError) {
          debugLog('[STREAM] Non-JSON stream payload received', {
            agentRunId,
            size: rawData.length,
          });
        }

        callbacks.onMessage(rawData);
      } catch (error) {
        errorLog('[STREAM] Error handling message', { agentRunId, error });
        notifyError(error instanceof Error ? error : String(error));
      }
    };

    eventSource.onerror = (event) => {
      if (closeNotified || isDisposed) return;

      errorLog('[STREAM] EventSource error', {
        agentRunId,
        readyState: eventSource.readyState,
        eventType: event.type,
      });
      clearTimeout(connectionTimeout);

      if (eventSource.readyState === EventSource.CLOSED) {
        errorLog('[STREAM] EventSource closed immediately', { agentRunId });
      }

      resolveAgentRunTerminalStatus(agentRunId)
        .then((resolvedStatus) => {
          if (isDisposed || closeNotified) return;

          const finalStatus = terminalStatus || resolvedStatus;
          if (finalStatus && finalStatus !== 'error') {
            nonRunningAgentRuns.add(agentRunId);
          }

          closeEventSource();

          if (finalStatus === 'error') {
            notifyError('Stream disconnected before backend reported a terminal state.');
          }

          notifyClose(finalStatus);
        })
        .catch((err) => {
          if (isDisposed || closeNotified) return;

          console.error(`[STREAM] Error checking agent status after stream error:`, err);
          closeEventSource();
          notifyError(err instanceof Error ? err.message : String(err));
          notifyClose(terminalStatus || 'error');
        });
    };
  };

  setupStream().catch((error) => {
    if (isDisposed || closeNotified) return;

    console.error(`[STREAM] Error setting up stream for ${agentRunId}:`, error);
    notifyError(error instanceof Error ? error : String(error));
    notifyClose('error');
  });

  return () => {
    isDisposed = true;
    console.log(`[STREAM] Cleanup called for ${agentRunId}`);

    if (transportCleanup) {
      transportCleanup();
      transportCleanup = null;
    }

    const stream = activeStreams.get(agentRunId);
    if (stream) {
      stream.close();
      activeStreams.delete(agentRunId);
    }
  };
};

// Utility function to parse streaming content
export const parseStreamContent = (rawData: string): ParsedContent | null => {
  try {
    const data = JSON.parse(rawData);
    
    if (data.type === 'content' && data.content) {
      return {
        type: 'text',
        content: data.content,
      };
    }
    
    if (data.type === 'tool_call') {
      return {
        type: 'tool_call',
        name: data.tool_name || data.name,
        content: data.content || JSON.stringify(data),
        ...data,
      };
    }
    
    return null;
  } catch (error) {
    return null;
  }
};

// NEW CHAT - Initiate Agent API
export const initiateAgent = async (
  message: string,
  options?: {
    agent_id?: string;
    model_name?: string;
    enable_thinking?: boolean;
    reasoning_effort?: string;
    stream?: boolean;
    enable_context_manager?: boolean;
    files?: UploadedFile[]; // Add files parameter
  }
): Promise<{ thread_id: string; agent_run_id: string }> => {
  debugLog('[API] initiateAgent called', {
    messageLength: message.length,
    fileCount: options?.files?.length || 0,
    hasContextManager: Boolean(options?.enable_context_manager),
  });

  const supabase = createSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new NoAccessTokenAvailableError();
  }

  const formData = new FormData();
  formData.append('prompt', message);
  formData.append('stream', String(options?.stream ?? true));
  
  if (options?.agent_id) formData.append('agent_id', options.agent_id);
  if (options?.model_name) formData.append('model_name', options.model_name);
  if (options?.enable_thinking !== undefined) formData.append('enable_thinking', String(options.enable_thinking));
  if (options?.reasoning_effort) formData.append('reasoning_effort', options.reasoning_effort);
  if (options?.enable_context_manager !== undefined) formData.append('enable_context_manager', String(options.enable_context_manager));

  const attachmentPayload = (options?.files || [])
    .filter((file) => Boolean(file.fileId))
    .map((file) => ({
      file_id: file.fileId,
      name: file.name,
    }));

  if (attachmentPayload.length > 0) {
    debugLog('[API] Adding attachment ids to FormData', {
      attachmentCount: attachmentPayload.length,
    });
    formData.append('attachments', JSON.stringify(attachmentPayload));
  } else if (options?.files?.length) {
    debugLog('[API] Adding upload files to FormData', {
      fileCount: options.files.length,
    });
    options.files.forEach((file) => {
      const normalizedName = file.name || 'unknown_file';

      formData.append('files', {
        uri: file.localUri || (file as any).uri,
        name: normalizedName,
        type: file.type || (file as any).mimeType || 'application/octet-stream',
      } as any, normalizedName);
    });
  }

  try {
    debugLog('[API] Sending /agent/initiate request');
    const response = await fetch(`${SERVER_URL}/agent/initiate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: formData,
    });

    debugLog('[API] /agent/initiate response received', {
      status: response.status,
      ok: response.ok,
    });

    if (!response.ok) {
      const errorText = await response.text();
      errorLog('[API] /agent/initiate failed', {
        status: response.status,
        statusText: response.statusText,
        errorText,
      });
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }

    const result = await response.json();
    debugLog('[API] initiateAgent succeeded', {
      hasThreadId: Boolean(result?.thread_id),
      hasAgentRunId: Boolean(result?.agent_run_id),
    });
    return result;
  } catch (error) {
    errorLog('[API] initiateAgent error', error);
    throw error;
  }
}; 
