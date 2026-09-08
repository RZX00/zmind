import { createClient } from '@/lib/supabase/client';
import { resolveBackendBase } from '@/lib/backend';

export interface ExternalVideoMetadata {
  provider: 'youtube' | 'bilibili';
  title?: string | null;
  sourceUrl?: string | null;
}

export async function fetchExternalVideoMetadata(
  canvasId: string,
  url: string
): Promise<ExternalVideoMetadata | null> {
  const base = resolveBackendBase();
  if (!base) return null;
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;

  const response = await fetch(`${base}/canvases/${canvasId}/media/external-metadata`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data as ExternalVideoMetadata;
}
