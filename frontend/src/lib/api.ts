import { createClient } from '@/lib/supabase/client';
import { getCurrentWorkspaceId } from '@/lib/workspace-session';
import { handleApiError, type ApiError } from './error-handler';
import { resolveBackendBase } from '@/lib/backend';
import posthog from 'posthog-js';
import type { RunMode } from '@/lib/run-mode';
import type { ApplyDocOpsResponse, DocRevision, DocRevisionListResponse } from '@/types/doc';
import {
  fetchProjects,
  fetchProject,
  createProjectRequest,
  updateProjectRequest,
  deleteProjectRequest,
  BackendApiError,
  type ProjectRecord,
} from '@/lib/backend-api';

// Get backend URL from environment variables (no defaults)
// - Browser: NEXT_PUBLIC_BACKEND_URL
// - Server: BACKEND_INTERNAL_URL
const API_URL = resolveBackendBase();
const getWorkspaceHeaders = () => {
  if (typeof globalThis === 'undefined') return {};
  const raw = (globalThis as any).__zmind_workspace_id__;
  if (typeof raw !== 'string') return {};
  const workspaceId = raw.trim();
  return workspaceId ? { 'X-Workspace-Id': workspaceId } : {};
};

// Set to keep track of agent runs that are known to be non-running
const nonRunningAgentRuns = new Set<string>();
// Map to keep track of active EventSource streams
const activeStreams = new Map<string, EventSource>();
// Map to keep track of safety timeouts
const safetyTimeouts = new Map<string, number>();

const parseErrorResponse = async (response: Response): Promise<any> => {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
};

const extractDetailPayload = (payload: any) => {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    return payload.detail;
  }
  return payload;
};

const ensureDetailObject = (detail: any, fallbackMessage: string) => {
  if (detail && typeof detail === 'object') {
    if (!detail.message && fallbackMessage) {
      return { ...detail, message: fallbackMessage };
    }
    return detail;
  }
  return { message: typeof detail === 'string' && detail ? detail : fallbackMessage };
};

/**
 * Helper function to safely cleanup EventSource connections
 * This ensures consistent cleanup and prevents memory leaks
 */
const cleanupEventSource = (agentRunId: string, reason?: string): void => {
  const stream = activeStreams.get(agentRunId);
  if (stream) {
    if (reason) {
      console.log(`[STREAM] Cleaning up EventSource for ${agentRunId}: ${reason}`);
    }
    
    // Close the connection
    if (stream.readyState !== EventSource.CLOSED) {
      stream.close();
    }
    
    // Remove from active streams
    activeStreams.delete(agentRunId);
  }

  // Clear any associated safety timeout
  const timeout = safetyTimeouts.get(agentRunId);
  if (timeout) {
    clearTimeout(timeout);
    safetyTimeouts.delete(agentRunId);
  }
};

/**
 * Failsafe cleanup function to prevent memory leaks
 * Should be called periodically or during app teardown
 */
const cleanupAllEventSources = (reason = 'batch cleanup'): void => {
  console.log(`[STREAM] Running batch cleanup: ${activeStreams.size} active streams`);
  
  const streamIds = Array.from(activeStreams.keys());
  streamIds.forEach(agentRunId => {
    cleanupEventSource(agentRunId, reason);
  });
};

// Export cleanup function for external use
export { cleanupAllEventSources };

// Custom error for billing issues
export class BillingError extends Error {
  status: number;
  detail: { message: string; [key: string]: any }; // Allow other properties in detail

  constructor(
    status: number,
    detail: { message: string; [key: string]: any },
    message?: string,
  ) {
    super(message || detail.message || `Billing Error: ${status}`);
    this.name = 'BillingError';
    this.status = status;
    this.detail = detail;

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, BillingError.prototype);
  }
}

// Custom error for agent run limit exceeded
export class AgentRunLimitError extends Error {
  status: number;
  detail: { 
    message: string;
    running_thread_ids: string[];
    running_count: number;
  };

  constructor(
    status: number,
    detail: { 
      message: string;
      running_thread_ids: string[];
      running_count: number;
      [key: string]: any;
    },
    message?: string,
  ) {
    super(message || detail.message || `Agent Run Limit Exceeded: ${status}`);
    this.name = 'AgentRunLimitError';
    this.status = status;
    this.detail = detail;

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, AgentRunLimitError.prototype);
  }
}

export class AgentCountLimitError extends Error {
  status: number;
  detail: { 
    message: string;
    current_count: number;
    limit: number;
    tier_name: string;
    error_code: string;
  };

  constructor(
    status: number,
    detail: { 
      message: string;
      current_count: number;
      limit: number;
      tier_name: string;
      error_code: string;
      [key: string]: any;
    },
    message?: string,
  ) {
    super(message || detail.message || `Agent Count Limit Exceeded: ${status}`);
    this.name = 'AgentCountLimitError';
    this.status = status;
    this.detail = detail;
    Object.setPrototypeOf(this, AgentCountLimitError.prototype);
  }
}

export class ProjectLimitError extends Error {
  status: number;
  detail: { 
    message: string;
    current_count: number;
    limit: number;
    tier_name: string;
    error_code: string;
  };

  constructor(
    status: number,
    detail: { 
      message: string;
      current_count: number;
      limit: number;
      tier_name: string;
      error_code: string;
      [key: string]: any;
    },
    message?: string,
  ) {
    super(message || detail.message || `Project Limit Exceeded: ${status}`);
    this.name = 'ProjectLimitError';
    this.status = status;
    this.detail = detail;
    Object.setPrototypeOf(this, ProjectLimitError.prototype);
  }
}

export class NoAccessTokenAvailableError extends Error {
  constructor(message?: string, options?: { cause?: Error }) {
    super(message || 'No access token available', options);
  }
  name = 'NoAccessTokenAvailableError';
}

export type ProjectRuntime = {
  mode: 'cloud';
  runtime_ref: string;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at?: string;
  runtime?: ProjectRuntime;
  sandbox?: {
    vnc_preview?: string;
    sandbox_url?: string;
    id?: string;
    pass?: string;
  };
  is_public?: boolean; // Flag to indicate if the project is public
  // Icon system field for thread categorization
  icon_name?: string | null;
  [key: string]: any; // Allow additional properties to handle database fields
};

export type Thread = {
  thread_id: string;
  project_id?: string | null;
  is_public?: boolean;
  created_at: string;
  updated_at: string;
  [key: string]: any; // Allow additional properties to handle database fields
};

export type Message = {
  role: string;
  content: string;
  type: string;
  agent_id?: string;
  agents?: {
    name: string;
    profile_image_url?: string;
  };
};

export type ThreadMessageRecord = {
  message_id: string;
  thread_id: string;
  type: string;
  is_llm_message?: boolean;
  content: any;
  metadata?: any;
  created_at?: string;
  updated_at?: string;
  agent_id?: string;
};

export type ClientMessageHint = {
  message_id?: string;
  content?: any;
  metadata?: any;
  role?: string;
  type?: string;
};

export type AgentRun = {
  id: string;
  thread_id: string;
  threadId?: string;
  status: 'running' | 'completed' | 'stopped' | 'error' | 'failed' | 'agent_not_running';
  started_at: string;
  startedAt?: string;
  completed_at: string | null;
  completedAt?: string | null;
  responses?: Message[];
  error?: string | null;
};

export type ToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export interface InitiateAgentResponse {
  thread_id: string;
  agent_run_id: string;
}

export interface HealthCheckResponse {
  status: string;
  timestamp: string;
  instance_id: string;
}

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mod_time: string;
  permissions?: string;
}

export type WorkflowExecution = {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string | null;
  completed_at: string | null;
  result: any;
  error: string | null;
};

export type WorkflowExecutionLog = {
  id: string;
  execution_id: string;
  node_id: string;
  node_name: string;
  node_type: string;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'completed' | 'failed';
  input_data: any;
  output_data: any;
  error: string | null;
};

// Workflow Types
export type Workflow = {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'disabled' | 'archived';
  project_id: string;
  account_id: string;
  definition: {
    name: string;
    description: string;
    nodes: any[];
    edges: any[];
    variables?: Record<string, any>;
  };
  created_at: string;
  updated_at: string;
};

export type WorkflowNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: any;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};

// Project APIs
export const getProjects = async (): Promise<Project[]> => {
  try {
    const supabase = createClient();

    // Get the current user's ID to filter projects
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) {
      console.error('Error getting current user:', userError);
      return [];
    }

    // If no user is logged in, return an empty array
    if (!userData.user) {
      return [];
    }

    const workspaceId = getCurrentWorkspaceId() || userData.user.id;

    // 走后端 /projects：归属校验由服务端做，不再依赖 RLS
    let data: ProjectRecord[];
    try {
      data = await fetchProjects(workspaceId);
    } catch (error) {
      // 后端对无权访问的工作区返回 403，语义等同原先 RLS 的 42501
      if (error instanceof BackendApiError && error.status === 403) {
        console.error('Permission error: User does not have proper account access');
        return [];
      }
      throw error;
    }

    // Map database fields to our Project type
    const mappedProjects: Project[] = (data || []).map((project) => ({
      id: project.project_id,
      name: project.name || '',
      description: project.description || '',
      created_at: project.created_at,
      updated_at: project.updated_at,
      runtime: {
        mode: 'cloud' as const,
        runtime_ref: project.project_id,
      },
      // Include icon field for thread categorization
      icon_name: project.icon_name,
    }));

    return mappedProjects;
  } catch (err) {
    console.error('Error fetching projects:', err);
    handleApiError(err, { operation: 'load projects', resource: 'projects' });
    // Return empty array for permission errors to avoid crashing the UI
    return [];
  }
};

