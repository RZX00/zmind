// 🎨 媒体节点工具函数
// 本地持久化（localStorage/内存缓存）已移除，统一走云端；
// 图片仅使用临时 ObjectURL 做即时预览。

import {
  MediaNode,
  MEDIA_FILE_TYPES,
  FILE_MIME_TYPES,
  MEDIA_TYPE_ICONS,
  DEFAULT_NODE_SIZES,
  CreateNodeOptions,
  ExternalVideoProvider
} from '../types/canvas';
import type { CanvasIconName } from '../constants/canvasIcons';
import { getCurrentTimestamp } from './canvasUtils';
import { NodeIds } from './nodeIdUtils';
import { encodeStoragePath } from '@/lib/media-path';

/** 根据文件扩展名获取媒体类型 */
export function getMediaTypeFromExtension(extension: string): MediaNode['mediaType'] | null {
  const ext = extension.toLowerCase().replace(/^\./, '');
  for (const [mediaType, extensions] of Object.entries(MEDIA_FILE_TYPES)) {
    if ((extensions as readonly string[]).includes(ext)) {
      return mediaType as MediaNode['mediaType'];
    }
  }
  return null;
}

/** 根据 MIME 类型获取媒体类型 */
export function getMediaTypeFromMimeType(mimeType: string): MediaNode['mediaType'] | null {
  const lower = mimeType.toLowerCase();
  if (lower.startsWith('image/')) return 'image';
  if (lower.startsWith('audio/')) return 'audio';
  if (lower.startsWith('video/')) return 'video';
  if (lower.includes('pdf') || lower.includes('document') || lower.includes('text') || lower.includes('rtf')) return 'document';
  if (lower.includes('spreadsheet') || lower.includes('excel') || lower.includes('csv')) return 'spreadsheet';
  if (lower.includes('presentation') || lower.includes('powerpoint')) return 'presentation';
  return null;
}

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** 验证文件类型是否支持 */
export function isSupportedFileType(fileName: string): boolean {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  return getMediaTypeFromExtension(extension) !== null;
}

/** 从 File 构造节点基础信息 */
export function createMediaNodeFromFile(
  file: File,
  x: number,
  y: number,
  uploadStatus: 'pending' | 'uploaded' | 'mock' | 'error' = 'mock'
): CreateNodeOptions {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const mediaType = getMediaTypeFromExtension(extension) || getMediaTypeFromMimeType(file.type) || 'document';
  // Document-like文件默认更宽一些，便于显示预览与信息行
  const isDocLike = ['document', 'spreadsheet', 'presentation'].includes(mediaType);
  const { width, height } = isDocLike ? { width: 300, height: 200 } : DEFAULT_NODE_SIZES.media;
  return {
    type: 'media',
    x,
    y,
    width,
    height,
    content: `File: ${file.name}`,
    fileName: file.name,
    fileType: file.type || FILE_MIME_TYPES[extension] || 'application/octet-stream',
    fileExtension: extension,
    fileSize: file.size,
    mediaType,
    uploadStatus
  };
}

/** 获取媒体类型图标 */
export function getMediaTypeIcon(mediaType: MediaNode['mediaType']): { icon: CanvasIconName; color: string } {
  const fallback = { icon: 'document' as CanvasIconName, color: '#6B7280' };
  return MEDIA_TYPE_ICONS[mediaType] || fallback;
}

/** 是否为图片文件 */
export function isImageFile(file: File): boolean {
  const mediaType = getMediaTypeFromExtension(file.name) || getMediaTypeFromMimeType(file.type);
  return mediaType === 'image';
}

/** 从拖拽事件中提取文件列表 */
export function getFilesFromDragEvent(event: DragEvent | React.DragEvent): File[] {
  const files: File[] = [];
  if (event.dataTransfer?.files) {
    Array.from(event.dataTransfer.files).forEach(file => {
      if (isSupportedFileType(file.name)) files.push(file);
    });
  }
  return files;
}

