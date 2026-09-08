import { createClient } from '@/lib/supabase/client';
import { getDownloadUrl } from '@/lib/api/files';
import { buildMediaProxyUrl } from '@/canvas/utils/mediaUtils';
import { uploadFileToStorage } from '../../services/canvas-media.service';

async function resolveUploadedImageUrl(uploaded: Awaited<ReturnType<typeof uploadFileToStorage>>): Promise<string> {
  if (uploaded.fileId) {
    try {
      const { url } = await getDownloadUrl(uploaded.fileId);
      if (url) return url;
    } catch {}
  }

  if (uploaded.downloadUrl) return uploaded.downloadUrl;
  if (uploaded.fileUrl) return uploaded.fileUrl;

  if (uploaded.storagePath) {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const proxy = buildMediaProxyUrl(uploaded.storagePath, {
        token: session?.access_token,
        ttlSeconds: 60 * 60 * 24,
      });
      if (proxy) return proxy;
    } catch {}
  }

  throw new Error('Image uploaded but URL resolution failed');
}

export async function uploadNovelEditorImage(file: File, source: string = 'canvas'): Promise<string> {
  const uploaded = await uploadFileToStorage(file, { source });
  return resolveUploadedImageUrl(uploaded);
}

export async function uploadExpandedEditorImage(file: File): Promise<string> {
  return uploadNovelEditorImage(file, 'canvas');
}