export const getProject = async (projectId: string): Promise<Project> => {
  const supabase = createClient();

  try {
    let data: ProjectRecord;
    try {
      data = await fetchProject(projectId);
    } catch (error) {
      // 后端在不存在/无权访问时返回 404/403，对应原先 PostgREST 的 PGRST116
      if (error instanceof BackendApiError && (error.status === 404 || error.status === 403)) {
        throw new Error(`Project not found or not accessible: ${projectId}`);
      }
      throw error;
    }

    // Map database fields to our Project type
    const mappedProject: Project = {
      id: data.project_id,
      name: data.name || '',
      description: data.description || '',
      is_public: data.is_public || false,
      created_at: data.created_at,
      runtime: {
        mode: 'cloud' as const,
        runtime_ref: data.project_id,
      },
    };

    return mappedProject;
  } catch (error) {
    console.error(`Error fetching project ${projectId}:`, error);
    handleApiError(error, { operation: 'load project', resource: `project ${projectId}` });
    throw error;
  }
};

export const createProject = async (
  projectData: { name: string; description: string },
  accountId?: string,
): Promise<Project> => {
  const supabase = createClient();

  // Resolve workspace account id or fall back to personal account id
  let resolvedAccountId = accountId || getCurrentWorkspaceId();

  if (!resolvedAccountId) {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) throw userError;
    if (!userData.user)
      throw new Error('You must be logged in to create a project');

    // In Basejump, the personal account ID is the same as the user ID
    resolvedAccountId = userData.user.id;
  }

  let data: ProjectRecord;
  try {
    data = await createProjectRequest({
      name: projectData.name,
      description: projectData.description || null,
      account_id: resolvedAccountId,
    });
  } catch (error) {
    handleApiError(error, { operation: 'create project', resource: 'project' });
    throw error;
  }

  const project = {
    id: data.project_id,
    name: data.name,
    description: data.description || '',
    created_at: data.created_at,
    runtime: {
      mode: 'cloud' as const,
      runtime_ref: data.project_id,
    },
  };
  return project;
};

export const updateProject = async (
  projectId: string,
  data: Partial<Project>,
): Promise<Project> => {
  const supabase = createClient();

  // Sanity check to avoid update errors
  if (!projectId || projectId === '') {
    console.error('Attempted to update project with invalid ID:', projectId);
    throw new Error('Cannot update project: Invalid project ID');
  }

  let updatedData: ProjectRecord;
  try {
    updatedData = await updateProjectRequest(projectId, {
      name: data.name,
      description: data.description,
    });
  } catch (error) {
    console.error('Error updating project:', error);
    handleApiError(error, { operation: 'update project', resource: `project ${projectId}` });
    throw error;
  }

  if (!updatedData) {
    const noDataError = new Error('No data returned from update');
    handleApiError(noDataError, { operation: 'update project', resource: `project ${projectId}` });
    throw noDataError;
  }

  // Dispatch a custom event to notify components about the project change
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('project-updated', {
        detail: {
          projectId,
          updatedData: {
            id: updatedData.project_id,
            name: updatedData.name,
            description: updatedData.description,
          },
        },
      }),
    );
  }

  // Return formatted project data - use same mapping as getProject
  const project = {
    id: updatedData.project_id,
    name: updatedData.name,
    description: updatedData.description || '',
    created_at: updatedData.created_at,
    runtime: {
      mode: 'cloud' as const,
      runtime_ref: updatedData.project_id,
    },
  };
  return project;
};

export const deleteProject = async (projectId: string): Promise<void> => {
  try {
    await deleteProjectRequest(projectId);
  } catch (error) {
    handleApiError(error, { operation: 'delete project', resource: `project ${projectId}` });
    throw error;
  }
};

// Thread APIs
export const getThreads = async (projectId?: string): Promise<Thread[]> => {
  const supabase = createClient();

  // Get the current user's ID to filter threads
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) {
    console.error('Error getting current user:', userError);
    return [];
  }

  // If no user is logged in, return an empty array
  if (!userData.user) {
    return [];
  }

  const workspaceId = getCurrentWorkspaceId() || userData.user.id;
  let query = supabase.from('threads').select('*');

  // Always filter by the active workspace account ID
  query = query.eq('account_id', workspaceId);

  if (projectId) {
    query = query.eq('project_id', projectId);
  }

  const { data, error } = await query;

  if (error) {
    handleApiError(error, { operation: 'load threads', resource: projectId ? `threads for project ${projectId}` : 'threads' });
    throw error;
  }

  const mappedThreads: Thread[] = (data || [])
    .map((thread) => ({
      thread_id: thread.thread_id,
      project_id: thread.project_id,
      created_at: thread.created_at,
      updated_at: thread.updated_at,
      metadata: thread.metadata,
    }));
  return mappedThreads;
};

export const getThread = async (threadId: string): Promise<Thread> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('threads')
    .select('*')
    .eq('thread_id', threadId)
    .single();

  if (error) {
    handleApiError(error, { operation: 'load thread', resource: `thread ${threadId}` });
    throw error;
  }

  return data;
};

export const createThread = async (projectId: string): Promise<Thread> => {
  const supabase = createClient();

  // If user is not logged in, redirect to login
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be logged in to create a thread');
  }

  const workspaceId = getCurrentWorkspaceId() || user.id;
  const { data, error } = await supabase
    .from('threads')
    .insert({
      project_id: projectId,
      account_id: workspaceId,
    })
    .select()
    .single();

  if (error) {
    handleApiError(error, { operation: 'create thread', resource: 'thread' });
    throw error;
  }
  return data;
};

export interface MessageAttachmentInput {
  file_id: string;
  name?: string;
  size?: number;
  content_type?: string;
}

export const addUserMessage = async (
  threadId: string,
  content: string,
  context?: any,
  referenceImages?: import('@/lib/reference-images').ReferenceImageInput[],
  attachments?: MessageAttachmentInput[],
  ctaAction?: string,
  ctaPayload?: any,
  ctaLabel?: string,
  docContext?: any,
): Promise<ThreadMessageRecord | null> => {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new NoAccessTokenAvailableError();

  if (!API_URL) {
    throw new Error('Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.');
  }

  const payload: Record<string, any> = { message: content };
  if (context) {
    payload.context = context;
  }
  if (ctaAction) {
    payload.cta_action = ctaAction;
  }
  if (ctaPayload !== undefined) {
    payload.cta_payload = ctaPayload;
  }
  if (ctaLabel) {
    payload.cta_label = ctaLabel;
  }
  if (referenceImages && referenceImages.length > 0) {
    payload.reference_images = referenceImages;
  }
  if (attachments && attachments.length > 0) {
    payload.attachments = attachments;
  }
  if (docContext) {
    payload.doc_context = docContext;
  }

  const response = await fetch(`${API_URL}/threads/${threadId}/messages/add`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const payload = await parseErrorResponse(response);
    const detail = ensureDetailObject(
      extractDetailPayload(payload),
      `Error adding message: ${response.statusText} (${response.status})`,
    );
    const apiError = new Error(detail.message) as ApiError;
    apiError.status = response.status;
    apiError.detail = detail;

    console.error(
      'Error adding user message via backend:',
      response.status,
      response.statusText,
      detail,
    );
    handleApiError(apiError, {
      operation: 'send message',
      resource: 'AI assistant',
    });
    throw apiError;
  }

  try {
    const data = await response.json();
    return data as ThreadMessageRecord;
  } catch {
    return null;
  }
};

