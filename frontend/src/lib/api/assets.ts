import { backendApi } from '@/lib/api-client';

export interface PublicAsset {
  key: string;
  path: string;
  public_url: string;
  updated_at?: string;
  updated_by?: string;
}

export const getWechatQrPublic = async () => {
  // Use same-origin Next.js API proxy to avoid cross-origin preflights for a public asset.
  const res = await fetch('/api/public/assets/wechat-qr', { method: 'GET' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as PublicAsset;
};

export const getWechatQrAdmin = async () => {
  const res = await backendApi.get<PublicAsset>('/admin/assets/wechat-qr', { showErrors: false });
  if (res.error) throw res.error;
  return res.data!;
};

export const saveWechatQrAsset = async (payload: { path: string; public_url: string }) => {
  const res = await backendApi.post<PublicAsset>('/admin/assets/wechat-qr', payload, { showErrors: false });
  if (res.error) throw res.error;
  return res.data!;
};
