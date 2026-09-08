import { createClient } from '@/lib/supabase/client';
import { backendApi } from '@/lib/api-client';
import { buildMediaProxyUrl } from '@/canvas/utils/mediaUtils';

export type AssetItem = {
  path: string;           // full path in bucket
  name: string;           // file name only
  size: number;
  contentType: string | null;
  updatedAt: string | null;
  extension: string;
  mediaType: 'image' | 'document' | 'spreadsheet' | 'presentation' | 'audio' | 'video' | 'unknown';
  fileId?: string;
};

type FileLibraryItem = {
  file_id: string;
  storage_path: string;
  original_filename: string;
  file_size: number;
  content_type?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

function extOf(name: string) {
  const p = name.lastIndexOf('.');
  return p >= 0 ? name.slice(p + 1).toLowerCase() : '';
}

function guessMediaType(ext: string, contentType?: string | null): AssetItem['mediaType'] {
  if ((contentType || '').startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg','bmp'].includes(ext)) return 'image';
  if ((contentType || '').startsWith('audio/') || ['mp3','wav','aac','ogg','flac','m4a'].includes(ext)) return 'audio';
  if ((contentType || '').startsWith('video/') || ['mp4','mov','avi','mkv','wmv','webm','flv'].includes(ext)) return 'video';
  if (['pdf','doc','docx','txt','md','rtf'].includes(ext)) return 'document';
  if (['xls','xlsx','csv','ods'].includes(ext)) return 'spreadsheet';
  if (['ppt','pptx','odp'].includes(ext)) return 'presentation';
  return 'unknown';
}

async function getAccessToken(): Promise<string> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No access token');
  return session.access_token;
}

// List assets under the canvas-media prefix.
export async function listAssets(limit = 50): Promise<AssetItem[]> {
  const res = await backendApi.get<{ items: FileLibraryItem[] }>('/files/library', {
    params: { prefix: 'canvas', limit },
  });
  if (res.error) throw res.error;
  const items = res.data?.items || [];
  return items.map((it) => {
    const ext = extOf(it.original_filename || '');
    return {
      path: it.storage_path,
      name: it.original_filename,
      size: it.file_size || 0,
      contentType: it.content_type || null,
      updatedAt: it.updated_at || it.created_at || null,
      extension: ext,
      mediaType: guessMediaType(ext, it.content_type),
      fileId: it.file_id,
    };
  });
}

export async function signAsset(path: string, filename: string): Promise<{ fileUrl: string; downloadUrl: string; }> {
  const token = await getAccessToken();
  const ttlSeconds = 60 * 60 * 24;
  const fileUrl = buildMediaProxyUrl(path, { token, ttlSeconds });
  const downloadUrl = buildMediaProxyUrl(path, { token, ttlSeconds, extraParams: { download: filename } });
  if (!fileUrl) throw new Error('Failed to build media url');
  return { fileUrl, downloadUrl: downloadUrl || fileUrl };
}

export async function removeAsset(fileId: string): Promise<void> {
  if (!fileId) throw new Error('Missing file id');
  const res = await backendApi.delete(`/files/${fileId}`);
  if (res.error) throw res.error;
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function renameAsset(fileId: string, newFilename: string): Promise<{ newPath: string }> {
  if (!fileId) throw new Error('Missing file id');
  const targetName = sanitizeFilename(newFilename);
  const res = await backendApi.patch<{ storage_path: string }>('/files/' + fileId + '/rename', { filename: targetName });
  if (res.error) throw res.error;
  return { newPath: res.data?.storage_path || '' };
}

// === Lightweight signed URL cache (in-memory) ===
type SignedCacheItem = { fileUrl: string; downloadUrl: string; expiresAt: number };
const signedCache: Map<string, SignedCacheItem> = new Map();
const inflight: Map<string, Promise<{ fileUrl: string; downloadUrl: string }>> = new Map();

function nowMs() { return Date.now(); }

async function waitForSessionReady(maxTries = 5, delayMs = 250): Promise<void> {
  const supabase = createClient();
  for (let i = 0; i < maxTries; i++) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) return;
    await new Promise(r => setTimeout(r, delayMs));
  }
}

export async function getSignedAssetCached(path: string, filename: string, opts?: { force?: boolean; ttlMs?: number }): Promise<{ fileUrl: string; downloadUrl: string }>
{
  const key = path;
  const ttlMs = opts?.ttlMs ?? 1000 * 60 * 60 * 23; // ~23h
  if (!opts?.force) {
    const cached = signedCache.get(key);
    if (cached && cached.expiresAt > nowMs()) {
      return { fileUrl: cached.fileUrl, downloadUrl: cached.downloadUrl };
    }
  }

  // De-duplicate concurrent signing
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    // Ensure session is ready to pass RLS checks
    await waitForSessionReady();
    const signed = await signAsset(path, filename);
    signedCache.set(key, { ...signed, expiresAt: nowMs() + ttlMs });
    inflight.delete(key);
    return signed;
  })();
  inflight.set(key, p);
  return p;
}

export function clearSignedAssetCache() {
  signedCache.clear();
  inflight.clear();
}