export const getMessages = async (threadId: string): Promise<Message[]> => {
  const supabase = createClient();

  let allMessages: Message[] = [];
  let from = 0;
  const batchSize = 1000;
  let hasMore = true;

  // Detect whether we can safely join the agents table (anon/public contexts may fail on RLS)
  let useJoinSelect = true;
  try {
    const probe = await supabase
      .from('messages')
      .select(`message_id, agents:agent_id ( name )`)
      .eq('thread_id', threadId)
      .limit(1);
    if (probe.error) {
      // Permission or RLS error – fall back to simple select without join
      useJoinSelect = false;
      // Log at info level, but do not toast; this is expected for public share views
      console.info('[getMessages] Falling back to simple select (no agents join):', probe.error?.message || probe.error);
    }
  } catch (e) {
    // Any unexpected error on probe – be conservative and avoid join
    useJoinSelect = false;
    console.info('[getMessages] Probe failed; using simple select without join');
  }

  const selectClause = useJoinSelect
    ? `
        *,
        agents:agent_id (
          name
        )
      `
    : '*';

  while (hasMore) {
    const { data, error } = await supabase
      .from('messages')
      .select(selectClause)
      .eq('thread_id', threadId)
      .neq('type', 'cost')
      .neq('type', 'summary')
      .order('created_at', { ascending: true })
      .range(from, from + batchSize - 1);

    if (error) {
      // If join was initially allowed but later fails (edge case), retry once without join for this and remaining batches
      if (useJoinSelect) {
        console.warn('[getMessages] Join select failed during pagination; retrying without join:', error.message || error);
        useJoinSelect = false;
        const { data: dataFallback, error: errorFallback } = await supabase
          .from('messages')
          .select('*')
          .eq('thread_id', threadId)
          .neq('type', 'cost')
          .neq('type', 'summary')
          .order('created_at', { ascending: true })
          .range(from, from + batchSize - 1);

        if (errorFallback) {
          console.error('Error fetching messages (fallback):', errorFallback);
          handleApiError(errorFallback, { operation: 'load messages', resource: `messages for thread ${threadId}` });
          throw new Error(`Error getting messages: ${errorFallback.message}`);
        }

        if (dataFallback && dataFallback.length > 0) {
          allMessages = allMessages.concat(dataFallback as unknown as Message[]);
          from += batchSize;
          hasMore = dataFallback.length === batchSize;
          continue;
        } else {
          hasMore = false;
          break;
        }
      }

      console.error('Error fetching messages:', error);
      handleApiError(error, { operation: 'load messages', resource: `messages for thread ${threadId}` });
      throw new Error(`Error getting messages: ${error.message}`);
    }

    if (data && data.length > 0) {
      allMessages = allMessages.concat(data as unknown as Message[]);
      from += batchSize;
      hasMore = data.length === batchSize;
    } else {
      hasMore = false;
    }
  }

  return allMessages;
};

// Ensure a thread exists for a given canvas and return its id
export const ensureCanvasThread = async (canvasId: string): Promise<{ thread_id: string }> => {
  // Try to get token on client (optional)
  let token: string | null = null;
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    token = session?.access_token || null;
  } catch {}

  const workspaceId = getCurrentWorkspaceId();

  // Attempt via Next proxy; if token exists, include as query to maximize success
  try {
    const nextPath = token
      ? `/api/canvases/${encodeURIComponent(canvasId)}/ensure-thread?token=${encodeURIComponent(token)}`
      : `/api/canvases/${encodeURIComponent(canvasId)}/ensure-thread`;
    const response = await fetch(nextPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
      },
    });
    if (response.ok) {
      const data = await response.json();
      return { thread_id: data.thread_id };
    } else {
      try {
        const body = await response.text();
        console.error('[ensureCanvasThread] Next proxy failed:', response.status, body);
      } catch {}
    }
  } catch (e) {
    console.warn('[ensureCanvasThread] Next proxy call threw:', e);
  }

  // Direct backend fallback (requires token)
  try {
    if (!token) throw new NoAccessTokenAvailableError();
    const base = API_URL || '';
    if (!base) throw new Error('Backend URL is not configured');
    const url = `${base}/canvases/${encodeURIComponent(canvasId)}/ensure-thread?token=${encodeURIComponent(token)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
      },
    });
    if (!resp.ok) {
      const msg = 'Failed to ensure thread for canvas';
      try { const err = await resp.text(); console.error('[ensureCanvasThread] Backend fallback failed:', resp.status, err); } catch {}
      throw new Error(msg);
    }
    const data = await resp.json();
    return { thread_id: data.thread_id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to ensure thread for canvas';
    throw new Error(msg);
  }
};

// Peek canvas thread without creating one
export const peekCanvasThread = async (canvasId: string): Promise<{ exists: boolean; thread_id?: string }> => {
  const workspaceId = getCurrentWorkspaceId();
  const resp = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/thread`, {
    method: 'GET',
    cache: 'no-store',
    headers: workspaceId ? { 'X-Workspace-Id': workspaceId } : undefined,
  });
  if (!resp.ok) {
    let msg = 'Failed to peek thread';
    try { const err = await resp.json(); msg = err?.detail?.message || err?.detail || resp.statusText; } catch {}
    throw new Error(msg);
  }
  return await resp.json();
};

// Ensure a thread exists for a given doc and return its id
export const ensureDocThread = async (itemId: string): Promise<{ thread_id: string }> => {
  const workspaceId = getCurrentWorkspaceId();
  const response = await fetch(`/api/docs/${encodeURIComponent(itemId)}/ensure-thread`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
    },
  });

  if (!response.ok) {
    let message = 'Failed to ensure thread for doc';
    try {
      const err = await response.json();
      message = err?.detail?.message || err?.detail || response.statusText || message;
    } catch {}
    throw new Error(message);
  }

  const data = await response.json();
  return { thread_id: data.thread_id };
};

// Peek doc thread without creating one
export const peekDocThread = async (itemId: string): Promise<{ exists: boolean; thread_id?: string }> => {
  const workspaceId = getCurrentWorkspaceId();
  const response = await fetch(`/api/docs/${encodeURIComponent(itemId)}/thread`, {
    method: 'GET',
    cache: 'no-store',
    headers: workspaceId ? { 'X-Workspace-Id': workspaceId } : undefined,
  });

  if (!response.ok) {
    let message = 'Failed to peek thread for doc';
    try {
      const err = await response.json();
      message = err?.detail?.message || err?.detail || response.statusText || message;
    } catch {}
    throw new Error(message);
  }

  return await response.json();
};

export const listDocRevisions = async (
  itemId: string,
  options?: { limit?: number },
): Promise<DocRevisionListResponse> => {
  const workspaceId = getCurrentWorkspaceId();
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.floor(options.limit))
      : 50;
  const response = await fetch(
    `/api/docs/${encodeURIComponent(itemId)}/revisions?limit=${encodeURIComponent(String(limit))}`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: workspaceId ? { 'X-Workspace-Id': workspaceId } : undefined,
    },
  );

  if (!response.ok) {
    let message = 'Failed to list doc revisions';
    try {
      const err = await response.json();
      message = err?.detail?.message || err?.detail || response.statusText || message;
    } catch {}
    throw new Error(message);
  }

  return await response.json();
};

export const getDocRevision = async (
  itemId: string,
  revisionId: string,
): Promise<DocRevision> => {
  const workspaceId = getCurrentWorkspaceId();
  const response = await fetch(
    `/api/docs/${encodeURIComponent(itemId)}/revisions/${encodeURIComponent(revisionId)}`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: workspaceId ? { 'X-Workspace-Id': workspaceId } : undefined,
    },
  );

  if (!response.ok) {
    let message = 'Failed to load doc revision';
    try {
      const err = await response.json();
      message = err?.detail?.message || err?.detail || response.statusText || message;
    } catch {}
    throw new Error(message);
  }

  return await response.json();
};

export const undoDocRevision = async (
  itemId: string,
  revisionId: string,
  payload?: {
    expectedCurrentVersion?: number;
    summary?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<ApplyDocOpsResponse> => {
  const workspaceId = getCurrentWorkspaceId();
  const response = await fetch(
    `/api/docs/${encodeURIComponent(itemId)}/revisions/${encodeURIComponent(revisionId)}/undo`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
      },
      body: JSON.stringify(payload || {}),
    },
  );

  if (!response.ok) {
    let message = 'Failed to undo revision';
    try {
      const err = await response.json();
      message = err?.detail?.message || err?.detail || response.statusText || message;
    } catch {}
    throw new Error(message);
  }

  return await response.json();
};

// Generate a concise academic canvas title using a low-cost model (server-side proxy)
export const generateCanvasTitle = async (
  canvasId: string,
  prompt: string,
): Promise<{ title: string }> => {
  const workspaceId = getCurrentWorkspaceId();
  const resp = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/generate-title`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
    },
    body: JSON.stringify({ prompt }),
  });
  if (!resp.ok) {
    // Do not throw hard; return fallback title to avoid blocking UX
    const fallback = (prompt || 'Untitled').slice(0, 50);
    return { title: fallback };
  }
  return await resp.json();
};

export const generateCanvasMedia = async (
  canvasId: string,
  payload: {
    thread_id: string;
    prompt: string;
    aspect_ratio?: string;
    quantity?: number;
    model?: string;
    reference_images?: import('@/lib/reference-images').ReferenceImageInput[];
  },
): Promise<any> => {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new NoAccessTokenAvailableError();

  if (!API_URL) {
    throw new Error('Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.');
  }

  const response = await fetch(`${API_URL}/canvases/${encodeURIComponent(canvasId)}/media/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errPayload = await parseErrorResponse(response);
    const detail = ensureDetailObject(
      extractDetailPayload(errPayload),
      `Error generating canvas media: ${response.statusText} (${response.status})`,
    );
    const apiError = new Error(detail.message) as ApiError;
    apiError.status = response.status;
    apiError.detail = detail;
    handleApiError(apiError, {
      operation: 'generate canvas media',
      resource: 'canvas',
    });
    throw apiError;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
};

