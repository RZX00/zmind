// 🎯 Canvas 媒体上传与知识库接入服务
// 负责将拖入画布的文件上传到云端存储，并触发知识库解析

import { createClient } from '@/lib/supabase/client';
import { uploadFileWithIntent, getDownloadUrl } from '@/lib/api/files';
import { attachKnowledgeBaseFileById, uploadKnowledgeBaseFile } from '@/lib/knowledge-base-upload';
import { requiredEnv } from '@/lib/env-utils';
import { getCurrentWorkspaceId } from '@/lib/workspace-session';
import { buildMediaProxyUrl } from '@/canvas/utils/mediaUtils';

const API_URL = requiredEnv('NEXT_PUBLIC_BACKEND_URL');
const API_BASE = API_URL.endsWith('/api') ? API_URL : `${API_URL}/api`;
// Default to R2-based file pipeline.

export interface StorageUploadResult {
  fileUrl: string;       // 预览/打开用
  downloadUrl: string;   // 下载用（指定原始文件名）
  path: string;
  fileId?: string;
  storagePath?: string;
}

/**
 * 将文件上传到云端存储（默认 R2），并返回可访问信息
 */
export async function uploadFileToStorage(
  file: File,
  options?: { bucket?: string; pathPrefix?: string; makePublic?: boolean; source?: string }
): Promise<StorageUploadResult> {
  const makePublic = options?.makePublic ?? false; // 默认走 R2 直传

  if (!makePublic) {
    const intent = await uploadFileWithIntent(file, options?.source || 'canvas');
    return {
      fileUrl: '',
      downloadUrl: '',
      path: intent.storage_key,
      fileId: intent.file_id,
      storagePath: intent.storage_key,
    };
  }

  const intent = await uploadFileWithIntent(file, options?.source || 'canvas');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const ttlSeconds = 60 * 60 * 24;
  let fileUrl = buildMediaProxyUrl(intent.storage_key, { token, ttlSeconds }) || '';
  const downloadProxyUrl = buildMediaProxyUrl(intent.storage_key, {
    token,
    ttlSeconds,
    extraParams: { download: file.name },
  }) || fileUrl;

  let downloadUrl = downloadProxyUrl;
  try {
    const dl = await getDownloadUrl(intent.file_id);
    if (dl?.url) downloadUrl = dl.url;
  } catch {}
  if (!fileUrl && downloadUrl) fileUrl = downloadUrl;

  return {
    fileUrl,
    downloadUrl,
    path: intent.storage_key,
    fileId: intent.file_id,
    storagePath: intent.storage_key,
  };
}

/**
 * 将文件上传到知识库后台，触发解析
 * 返回后端创建的处理任务 jobId
 */
const DEFAULT_KB_FOLDER_NAME = 'Inbox';

async function ensureDefaultKbFolder(token: string): Promise<string> {
  const workspaceId = getCurrentWorkspaceId();
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
  };
  // 1) List folders and try to find default
  const listRes = await fetch(`${API_BASE}/knowledge-base/folders`, {
    headers,
  });
  if (!listRes.ok) {
    const msg = await listRes.text();
    throw new Error(msg || 'Failed to list KB folders');
  }
  const folders = await listRes.json();
  const found = Array.isArray(folders)
    ? folders.find((f: any) => (f.name || '').toLowerCase() === DEFAULT_KB_FOLDER_NAME.toLowerCase())
    : undefined;
  if (found?.folder_id) return found.folder_id as string;

  // 2) Create default folder
  const createRes = await fetch(`${API_BASE}/knowledge-base/folders`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: DEFAULT_KB_FOLDER_NAME, description: 'Default uploads' }),
  });
  if (!createRes.ok) {
    const msg = await createRes.text();
    throw new Error(msg || 'Failed to create default KB folder');
  }
  const created = await createRes.json();
  return created.folder_id as string;
}

export async function uploadFileToKnowledgeBase(
  _agentId: string, // kept for backward compatibility; ignored in user-level KB
  file: File,
  fileId?: string
): Promise<{ entryId: string }> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('No access token');
  }

  // Ensure default folder exists (Inbox)
  const folderId = await ensureDefaultKbFolder(session.access_token);

  const data = fileId
    ? await attachKnowledgeBaseFileById(folderId, fileId)
    : await uploadKnowledgeBaseFile(folderId, file);
  return { entryId: data.entry_id as string };
}
