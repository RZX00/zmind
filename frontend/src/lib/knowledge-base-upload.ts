import { createClient } from '@/lib/supabase/client';
import { uploadFileWithIntent } from '@/lib/api/files';
import { requiredEnv } from '@/lib/env-utils';
import { getCurrentWorkspaceId } from '@/lib/workspace-session';

const API_URL = requiredEnv('NEXT_PUBLIC_BACKEND_URL');
const API_BASE = API_URL.endsWith('/api') ? API_URL : `${API_URL}/api`;

async function postKnowledgeBaseFileId(folderId: string, fileId: string) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('No session found');
  }

  const form = new FormData();
  form.append('file_id', fileId);

  const workspaceId = getCurrentWorkspaceId();
  const res = await fetch(`${API_BASE}/knowledge-base/folders/${folderId}/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Upload failed: ${res.status}`);
  }

  return await res.json();
}

export async function uploadKnowledgeBaseFile(folderId: string, file: File) {
  const intent = await uploadFileWithIntent(file, 'kb');
  return postKnowledgeBaseFileId(folderId, intent.file_id);
}

export async function attachKnowledgeBaseFileById(folderId: string, fileId: string) {
  return postKnowledgeBaseFileId(folderId, fileId);
}