export type CanvasNodeSearchResult = {
  canvas_id: string;
  canvas_title?: string | null;
  folder_id?: string | null;
  node_id: string;
  node_type: string;
  node_subtype?: string | null;
  title_text?: string | null;
  preview_text?: string | null;
  highlight_ranges?: Array<{ start: number; end: number }>;
  node_x?: number | null;
  node_y?: number | null;
  node_width?: number | null;
  node_height?: number | null;
  node_updated_at?: string | null;
};

export type CanvasNodeSearchResponse = {
  results: CanvasNodeSearchResult[];
  next_cursor?: string | null;
  took_ms?: number;
};

export const searchCanvasNodes = async (payload: {
  query: string;
  limit?: number;
  cursor?: string | null;
  scope?: 'workspace' | 'canvas';
  node_types?: string[];
  canvas_ids?: string[];
  folder_ids?: string[];
  include_archived?: boolean;
}): Promise<CanvasNodeSearchResponse> => {
  const workspaceId = getCurrentWorkspaceId();
  const resp = await fetch('/api/search/nodes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    let msg = 'Search failed';
    try {
      const err = await resp.json();
      msg = err?.detail || err?.message || msg;
    } catch {}
    throw new Error(msg);
  }
  return await resp.json();
};

// List deleted canvases (trash) with optional search/sort/pagination
export const listDeletedCanvases = async (opts?: {
  q?: string;
  limit?: number;
  offset?: number;
  sort_by?: 'deleted_at' | 'title' | 'node_count';
  sort_dir?: 'asc' | 'desc';
}): Promise<{ items: Array<{ id: string; title: string; deleted_at?: string; days_remaining?: number; created_at?: string; updated_at?: string; node_count?: number; connection_count?: number }>; retention_days: number; total_count?: number }> => {
  const workspaceId = getCurrentWorkspaceId();
  const params = new URLSearchParams();
  if (opts?.q) params.set('q', opts.q);
  if (typeof opts?.limit === 'number') params.set('limit', String(opts.limit));
  if (typeof opts?.offset === 'number') params.set('offset', String(opts.offset));
  if (opts?.sort_by) params.set('sort_by', opts.sort_by);
  if (opts?.sort_dir) params.set('sort_dir', opts.sort_dir);
  const qs = params.toString();
  const resp = await fetch(`/api/canvases/trash${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
    headers: workspaceId ? { 'X-Workspace-Id': workspaceId } : undefined,
  });
  if (!resp.ok) throw new Error('Failed to list deleted canvases');
  return await resp.json();
};

// Restore a deleted canvas
export const restoreCanvas = async (canvasId: string): Promise<any> => {
  const workspaceId = getCurrentWorkspaceId();
  const resp = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/restore`, {
    method: 'POST',
    headers: workspaceId ? { 'X-Workspace-Id': workspaceId } : undefined,
  });
  if (!resp.ok) throw new Error('Failed to restore canvas');
  return await resp.json();
};

// Purge expired deleted canvases (default 15 days)
export const purgeDeletedCanvases = async (days = 15): Promise<void> => {
  const workspaceId = getCurrentWorkspaceId();
  const resp = await fetch(`/api/canvases/purge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
    },
    body: JSON.stringify({ days })
  });
  if (!resp.ok) throw new Error('Failed to purge canvases');
};

// Agent APIs
export const startAgent = async (
  threadId: string,
  options?: {
    model_name?: string;
    enable_thinking?: boolean;
    reasoning_effort?: string;
    stream?: boolean;
    agent_id?: string; // Optional again
    run_mode?: RunMode;
    interaction_surface?: 'canvas' | 'doc';
    response_mode?: 'auto' | 'preview' | 'confirm' | 'force_apply';
    resume_token?: string;
    selection_context?: Record<string, any>;
    workspace_target?: Record<string, any>;
    client_message?: ClientMessageHint;
  },
): Promise<{ agent_run_id: string }> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new NoAccessTokenAvailableError();
    }

    // Check if backend URL is configured
    if (!API_URL) {
      throw new Error(
        'Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.',
      );
    }

    const defaultOptions = {
      reasoning_effort: 'low',
      stream: true,
    } as const;

    const finalOptions = { ...defaultOptions, ...options };

    const body: any = {
      reasoning_effort: finalOptions.reasoning_effort,
      stream: finalOptions.stream,
    };
    if (finalOptions.model_name) {
      body.model_name = finalOptions.model_name;
    }
    if (typeof (finalOptions as any).enable_thinking !== 'undefined') {
      body.enable_thinking = (finalOptions as any).enable_thinking;
    }
    
    // Only include agent_id if it's provided
    if (finalOptions.agent_id) {
      body.agent_id = finalOptions.agent_id;
    }
    if (finalOptions.run_mode) {
      body.run_mode = finalOptions.run_mode;
    }
    if (finalOptions.interaction_surface) {
      body.interaction_surface = finalOptions.interaction_surface;
    }
    if (finalOptions.response_mode) {
      body.response_mode = finalOptions.response_mode;
    }
    if (finalOptions.resume_token) {
      body.resume_token = finalOptions.resume_token;
    }
    if (finalOptions.selection_context) {
      body.selection_context = finalOptions.selection_context;
    }
    if (finalOptions.workspace_target) {
      body.workspace_target = finalOptions.workspace_target;
    }
    if (finalOptions.client_message) {
      body.client_message = finalOptions.client_message;
    }

    const response = await fetch(`${API_URL}/thread/${threadId}/agent/start`, {
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
          const errorData = await parseErrorResponse(response);
          const detail = ensureDetailObject(
            extractDetailPayload(errorData),
            'Payment Required',
          );
          throw new BillingError(response.status, detail);
        } catch (parseError) {
          throw new BillingError(
            response.status,
            { message: 'Payment Required' },
            `Error starting agent: ${response.statusText} (402)`,
          );
        }
      }

      if (response.status === 429) {
          const errorData = await parseErrorResponse(response);
          const detailRaw = extractDetailPayload(errorData);
          const detail = ensureDetailObject(detailRaw, 'Too many agent runs running');
          if (!Array.isArray(detail.running_thread_ids)) {
            detail.running_thread_ids = Array.isArray(detailRaw?.running_thread_ids) ? detailRaw.running_thread_ids : [];
          }
          if (typeof detail.running_count !== 'number') {
            detail.running_count = typeof detailRaw?.running_count === 'number' ? detailRaw.running_count : 0;
          }
          throw new AgentRunLimitError(response.status, detail);
      }

      // Check for project limit errors (402 with PROJECT_LIMIT_EXCEEDED error_code)
      if (response.status === 402) {
        try {
          const errorData = await parseErrorResponse(response);
          const detail = extractDetailPayload(errorData) || {};
          
          if (detail.error_code === 'PROJECT_LIMIT_EXCEEDED') {
            throw new ProjectLimitError(response.status, {
              message: detail.message || 'Project limit exceeded',
              current_count: detail.current_count || 0,
              limit: detail.limit || 0,
              tier_name: detail.tier_name || 'none',
              error_code: detail.error_code
            });
          }
        } catch (parseError) {
          if (parseError instanceof ProjectLimitError) {
            throw parseError;
          }
          // If it's not a project limit error, continue to general error handling
        }
      }

      const payload = await parseErrorResponse(response);
      const detail = ensureDetailObject(
        extractDetailPayload(payload),
        `Error starting agent: ${response.statusText} (${response.status})`,
      );
      console.error(
        `[API] Error starting agent: ${response.status} ${response.statusText}`,
        detail,
      );
      const apiError = new Error(detail.message) as ApiError;
      apiError.status = response.status;
      apiError.detail = detail;
      throw apiError;
    }

    const result = await response.json();
    return result;
  } catch (error) {
    if (error instanceof BillingError || error instanceof AgentRunLimitError) {
      throw error;
    }

    if (error instanceof NoAccessTokenAvailableError) {
      throw error;
    }

    console.error('[API] Failed to start agent:', error);
    
    if (
      error instanceof TypeError &&
      error.message.includes('Failed to fetch')
    ) {
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
    existingStream.close();
    activeStreams.delete(agentRunId);
  }

  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    const authError = new NoAccessTokenAvailableError();
    handleApiError(authError, { operation: 'stop agent', resource: 'AI assistant' });
    throw authError;
  }

  const response = await fetch(`${API_URL}/agent-run/${agentRunId}/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    cache: 'no-store',
  });

  posthog.capture('task_abandoned', { agentRunId });

  if (!response.ok) {
    const stopError = new Error(`Error stopping agent: ${response.statusText}`);
    handleApiError(stopError, { operation: 'stop agent', resource: 'AI assistant' });
    throw stopError;
  }
};