/** 创建媒体节点（即时预览使用 ObjectURL，上传后替换为云端URL） */
export async function createMediaNode(
  file: File,
  x: number,
  y: number
): Promise<MediaNode> {
  const nodeId = NodeIds.generateNodeId(undefined, 'media');
  const now = getCurrentTimestamp();
  const nodeOptions = createMediaNodeFromFile(file, x, y);

  let localPath: string | undefined;
  if (isImageFile(file)) {
    try { localPath = URL.createObjectURL(file); } catch {}
  }

  const mediaNode: MediaNode = {
    id: nodeId,
    type: 'media',
    x: nodeOptions.x!,
    y: nodeOptions.y!,
    width: nodeOptions.width!,
    height: nodeOptions.height!,
    content: nodeOptions.content!,
    fileName: nodeOptions.fileName!,
    fileType: nodeOptions.fileType!,
    fileExtension: nodeOptions.fileExtension!,
    fileSize: nodeOptions.fileSize!,
    mediaType: nodeOptions.mediaType!,
    uploadStatus: nodeOptions.uploadStatus!,
    localPath,
    createdAt: now,
    updatedAt: now
  };
  return mediaNode;
}

export interface ExternalVideoInfo {
  provider: ExternalVideoProvider;
  sourceUrl: string;
  embedUrl: string;
}

const ALPHA_CAPABLE_IMAGE_FORMATS = ['png', 'webp', 'avif', 'heic', 'heif'] as const;

export function isAlphaCapableImageFormat(extension: string, mimeType?: string): boolean {
  const ext = extension.toLowerCase().replace(/^\./, '');
  const lowerMime = (mimeType || '').toLowerCase();
  return ALPHA_CAPABLE_IMAGE_FORMATS.some((fmt) => ext === fmt || lowerMime.includes(fmt));
}

// 调试工具
export function logFileInfo(file: File): void {
  // console.log('📁 File Info:', {
  //   name: file.name,
  //   type: file.type,
  //   size: formatFileSize(file.size),
  //   supported: isSupportedFileType(file.name)
  // });
}

/** 解析 Supabase fileUrl/publicUrl 中的存储对象路径 */
const R2_HOST_SUFFIXES = ['.r2.cloudflarestorage.com', '.r2.dev'];

const isR2Host = (host: string): boolean => R2_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));

const looksLikeAccountId = (value: string): boolean => /^[a-f0-9]{16,}$/i.test(value || '');

