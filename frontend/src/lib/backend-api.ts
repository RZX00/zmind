/**
 * 后端 API 的轻量封装。
 *
 * 存在的理由：前端原本用 supabase-js 直连 PostgREST 读写业务表（47 处 `.from()`）。
 * 去掉直连之后，这些查询统一走后端 —— 这个文件把「取 token + 带 workspace 头 +
 * 拼 URL + 处理错误」这套重复逻辑收在一处，避免每个调用点各写一遍。
 *
 * 注意 supabase-js 并没有被完全移除：认证（GoTrue）仍然用它，
 * 这里只是不再用它当数据库客户端。
 */

import { createClient } from '@/lib/supabase/client';
import { resolveBackendBase } from '@/lib/backend';
import { getCurrentWorkspaceId } from '@/lib/workspace-session';

const API_URL = resolveBackendBase();

export class BackendApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'BackendApiError';
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** 匿名端点（如公开画布列表）设 true，不带也不要求 token */
  anonymous?: boolean;
  signal?: AbortSignal;
};

async function authHeaders(anonymous: boolean): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const workspaceId = getCurrentWorkspaceId();
  if (workspaceId) {
    headers['X-Workspace-Id'] = workspaceId;
  }

  if (anonymous) return headers;

  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return headers;
}

export async function backendRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!API_URL) {
    throw new Error('Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.');
  }

  const { method = 'GET', body, anonymous = false, signal } = options;

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: await authHeaders(anonymous),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : response.statusText;
    throw new BackendApiError(response.status, detail, parsed);
  }

  return parsed as T;
}

// ---------------------------------------------------------------------------
// 当前用户的角色
//
// 取代前端 3 处直查 user_roles 表的写法（侧边栏、画布浮动按钮、消息区）。
// 权限判断由服务端下结论，前端只消费布尔值 —— 前端自己查权限表本身就不该发生。
// ---------------------------------------------------------------------------

export type MyRoles = {
  roles: string[];
  role: string | null;
  is_admin: boolean;
  is_super_admin: boolean;
};

const EMPTY_ROLES: MyRoles = { roles: [], role: null, is_admin: false, is_super_admin: false };

export async function fetchMyRoles(): Promise<MyRoles> {
  try {
    return await backendRequest<MyRoles>('/me/roles');
  } catch {
    // 未登录或后端不可达时按无权限处理，保持与原本 try/catch 兜底一致的行为
    return EMPTY_ROLES;
  }
}

// ---------------------------------------------------------------------------
// 公开画布（首页 / 探索页），无需登录
// ---------------------------------------------------------------------------

export type PublicCanvas = {
  id: string;
  title: string | null;
  preview_url: string | null;
  author_user_id: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  listed_at: string | null;
};

export async function fetchPublicCanvases(limit = 24, offset = 0): Promise<PublicCanvas[]> {
  return backendRequest<PublicCanvas[]>(
    `/public-canvases?limit=${limit}&offset=${offset}`,
    { anonymous: true },
  );
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectRecord = {
  project_id: string;
  name: string;
  description: string | null;
  account_id: string;
  created_at: string;
  updated_at?: string | null;
  is_public?: boolean | null;
  icon_name?: string | null;
  // 刻意不写 [key: string]: unknown 的索引签名：加上之后所有已声明字段的访问
  // 也会被推断成 unknown，调用方拿到的 is_public/icon_name 就不再是布尔和字符串，
  // 反而把类型检查变成了摆设（实测会报 TS2322）。字段有新增就显式补在这里。
};

export async function fetchProjects(accountId?: string): Promise<ProjectRecord[]> {
  const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
  return backendRequest<ProjectRecord[]>(`/projects${qs}`);
}

export async function fetchProject(projectId: string): Promise<ProjectRecord> {
  return backendRequest<ProjectRecord>(`/projects/${encodeURIComponent(projectId)}`);
}

export async function createProjectRequest(input: {
  name: string;
  description?: string | null;
  account_id?: string;
}): Promise<ProjectRecord> {
  return backendRequest<ProjectRecord>('/projects', { method: 'POST', body: input });
}

export async function updateProjectRequest(
  projectId: string,
  changes: { name?: string; description?: string | null },
): Promise<ProjectRecord> {
  return backendRequest<ProjectRecord>(`/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: changes,
  });
}

export async function deleteProjectRequest(projectId: string): Promise<void> {
  await backendRequest<{ success: boolean }>(`/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
}