export const getAgentStatus = async (agentRunId: string): Promise<AgentRun> => {
  if (nonRunningAgentRuns.has(agentRunId)) {
    throw new Error(`Agent run ${agentRunId} is not running`);
  }

  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      console.error('[API] No access token available for getAgentStatus');
      throw new NoAccessTokenAvailableError();
    }

    const url = `${API_URL}/agent-run/${agentRunId}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `[API] Error getting agent status: ${response.status} ${response.statusText}`,
        errorText,
      );
      if (response.status === 404) {
        nonRunningAgentRuns.add(agentRunId);
      }

      throw new Error(
        `Error getting agent status: ${response.statusText} (${response.status})`,
      );
    }

    const data = await response.json();
    if (data.status !== 'running') {
      nonRunningAgentRuns.add(agentRunId);
    }

    return data;
  } catch (error) {
    console.error('[API] Failed to get agent status:', error);
    handleApiError(error, { operation: 'get agent status', resource: 'AI assistant status', silent: true });
    throw error;
  }
};

export interface AgentIconGenerationRequest {
  name: string;
  description?: string;
}

export interface AgentIconGenerationResponse {
  icon_name: string;
  icon_color: string;
  icon_background: string;
}

export const generateAgentIcon = async (request: AgentIconGenerationRequest): Promise<AgentIconGenerationResponse> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new NoAccessTokenAvailableError();
    }

    const response = await fetch(`${API_URL}/agents/generate-icon`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `[API] Error generating agent icon: ${response.status} ${response.statusText}`,
        errorText,
      );

      throw new Error(
        `Error generating agent icon: ${response.statusText} (${response.status})`,
      );
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[API] Failed to generate agent icon:', error);
    handleApiError(error, { operation: 'generate agent icon', resource: 'agent icon generation' });
    throw error;
  }
};

export const getAgentRuns = async (threadId: string): Promise<AgentRun[]> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new NoAccessTokenAvailableError();
    }

    const response = await fetch(`${API_URL}/thread/${threadId}/agent-runs`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: 'no-store',
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
    onClose: () => void;
  },
): (() => void) => {
  if (nonRunningAgentRuns.has(agentRunId)) {
    setTimeout(() => {
      callbacks.onError(`Agent run ${agentRunId} is not running`);
      callbacks.onClose();
    }, 0);

    return () => {};
  }

  const existingStream = activeStreams.get(agentRunId);
  if (existingStream) {
    cleanupEventSource(agentRunId, 'replacing existing stream');
  }

  try {
    const setupStream = async () => {

      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        const authError = new NoAccessTokenAvailableError();
        callbacks.onError(authError);
        callbacks.onClose();
        return;
      }

      const url = new URL(`${API_URL}/agent-run/${agentRunId}/stream`);
      url.searchParams.append('token', session.access_token);

      const eventSource = new EventSource(url.toString());

      activeStreams.set(agentRunId, eventSource);

      // Safety timeout to prevent indefinite connections (30 minutes)
      const safetyTimeout = setTimeout(() => {
        console.warn(`[STREAM] Safety timeout reached for ${agentRunId}, cleaning up`);
        cleanupEventSource(agentRunId, 'safety timeout');
        callbacks.onError('Connection timeout - stream has been running too long');
        callbacks.onClose();
      }, 30 * 60 * 1000); // 30 minutes

      // Store the timeout ID for cleanup
      safetyTimeouts.set(agentRunId, safetyTimeout as unknown as number);

      eventSource.onopen = () => {
        console.log(`[STREAM] EventSource opened for ${agentRunId}`);
      };

      let sawTerminalStatus = false;
      let closedByClient = false;
      eventSource.onmessage = (event) => {
        try {
          const rawData = event.data;
          if (rawData.includes('"type": "ping"')) return;

          // Skip empty messages
          if (!rawData || rawData.trim() === '') {
            return;
          }

          // Check for error status messages
          try {
            const jsonData = JSON.parse(rawData);
            if (jsonData?.type !== 'status' && jsonData.status === 'error') {
              console.error(`[STREAM] Error status received for ${agentRunId}:`, jsonData);
              
              // Pass the error message to the callback
              callbacks.onError(jsonData.message || 'Unknown error occurred');
              
              // Don't close the stream for error status messages as they may continue
              return;
            }
          } catch (jsonError) {
            // Not JSON or invalid JSON, continue with normal processing
          }

          // Check for "Agent run not found" error
          if (
            rawData.includes('Agent run') &&
            rawData.includes('not found in active runs')
          ) {
            // Add to non-running set to prevent future reconnection attempts
            nonRunningAgentRuns.add(agentRunId);

            // Notify about the error
            callbacks.onError('Agent run not found in active runs');

            // Clean up
            cleanupEventSource(agentRunId, 'agent run not found');
            callbacks.onClose();

            return;
          }

          // Treat terminal status payloads as completion hints; don't close early
          try {
            const jd = JSON.parse(rawData);
            if (
              jd?.type === 'status' &&
              ['completed', 'failed', 'stopped', 'error', 'END_STREAM', 'STOP', 'ERROR'].includes(
                String(jd.status),
              )
            ) {
              sawTerminalStatus = true;
              if (rawData.includes('Agent run completed successfully')) {
                nonRunningAgentRuns.add(agentRunId);
              }
              callbacks.onMessage(rawData);
              // Proactively close the stream on terminal status to avoid hanging connections.
              closedByClient = true;
              cleanupEventSource(agentRunId, 'terminal status received');
              callbacks.onClose();
              return;
            }
          } catch {}

          // Check for thread run end message
          if (
            rawData.includes('"type": "status"') &&
            rawData.includes('thread_run_end')
          ) {
            // Notify about the message
            callbacks.onMessage(rawData);
            return;
          }

          // For all other messages, just pass them through
          callbacks.onMessage(rawData);
        } catch (error) {
          console.error(`[STREAM] Error handling message:`, error);
          callbacks.onError(error instanceof Error ? error : String(error));
        }
      };

      eventSource.onerror = (event) => {
        if (closedByClient) {
          return;
        }
        if (sawTerminalStatus) {
          cleanupEventSource(agentRunId, 'stream closed after terminal status');
          callbacks.onClose();
          return;
        }
        if (eventSource.readyState === EventSource.CLOSED) {
          cleanupEventSource(agentRunId, 'stream closed');
          callbacks.onClose();
          return;
        }
        console.warn(`[STREAM] EventSource error for ${agentRunId}:`, event);

        // Helper to detect transient connection limit issues
        const isTransientConnLimit = (msg: string) => {
          const lower = msg.toLowerCase();
          return (
            lower.includes('too many connections') ||
            lower.includes('max number of clients') ||
            lower.includes('maxclients') ||
            lower.includes('redis is busy') ||
            lower.includes('resource temporarily unavailable')
          );
        };

        // Check if the agent is still running
        getAgentStatus(agentRunId)
          .then((status) => {
            if (status.status !== 'running') {
              nonRunningAgentRuns.add(agentRunId);
              cleanupEventSource(agentRunId, 'agent not running');
              callbacks.onClose();
            } else {
              // Agent is running; treat stream errors as transient and allow auto-reconnect
              console.warn(`[STREAM] Agent still running; keeping stream for auto-reconnect`);
            }
          })
          .catch((err) => {
            // If status check itself fails with a connection limit, treat as transient and do not surface a hard error
            const errMsg = err instanceof Error ? err.message : String(err);
            const isNotFoundErr =
              errMsg.includes('not found') ||
              errMsg.includes('404') ||
              errMsg.includes('does not exist');

            if (isNotFoundErr) {
              nonRunningAgentRuns.add(agentRunId);
              cleanupEventSource(agentRunId, 'agent not found');
              callbacks.onClose();
              return;
            }

            if (isTransientConnLimit(errMsg)) {
              // Suppress user-facing error; let EventSource retry
              console.warn(
                `[STREAM] Suppressing transient connection-limit error and allowing auto-reconnect: ${errMsg}`,
              );
              return;
            }

            // For other errors, clean up to prevent leaks and surface the message
            console.warn(`[STREAM] Cleaning up stream for ${agentRunId} due to persistent error`);
            cleanupEventSource(agentRunId, 'persistent error');
            callbacks.onError(errMsg);
            callbacks.onClose();
          });
      };
    };

    // Start the stream setup
    setupStream();

    // Return a cleanup function
    return () => {
      cleanupEventSource(agentRunId, 'manual cleanup');
    };
  } catch (error) {
    console.error(`[STREAM] Error setting up stream for ${agentRunId}:`, error);
    callbacks.onError(error instanceof Error ? error : String(error));
    callbacks.onClose();
    return () => {};
  }
};

// Sandbox API Functions
export const createSandboxFile = async (
  sandboxId: string,
  filePath: string,
  content: string,
): Promise<void> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    // Use FormData to handle both text and binary content more reliably
    const formData = new FormData();
    formData.append('path', filePath);

    // Create a Blob from the content string and append as a file
    const blob = new Blob([content], { type: 'application/octet-stream' });
    formData.append('file', blob, filePath.split('/').pop() || 'file');

    const headers: Record<string, string> = {};
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(`${API_URL}/runtime/${sandboxId}/files`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error creating sandbox file: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error creating sandbox file: ${response.statusText} (${response.status})`,
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Failed to create sandbox file:', error);
    handleApiError(error, { operation: 'create file', resource: `file ${filePath}` });
    throw error;
  }
};