export function parseStoragePathFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const mediaMarker = '/media/file-uploads/';
    const markerIndex = u.pathname.indexOf(mediaMarker);
    if (markerIndex !== -1) {
      const candidate = u.pathname.slice(markerIndex + mediaMarker.length);
      if (candidate) return decodeURIComponent(candidate);
    }
    const match = u.pathname.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/(.+)$/);
    if (match) {
      const bucket = match[1];
      const obj = decodeURIComponent(match[2]);
      if (bucket === 'file-uploads') return obj;
    }
    if (isR2Host(u.hostname)) {
      const cleanPath = u.pathname.replace(/^\/+/, '');
      if (!cleanPath) return null;
      const hostLabel = (u.hostname || '').split('.')[0] || '';
      const parts = cleanPath.split('/');
      if (looksLikeAccountId(hostLabel) && parts.length >= 2) {
        return decodeURIComponent(parts.slice(1).join('/'));
      }
      return decodeURIComponent(cleanPath);
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/** 综合节点信息推导稳定的 storagePath（优先 storagePath 字段，其次 fileUrl） */
export function deriveStoragePath(node: { storagePath?: string | null; fileUrl?: string | null; fileDownloadUrl?: string | null }): string | null {
  if (node.storagePath) return node.storagePath;
  return parseStoragePathFromUrl(node.fileUrl || node.fileDownloadUrl);
}

interface BuildMediaProxyUrlOptions {
  token?: string;
  canvasId?: string;
  ttlSeconds?: number;
  extraParams?: Record<string, string | undefined>;
}

/** 构造后端 /api/media/file-uploads/ 稳定代理 URL，自动追加 token/canvas/ttl */
export function buildMediaProxyUrl(
  storagePath?: string | null,
  options?: BuildMediaProxyUrlOptions
): string | undefined {
  if (!storagePath) return undefined;
  const encodedPath = encodeStoragePath(storagePath);
  const base = `/api/media/file-uploads/${encodedPath}`;
  const params = new URLSearchParams();
  params.set('ttl', String(options?.ttlSeconds ?? 600));
  if (options?.token) params.set('token', options.token);
  if (options?.canvasId) params.set('canvas_id', options.canvasId);
  if (options?.extraParams) {
    Object.entries(options.extraParams).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

const parseYouTubeStart = (rawValue?: string | null): number | null => {
  if (!rawValue) return null;
  const raw = rawValue.trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Math.max(0, parseInt(raw, 10));
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return null;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const seconds = match[3] ? parseInt(match[3], 10) : 0;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
};

const ensureUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    try {
      return new URL(`https://${value}`);
    } catch {
      return null;
    }
  }
};

const parseYouTubeInfo = (url: URL): ExternalVideoInfo | null => {
  const host = url.hostname.toLowerCase();
  const isShort = host === 'youtu.be';
  const isYouTube = isShort || host.endsWith('youtube.com');
  if (!isYouTube) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  let videoId: string | null = null;
  if (isShort) {
    videoId = parts[0] || null;
  } else if (parts[0] === 'watch') {
    videoId = url.searchParams.get('v');
  } else if (parts[0] === 'embed' && parts[1]) {
    videoId = parts[1];
  } else if ((parts[0] === 'shorts' || parts[0] === 'live') && parts[1]) {
    videoId = parts[1];
  }
  if (!videoId) return null;
  const start = parseYouTubeStart(url.searchParams.get('start') || url.searchParams.get('t'));
  const params = new URLSearchParams();
  params.set('autoplay', '0');
  if (start) params.set('start', String(start));
  const qs = params.toString();
  return {
    provider: 'youtube',
    sourceUrl: url.toString(),
    embedUrl: qs ? `https://www.youtube-nocookie.com/embed/${videoId}?${qs}` : `https://www.youtube-nocookie.com/embed/${videoId}`,
  };
};

const parseBilibiliInfo = (url: URL): ExternalVideoInfo | null => {
  const host = url.hostname.toLowerCase();
  if (host === 'player.bilibili.com') {
    const bvid = url.searchParams.get('bvid');
    const aid = url.searchParams.get('aid');
    if (bvid) {
      return {
        provider: 'bilibili',
        sourceUrl: url.toString(),
        embedUrl: `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=0`,
      };
    }
    if (aid) {
      return {
        provider: 'bilibili',
        sourceUrl: url.toString(),
        embedUrl: `https://player.bilibili.com/player.html?aid=${aid}&autoplay=0`,
      };
    }
    return null;
  }
  if (!host.endsWith('bilibili.com')) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const videoIndex = parts.indexOf('video');
  const rawId = videoIndex >= 0 ? parts[videoIndex + 1] : null;
  if (!rawId) return null;
  if (/^av\d+$/i.test(rawId)) {
    const aid = rawId.replace(/^av/i, '');
    return {
      provider: 'bilibili',
      sourceUrl: url.toString(),
      embedUrl: `https://player.bilibili.com/player.html?aid=${aid}&autoplay=0`,
    };
  }
  return {
    provider: 'bilibili',
    sourceUrl: url.toString(),
    embedUrl: `https://player.bilibili.com/player.html?bvid=${rawId}&autoplay=0`,
  };
};

export function parseExternalVideoUrl(raw: string): ExternalVideoInfo | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const url = ensureUrl(trimmed);
  if (!url) return null;
  return parseYouTubeInfo(url) || parseBilibiliInfo(url);
}

export function normalizeExternalEmbedUrl(
  embedUrl?: string | null,
  provider?: ExternalVideoProvider | null
): string | undefined {
  if (!embedUrl) return undefined;
  let url: URL;
  try {
    url = new URL(embedUrl);
  } catch {
    return embedUrl;
  }
  const host = url.hostname.toLowerCase();
  const resolvedProvider = provider
    ?? (host.endsWith('youtube.com') || host === 'youtu.be' ? 'youtube' : null)
    ?? (host.endsWith('bilibili.com') ? 'bilibili' : null);
  if (!resolvedProvider) return embedUrl;
  url.searchParams.set('autoplay', '0');
  if (resolvedProvider === 'youtube') {
    url.hostname = 'www.youtube-nocookie.com';
  }
  return url.toString();
}
