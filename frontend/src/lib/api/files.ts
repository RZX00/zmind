import { backendApi } from '@/lib/api-client';
import { createClient } from '@/lib/supabase/client';

export interface UploadIntentResponse {
  file_id: string;
  upload_url: string;
  method: string;
  headers: Record<string, string>;
  storage_key: string;
  expires_in: number;
  reuse?: boolean;
  upload_id?: string;
  part_size?: number;
  part_count?: number;
  parts?: Array<{ part_number: number; url: string }>;
  resume?: boolean;
}

export interface UploadCompletePart {
  part_number: number;
  etag: string;
}

export interface UploadStatusResponse {
  file_id: string;
  upload_id: string;
  part_size?: number;
  part_count?: number;
  uploaded_parts?: UploadCompletePart[];
}

export interface FileStorageUsage {
  used_bytes: number;
  max_total_bytes: number;
  max_file_bytes: number;
  tier_name: string;
  tier_display_name?: string | null;
}

const getSessionAccessToken = async (): Promise<string | null> => {
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
};

async function computeFileSha256(file: File): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export async function createUploadIntent(file: File, source: string) {
  const sha256 = await computeFileSha256(file);
  const response = await backendApi.post<UploadIntentResponse>('/files/upload-intent', {
    filename: file.name,
    size: file.size,
    content_type: file.type || 'application/octet-stream',
    source,
    sha256: sha256 || undefined,
  });
  if (response.error) throw response.error;
  return response.data!;
}

export async function completeUpload(
  fileId: string,
  opts?: { uploadId?: string; parts?: UploadCompletePart[] }
) {
  const response = await backendApi.post<{ file_id: string; status: string }>(
    '/files/upload-complete',
    { file_id: fileId, upload_id: opts?.uploadId, parts: opts?.parts }
  );
  if (response.error) throw response.error;
  return response.data!;
}

export async function getUploadStatus(fileId: string) {
  const response = await backendApi.get<UploadStatusResponse>(`/files/${fileId}/upload-status`);
  if (response.error) throw response.error;
  return response.data!;
}

export async function abortUpload(fileId: string) {
  const response = await backendApi.post<{ file_id: string; status: string }>(
    '/files/upload-abort',
    { file_id: fileId }
  );
  if (response.error) throw response.error;
  return response.data!;
}

async function uploadMultipart(file: File, intent: UploadIntentResponse) {
  const partSize = intent.part_size || 8 * 1024 * 1024;
  const partCount =
    intent.part_count || Math.ceil(file.size / Math.max(1, partSize));
  const parts = intent.parts || [];

  let uploadedSet = new Set<number>();
  let existingParts: UploadCompletePart[] = [];
  if (intent.resume) {
    try {
      const status = await getUploadStatus(intent.file_id);
      existingParts = status.uploaded_parts || [];
      existingParts.forEach((p) => uploadedSet.add(p.part_number));
    } catch {
      uploadedSet = new Set();
    }
  }

  const uploadedParts: UploadCompletePart[] = [];

  for (let idx = 1; idx <= partCount; idx += 1) {
    if (uploadedSet.has(idx)) {
      continue;
    }
    const start = (idx - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const blob = file.slice(start, end);
    const part = parts.find((p) => p.part_number === idx);
    if (!part?.url) {
      throw new Error(`Missing upload URL for part ${idx}`);
    }
    const resp = await fetch(part.url, {
      method: 'PUT',
      body: blob,
    });
    if (!resp.ok) {
      throw new Error(`Upload part ${idx} failed: ${resp.status} ${resp.statusText}`);
    }
    const etag = resp.headers.get('ETag') || resp.headers.get('etag');
    if (etag) {
      uploadedParts.push({ part_number: idx, etag });
    }
  }

  const mergedParts = [...existingParts, ...uploadedParts].reduce<UploadCompletePart[]>(
    (acc, part) => {
      if (!acc.some((p) => p.part_number === part.part_number)) {
        acc.push(part);
      }
      return acc;
    },
    []
  );

  await completeUpload(intent.file_id, {
    uploadId: intent.upload_id,
    parts: mergedParts.length === partCount ? mergedParts : undefined,
  });
}

export async function uploadFileWithIntent(file: File, source: string) {
  const intent = await createUploadIntent(file, source);
  if (intent.reuse) {
    return intent;
  }
  const method = (intent.method || 'PUT').toUpperCase();
  if (method === 'MULTIPART') {
    try {
      await uploadMultipart(file, intent);
    } catch (err) {
      try {
        await abortUpload(intent.file_id);
      } catch {
        // swallow abort errors
      }
      throw err;
    }
    return intent;
  }

  try {
    const uploadResp = await fetch(intent.upload_url, {
      method: intent.method || 'PUT',
      headers: intent.headers || { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!uploadResp.ok) {
      throw new Error(`Upload failed: ${uploadResp.status} ${uploadResp.statusText}`);
    }
    await completeUpload(intent.file_id);
    return intent;
  } catch (err) {
    try {
      await abortUpload(intent.file_id);
    } catch {
      // swallow abort errors
    }
    throw err;
  }
}

export async function getDownloadUrl(fileId: string) {
  const response = await backendApi.get<{ url: string }>(`/files/${fileId}/download`);
  if (response.error) throw response.error;
  return response.data!;
}

export async function getFileStorageUsage(accessToken?: string) {
  const token = accessToken || await getSessionAccessToken();
  if (!token) {
    const error = Object.assign(Object.create(Error.prototype), {
      message: 'Authentication required',
      name: 'ApiError',
      status: 401,
      code: 'AUTH_REQUIRED',
    });
    throw error;
  }
  const response = await backendApi.get<FileStorageUsage>('/files/usage', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.error) throw response.error;
  return response.data!;
}