// Fallback method for legacy support using JSON
export const createSandboxFileJson = async (
  sandboxId: string,
  filePath: string,
  content: string,
): Promise<void> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(
      `${API_URL}/runtime/${sandboxId}/files/json`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          path: filePath,
          content: content,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error creating sandbox file (JSON): ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error creating sandbox file: ${response.statusText} (${response.status})`,
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Failed to create sandbox file with JSON:', error);
    handleApiError(error, { operation: 'create file', resource: `file ${filePath}` });
    throw error;
  }
};

// Helper function to normalize file paths with Unicode characters
function normalizePathWithUnicode(path: string): string {
  try {
    // Replace escaped Unicode sequences with actual characters
    return path.replace(/\\u([0-9a-fA-F]{4})/g, (_, hexCode) => {
      return String.fromCharCode(parseInt(hexCode, 16));
    });
  } catch (e) {
    console.error('Error processing Unicode escapes in path:', e);
    return path;
  }
}

export const listSandboxFiles = async (
  sandboxId: string,
  path: string,
): Promise<FileInfo[]> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const url = new URL(`${API_URL}/runtime/${sandboxId}/files`);
    
    // Normalize the path to handle Unicode escape sequences
    const normalizedPath = normalizePathWithUnicode(path);
    
    // Properly encode the path parameter for UTF-8 support
    url.searchParams.append('path', normalizedPath);

    const headers: Record<string, string> = {};
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(url.toString(), {
      headers,
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error listing sandbox files: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error listing sandbox files: ${response.statusText} (${response.status})`,
      );
    }

    const data = await response.json();
    return data.files || [];
  } catch (error) {
    console.error('Failed to list sandbox files:', error);
    // handleApiError(error, { operation: 'list files', resource: `directory ${path}` });
    throw error;
  }
};

export const getSandboxFileContent = async (
  sandboxId: string,
  path: string,
): Promise<string | Blob> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const url = new URL(`${API_URL}/runtime/${sandboxId}/files/content`);
    
    // Normalize the path to handle Unicode escape sequences
    const normalizedPath = normalizePathWithUnicode(path);
    
    // Properly encode the path parameter for UTF-8 support
    url.searchParams.append('path', normalizedPath);

    const headers: Record<string, string> = {};
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(url.toString(), {
      headers,
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error getting sandbox file content: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error getting sandbox file content: ${response.statusText} (${response.status})`,
      );
    }

    // Check if it's a text file or binary file based on content-type
    const contentType = response.headers.get('content-type');
    if (
      (contentType && contentType.includes('text')) ||
      contentType?.includes('application/json')
    ) {
      return await response.text();
    } else {
      return await response.blob();
    }
  } catch (error) {
    console.error('Failed to get sandbox file content:', error);
    handleApiError(error, { operation: 'load file content', resource: `file ${path}` });
    throw error;
  }
};

// Function to get public projects
export const getPublicProjects = async (): Promise<Project[]> => {
  try {
    const supabase = createClient();

    // Query for threads that are marked as public
    const { data: publicThreads, error: threadsError } = await supabase
      .from('threads')
      .select('project_id')
      .eq('is_public', true);

    if (threadsError) {
      console.error('Error fetching public threads:', threadsError);
      return [];
    }

    // If no public threads found, return empty array
    if (!publicThreads?.length) {
      return [];
    }

    // Extract unique project IDs from public threads
    const publicProjectIds = [
      ...new Set(publicThreads.map((thread) => thread.project_id)),
    ].filter(Boolean);

    // If no valid project IDs, return empty array
    if (!publicProjectIds.length) {
      return [];
    }

    // Get the projects that have public threads
    const { data: projects, error: projectsError } = await supabase
      .from('projects')
      .select('*')
      .in('project_id', publicProjectIds);

    if (projectsError) {
      console.error('Error fetching public projects:', projectsError);
      return [];
    }

    // Map database fields to our Project type
    const mappedProjects: Project[] = (projects || []).map((project) => ({
      id: project.project_id,
      name: project.name || '',
      description: project.description || '',
      created_at: project.created_at,
      updated_at: project.updated_at,
      runtime: {
        mode: 'cloud' as const,
        runtime_ref: project.project_id,
      },
      is_public: true, // Mark these as public projects
    }));

    return mappedProjects;
  } catch (err) {
    console.error('Error fetching public projects:', err);
    handleApiError(err, { operation: 'load public projects', resource: 'public projects' });
    return [];
  }
};


export const initiateAgent = async (
  formData: FormData,
): Promise<InitiateAgentResponse> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new NoAccessTokenAvailableError();
    }

    if (!API_URL) {
      throw new Error(
        'Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.',
      );
    }

    const response = await fetch(`${API_URL}/agent/initiate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...getWorkspaceHeaders(),
      },
      body: formData,
      cache: 'no-store',
    });

    if (!response.ok) {
      // Check for 402 Payment Required first
      if (response.status === 402) {
        try {
          const errorData = await response.json();
          // Ensure detail exists and has a message property
          const detail = errorData?.detail || { message: 'Payment Required' };
          if (typeof detail.message !== 'string') {
            detail.message = 'Payment Required'; // Default message if missing
          }
          throw new BillingError(response.status, detail);
        } catch (parseError) {
          // Handle cases where parsing fails or the structure isn't as expected
          throw new BillingError(
            response.status,
            { message: 'Payment Required' },
            `Error initiating agent: ${response.statusText} (402)`,
          );
        }
      }

      // Check for 429 Too Many Requests (Agent Run Limit)
      if (response.status === 429) {
          const errorData = await response.json();
          // Ensure detail exists and has required properties
          const detail = errorData?.detail || { 
            message: 'Too many agent runs running',
            running_thread_ids: [],
            running_count: 0,
          };
          if (typeof detail.message !== 'string') {
            detail.message = 'Too many agent runs running';
          }
          if (!Array.isArray(detail.running_thread_ids)) {
            detail.running_thread_ids = [];
          }
          if (typeof detail.running_count !== 'number') {
            detail.running_count = 0;
          }
          throw new AgentRunLimitError(response.status, detail);
      }

      // Handle other errors
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      
      console.error(
        `[API] Error initiating agent: ${response.status} ${response.statusText}`,
        errorText,
      );
    
      if (response.status === 401) {
        throw new Error('Authentication error: Please sign in again');
      } else if (response.status >= 500) {
        throw new Error('Server error: Please try again later');
      }
    
      throw new Error(
        `Error initiating agent: ${response.statusText} (${response.status})`,
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    // Rethrow BillingError and AgentRunLimitError instances directly
    if (error instanceof BillingError || error instanceof AgentRunLimitError) {
      throw error;
    }

    console.error('[API] Failed to initiate agent:', error);

    if (
      error instanceof TypeError &&
      error.message.includes('Failed to fetch')
    ) {
      const networkError = new Error(
        `Cannot connect to backend server. Please check your internet connection and make sure the backend is running.`,
      );
      handleApiError(networkError, { operation: 'initiate agent', resource: 'AI assistant' });
      throw networkError;
    }
    handleApiError(error, { operation: 'initiate agent' });
    throw error;
  }
};

