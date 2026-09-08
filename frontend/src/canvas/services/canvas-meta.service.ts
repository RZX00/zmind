"use client";

export interface CanvasMetaItem {
  id: string;
  title: string;
  version: string;
  createdAt: number;
  updatedAt: number;
  folderId?: string | null;
}

interface FetchMetaOptions {
  limit?: number;
  signal?: AbortSignal;
}

export async function fetchCanvasMeta(options: FetchMetaOptions = {}): Promise<CanvasMetaItem[]> {
  const params = new URLSearchParams();
  if (typeof options.limit === 'number') params.set('limit', String(options.limit));
  const url = params.size > 0 ? `/api/canvases/meta?${params.toString()}` : '/api/canvases/meta';
  const resp = await fetch(url, {
    cache: 'no-store',
    signal: options.signal,
  });
  if (resp.status === 304) {
    return [];
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(text || `Failed to fetch canvas meta (${resp.status})`);
  }
  const data = await resp.json();
  return Array.isArray(data) ? (data as CanvasMetaItem[]) : [];
}