export const checkApiHealth = async (): Promise<HealthCheckResponse> => {
  try {
    const response = await fetch(`${API_URL}/health`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`API health check failed: ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    throw error;
  }
};

// Billing API Types
export interface SubscriptionStatus {
  status: string; // Includes 'active', 'past_due', 'scheduled_downgrade', 'no_subscription'
  plan_name?: string;
  price_id?: string;
  current_period_end?: string; // ISO datetime string
  cancel_at_period_end?: boolean;
  minutes_limit?: number;
  cost_limit?: number;
  current_usage?: number;
  // Fields for scheduled changes
  has_schedule?: boolean;
  scheduled_plan_name?: string;
  scheduled_price_id?: string;
  scheduled_change_date?: string; // ISO datetime string
  // Subscription data for frontend components
  subscription_id?: string;
  subscription?: {
    id: string;
    status: string;
    cancel_at_period_end: boolean;
    cancel_at?: number;
    current_period_end: number; // timestamp
  };
  // Credit information
  credit_balance?: number;
  can_purchase_credits?: boolean;
  has_purchase_qualification?: boolean;
  tier?: {
    name: string;
    credits: number;
    can_purchase_credits: boolean;
    models?: string[];
    project_limit?: number;
  };
}

// Interface for user subscription details from Stripe
export interface UserSubscriptionResponse {
  subscription?: {
    id: string;
    status: string;
    current_period_end: number;
    current_period_start: number;
    cancel_at_period_end: boolean;
    cancel_at?: number;
    items: {
      data: Array<{
        id: string;
        price: {
          id: string;
          unit_amount: number;
          currency: string;
          recurring: {
            interval: string;
            interval_count: number;
          };
        };
        quantity: number;
      }>;
    };
    metadata: {
      [key: string]: string;
    };
  };
  price_id?: string;
  plan_name?: string;
  status?: string;
  has_schedule?: boolean;
  scheduled_price_id?: string;
  current_period_end?: number;
  current_period_start?: number;
  cancel_at_period_end?: boolean;
  cancel_at?: number;
  customer_email?: string;
  usage?: {
    total_usage: number;
    limit: number;
  };
}

// Usage log entry interface
export interface UsageLogEntry {
  message_id: string;
  thread_id: string;
  created_at: string;
  content: {
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
    };
    model: string;
  };
  total_tokens: number;
  estimated_cost: number | string;
  project_id: string;
  // Credit usage fields
  credit_used?: number;
  payment_method?: 'credits' | 'subscription';
  was_over_limit?: boolean;
}

// Usage logs response interface
export interface UsageLogsResponse {
  logs: UsageLogEntry[];
  has_more: boolean;
  total_count?: number;
}

export interface BillingStatusResponse {
  can_run: boolean;
  message: string;
  subscription?: {
    price_id?: string;
    plan_name?: string;
    display_name?: string;
    tier?: string;
  };
  credit_balance?: number;
  can_purchase_credits?: boolean;
  tier_info?: {
    name: string;
    display_name?: string;
    credits?: number;
    can_purchase_credits?: boolean;
    project_limit?: number;
    is_trial?: boolean;
  };
  credits_summary?: {
    balance?: number;
    lifetime_granted?: number;
    lifetime_purchased?: number;
    lifetime_used?: number;
  };
}

export interface Model {
  id: string;
  model_key?: string;
  display_name: string;
  short_name?: string;
  provider_id?: string;
  provider_display_name?: string;
  provider_enabled?: boolean;
  is_sponsored?: boolean;
  sponsor_badge?: string | null;
  requires_subscription?: boolean;
  provider_blocked?: boolean;
  is_available?: boolean;
  input_cost_per_million_tokens?: number | null;
  output_cost_per_million_tokens?: number | null;
  audio_cost_per_million_tokens?: number | null;
  max_tokens?: number | null;
  context_window?: number;
  capabilities?: string[];
  recommended?: boolean;
  priority?: number;
}

export interface ProviderPolicy {
  enabled_providers: string[];
  default_provider?: string | null;
  priority_order: string[];
  fallback_mode: 'cross_provider' | 'within_provider';
}

export interface ProviderSummary {
  provider_id: string;
  provider_display_name: string;
  model_count: number;
  enabled_model_count: number;
  is_enabled: boolean;
  is_default: boolean;
  is_sponsored: boolean;
  sponsor_badge?: string | null;
}

export interface AvailableModelsResponse {
  models: Model[];
  providers?: ProviderSummary[];
  provider_policy?: ProviderPolicy;
  subscription_tier: string;
  total_models: number;
  allowed_models_count?: number;
}

export interface ProviderPolicyResponse {
  account_id: string;
  policy: ProviderPolicy;
  providers: ProviderSummary[];
  persisted?: boolean;
}

export interface UpdateProviderPolicyRequest {
  enabled_providers?: string[];
  default_provider?: string | null;
  priority_order?: string[];
  fallback_mode?: 'cross_provider' | 'within_provider';
}

// Billing API Functions
export const getSubscription = async (): Promise<SubscriptionStatus> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new NoAccessTokenAvailableError();
    }

    const response = await fetch(`${API_URL}/billing/subscription`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...getWorkspaceHeaders(),
      },
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error getting subscription: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error getting subscription: ${response.statusText} (${response.status})`,
      );
    }

    const data = await response.json();

    return {
      subscription: data.subscription ? {
        ...data.subscription,
        cancel_at_period_end: data.subscription.cancel_at ? true : false,
      } : null,
      current_usage: data.credits?.lifetime_used || 0,
      cost_limit: data.tier?.credits || 0,
      credit_balance: data.credits?.balance || 0,
      can_purchase_credits: data.credits?.can_purchase || false,
      ...data 
    } as SubscriptionStatus;
  } catch (error) {
    if (error instanceof NoAccessTokenAvailableError) {
      throw error;
    }

    console.error('Failed to get subscription:', error);
    handleApiError(error, { operation: 'load subscription', resource: 'billing information' });
    throw error;
  }
};

export const getAvailableModels = async (): Promise<AvailableModelsResponse> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new NoAccessTokenAvailableError();
    }

    const response = await fetch(`${API_URL}/billing/available-models`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...getWorkspaceHeaders(),
      },
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error getting available models: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error getting available models: ${response.statusText} (${response.status})`,
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof NoAccessTokenAvailableError) {
      throw error;
    }

    console.error('Failed to get available models:', error);
    handleApiError(error, { operation: 'load available models', resource: 'AI models' });
    throw error;
  }
};

export const getProviderPolicy = async (): Promise<ProviderPolicyResponse> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new NoAccessTokenAvailableError();
    }

    const response = await fetch(`${API_URL}/billing/provider-policy`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...getWorkspaceHeaders(),
      },
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error getting provider policy: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error getting provider policy: ${response.statusText} (${response.status})`,
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof NoAccessTokenAvailableError) {
      throw error;
    }
    console.error('Failed to get provider policy:', error);
    handleApiError(error, { operation: 'load provider policy', resource: 'AI providers' });
    throw error;
  }
};

export const updateProviderPolicy = async (
  payload: UpdateProviderPolicyRequest,
): Promise<ProviderPolicyResponse> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new NoAccessTokenAvailableError();
    }

    const response = await fetch(`${API_URL}/billing/provider-policy`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        ...getWorkspaceHeaders(),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error updating provider policy: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error updating provider policy: ${response.statusText} (${response.status})`,
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof NoAccessTokenAvailableError) {
      throw error;
    }
    console.error('Failed to update provider policy:', error);
    handleApiError(error, { operation: 'update provider policy', resource: 'AI providers' });
    throw error;
  }
};

export const checkBillingStatus = async (): Promise<BillingStatusResponse> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new NoAccessTokenAvailableError();
    }

    const response = await fetch(`${API_URL}/billing/check-status`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...getWorkspaceHeaders(),
      },
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error checking billing status: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error checking billing status: ${response.statusText} (${response.status})`,
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof NoAccessTokenAvailableError) {
      throw error;
    }

    console.error('Failed to check billing status:', error);
    throw error;
  }
};

// Transcription API Types
export interface TranscriptionResponse {
  text: string;
}

// Transcription API Functions
export const transcribeAudio = async (audioFile: File): Promise<TranscriptionResponse> => {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new NoAccessTokenAvailableError();
    }

    const formData = new FormData();
    formData.append('audio_file', audioFile);

    const response = await fetch(`${API_URL}/transcription`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error transcribing audio: ${response.status} ${response.statusText}`,
      );
      throw new Error(
        `Error transcribing audio: ${response.statusText} (${response.status})`,
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof NoAccessTokenAvailableError) {
      throw error;
    }

    console.error('Failed to transcribe audio:', error);
    handleApiError(error, { operation: 'transcribe audio', resource: 'speech-to-text' });
    throw error;
  }
};


export const resetThread = async (threadId: string): Promise<{ current_session_index: number; last_reset_at: string } > => {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new NoAccessTokenAvailableError();
  const response = await fetch(`${API_URL}/threads/${threadId}/reset`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!response.ok) throw new Error(`Failed to reset thread: ${response.statusText}`);
  return await response.json();
};

export const listThreadSessions = async (threadId: string): Promise<{ current_session_index: number; sessions: Array<{ index: number; title: string; started_at?: string; ended_at?: string; preview?: string }> } > => {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new NoAccessTokenAvailableError();
  const response = await fetch(`${API_URL}/threads/${threadId}/sessions`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Failed to list sessions: ${response.statusText}`);
  return await response.json();
};

export const resumeThreadSession = async (threadId: string, sessionIndex: number): Promise<{ current_session_index: number }> => {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new NoAccessTokenAvailableError();
  const response = await fetch(`${API_URL}/threads/${threadId}/sessions/resume`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ session_index: sessionIndex }),
  });
  if (!response.ok) throw new Error(`Failed to resume session: ${response.statusText}`);
  return await response.json();
};

export const streamCanvasSelectionChat = (
  canvasId: string,
  payload: {
    prompt: string;
    selection_markdown?: string;
    model_name?: string;
  },
  callbacks: {
    onChunk: (content: string) => void;
    onDone: () => void;
    onError: (error: Error | string) => void;
  },
): (() => void) => {
  const controller = new AbortController();
  const decoder = new TextDecoder();
  let buffer = '';

  const processBuffer = () => {
    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLines = raw
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
      if (dataLines.length === 0) {
        idx = buffer.indexOf('\n\n');
        continue;
      }
      const dataStr = dataLines.join('\n');
      try {
        const evt = JSON.parse(dataStr || '{}');
        if (evt?.type === 'chunk' && typeof evt.content === 'string') {
          callbacks.onChunk(evt.content);
        } else if (evt?.type === 'done') {
          callbacks.onDone();
          return;
        } else if (evt?.type === 'error') {
          callbacks.onError(evt.message || 'Stream error');
        }
      } catch {
        // Ignore malformed chunks
      }
      idx = buffer.indexOf('\n\n');
    }
  };

  void (async () => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        callbacks.onError(new NoAccessTokenAvailableError());
        return;
      }

      if (!API_URL) {
        callbacks.onError('Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.');
        return;
      }

      const response = await fetch(`${API_URL}/canvases/${encodeURIComponent(canvasId)}/selection-chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...getWorkspaceHeaders(),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        callbacks.onError(`Stream request failed: ${response.statusText} (${response.status})`);
        return;
      }

      const reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        processBuffer();
      }
      if (buffer.trim()) {
        processBuffer();
      }
      callbacks.onDone();
    } catch (error) {
      if ((error as any)?.name === 'AbortError') return;
      callbacks.onError(error instanceof Error ? error.message : 'Stream failed');
    }
  })();

  return () => {
    try {
      controller.abort();
    } catch {}
  };
};

export interface InfographicGenerationResult {
  generation_id: string;
  storage_path: string;
  file_id: string;
  width: number;
  height: number;
  mime_type: string;
  byte_size: number;
  download_url: string;
  image_prompt: string;
  recipe_id?: string | null;
  recipe_version?: number | null;
  merge_mode?: InfographicMergeMode;
  style_lock?: InfographicStyleLock;
  fingerprint?: string;
  recipe_source?: string;
  custom_prompt_source?: string;
  reference_image_file_id?: string | null;
  reference_image_source?: string;
}

export type InfographicMergeMode = 'append' | 'prepend' | 'replace';
export type InfographicStyleLock = 'off' | 'soft' | 'strict';

export interface InfographicRecipeVersion {
  version: number;
  prompt_template: string;
  style_manifest: Record<string, any>;
  metadata: Record<string, any>;
  is_published: boolean;
  created_at?: string | null;
}

export interface InfographicRecipe {
  recipe_id: string;
  scope_type: 'system' | 'workspace' | 'user';
  visibility: 'official' | 'workspace_private';
  account_id?: string | null;
  owner_user_id?: string | null;
  slug: string;
  name: string;
  description?: string | null;
  locale: string;
  tags: string[];
  cover_url?: string | null;
  status: 'active' | 'disabled' | 'archived';
  latest_version?: InfographicRecipeVersion | null;
}

export interface InfographicMarketListing {
  listing_id: string;
  recipe_id: string;
  listing_type: 'official' | 'workspace_private';
  account_id?: string | null;
  badge?: string | null;
  rank: number;
  featured: boolean;
  is_active: boolean;
  recipe?: InfographicRecipe | null;
}

export interface InfographicPreference {
  account_id: string;
  user_id?: string | null;
  default_recipe_id?: string | null;
  default_custom_prompt?: string | null;
  default_merge_mode: InfographicMergeMode;
  default_style_lock: InfographicStyleLock;
  default_reference_image_file_id?: string | null;
}

export interface ResolvedInfographicConfig {
  recipe_id?: string | null;
  recipe_version?: number | null;
  recipe_source: string;
  custom_prompt?: string | null;
  custom_prompt_source: string;
  merge_mode: InfographicMergeMode;
  merge_mode_source: string;
  style_lock: InfographicStyleLock;
  style_lock_source: string;
  reference_image_file_id?: string | null;
  reference_image_source?: string;
  resolved_at: string;
}

export interface InfographicPreferenceDefaultsResponse {
  user?: InfographicPreference | null;
  workspace?: InfographicPreference | null;
  resolved: ResolvedInfographicConfig;
  saved_scope?: 'user' | 'workspace';
  saved?: InfographicPreference | null;
}

export const generateSelectionInfographic = async (
  canvasId: string,
  payload: {
    selection_markdown: string;
    model_name?: string;
    image_model?: string;
    aspect_ratio?: string;
    recipe_id?: string;
    custom_prompt?: string | null;
    merge_mode?: InfographicMergeMode;
    style_lock?: InfographicStyleLock;
    reference_image_file_id?: string | null;
  },
): Promise<InfographicGenerationResult> => {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) throw new NoAccessTokenAvailableError();

  if (!API_URL) {
    throw new Error('Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.');
  }

  const response = await fetch(
    `${API_URL}/canvases/${encodeURIComponent(canvasId)}/selection-infographic/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...getWorkspaceHeaders(),
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.detail?.message || errorData?.detail || `Request failed: ${response.status}`);
  }

  return response.json();
};

export const listInfographicRecipes = async (
  params?: { query?: string },
): Promise<{ recipes: InfographicRecipe[]; count: number }> => {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new NoAccessTokenAvailableError();
  if (!API_URL) throw new Error('Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.');

  const search = new URLSearchParams();
  if (params?.query?.trim()) search.set('query', params.query.trim());

  const response = await fetch(`${API_URL}/infographic/recipes${search.toString() ? `?${search.toString()}` : ''}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...getWorkspaceHeaders(),
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.detail?.message || errorData?.detail || `Request failed: ${response.status}`);
  }

  return response.json();
};

export const getInfographicRecipe = async (
  recipeId: string,
): Promise<InfographicRecipe> => {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new NoAccessTokenAvailableError();
  if (!API_URL) throw new Error('Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.');

  const response = await fetch(
    `${API_URL}/infographic/recipes/${encodeURIComponent(recipeId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...getWorkspaceHeaders(),
      },
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.detail?.message || errorData?.detail || `Request failed: ${response.status}`);
  }

  return response.json();
};

export const listInfographicMarketListings = async (
  params?: { query?: string; limit?: number; offset?: number },
): Promise<{ listings: InfographicMarketListing[]; count: number }> => {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new NoAccessTokenAvailableError();
  if (!API_URL) throw new Error('Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.');

  const search = new URLSearchParams();
  if (params?.query?.trim()) search.set('query', params.query.trim());
  if (typeof params?.limit === 'number') search.set('limit', String(params.limit));
  if (typeof params?.offset === 'number') search.set('offset', String(params.offset));

  const response = await fetch(`${API_URL}/infographic/market/listings${search.toString() ? `?${search.toString()}` : ''}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...getWorkspaceHeaders(),
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.detail?.message || errorData?.detail || `Request failed: ${response.status}`);
  }

  return response.json();
};

export const getInfographicPreferenceDefaults = async (): Promise<InfographicPreferenceDefaultsResponse> => {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new NoAccessTokenAvailableError();
  if (!API_URL) throw new Error('Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.');

  const response = await fetch(`${API_URL}/infographic/preferences/defaults`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...getWorkspaceHeaders(),
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.detail?.message || errorData?.detail || `Request failed: ${response.status}`);
  }

  return response.json();
};

export const updateInfographicPreferenceDefaults = async (payload: {
  scope?: 'user' | 'workspace';
  default_recipe_id?: string | null;
  default_custom_prompt?: string | null;
  default_merge_mode?: InfographicMergeMode;
  default_style_lock?: InfographicStyleLock;
  default_reference_image_file_id?: string | null;
}): Promise<InfographicPreferenceDefaultsResponse> => {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new NoAccessTokenAvailableError();
  if (!API_URL) throw new Error('Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.');

  const response = await fetch(`${API_URL}/infographic/preferences/defaults`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...getWorkspaceHeaders(),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.detail?.message || errorData?.detail || `Request failed: ${response.status}`);
  }

  return response.json();
};

export const deleteThreadSession = async (
  threadId: string,
  sessionIndex: number,
): Promise<{ current_session_index: number; deleted_session_index: number }> => {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new NoAccessTokenAvailableError();
  const response = await fetch(`${API_URL}/threads/${threadId}/sessions/${sessionIndex}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!response.ok) throw new Error(`Failed to delete session: ${response.statusText}`);
  return await response.json();
};

export const hardDeleteCanvas = async (canvasId: string): Promise<void> => {
  const workspaceId = getCurrentWorkspaceId();
  const resp = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/purge`, {
    method: 'DELETE',
    headers: workspaceId ? { 'X-Workspace-Id': workspaceId } : undefined,
  });
  if (!resp.ok) throw new Error('Failed to permanently delete canvas');
};

// Batch restore canvases
export const restoreCanvasesBatch = async (ids: string[]): Promise<{ restored: string[]; skipped: string[]; count_restored: number }> => {
  const workspaceId = getCurrentWorkspaceId();
  const resp = await fetch(`/api/canvases/restore-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
    },
    body: JSON.stringify({ ids }),
  });
  if (!resp.ok) throw new Error('Failed to restore canvases');
  return await resp.json();
};

// Batch purge canvases by ids
export const purgeCanvasesByIds = async (ids: string[]): Promise<{ deleted: string[]; skipped: string[]; count_deleted: number }> => {
  const workspaceId = getCurrentWorkspaceId();
  const resp = await fetch(`/api/canvases/purge-by-ids`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
    },
    body: JSON.stringify({ ids }),
  });
  if (!resp.ok) throw new Error('Failed to permanently delete canvases');
  return await resp.json();
};
