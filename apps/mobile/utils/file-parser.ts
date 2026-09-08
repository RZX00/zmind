import { SERVER_URL } from '@/constants/Server';
import type { UploadedFile } from './file-upload';

export interface ParsedFileContent {
  attachments: (string | UploadedFile)[];
  cleanContent: string;
}

/**
 * Construct the API URL for file content
 */
export function getFileUrl(path: string, opts?: { threadId?: string }): string {
  if (/^https?:\/\//i.test(path)) return path;

  const cleanPath = path.replace(/^\//, '');
  const url = new URL(`${SERVER_URL}/media/file-uploads/${encodeURIComponent(cleanPath)}`);
  if (opts?.threadId) {
    url.searchParams.append('thread_id', opts.threadId);
  }
  return url.toString();
}

/**
 * Parse file attachments from message content and return clean content + attachments
 * Now supports using cached files from message metadata
 */
export function parseFileAttachments(
  content: string, 
  cachedFiles?: any[]
): { attachments: (string | UploadedFile)[], cleanContent: string } {
  const fileRegex = /\[Uploaded File: ([^\]]+)\]/g;
  const matches = [];
  let match;
  
  while ((match = fileRegex.exec(content)) !== null) {
    matches.push(match[1]);
  }
  
  // Remove file references from content
  const cleanContent = content.replace(fileRegex, '').trim();
  
  // If we have cached files or metadata attachments, use them instead of just file paths
  if (cachedFiles && cachedFiles.length > 0) {
    console.log('[parseFileAttachments] Using cached files:', cachedFiles.length);
    const mapped = cachedFiles.map((item): UploadedFile | string | null => {
      if (!item) return null;
      if (typeof item === 'string') return item;
      if (typeof item === 'object') {
        if (typeof item.path === 'string' && item.path) {
          return item as UploadedFile;
        }
        const fileId = item.file_id || item.fileId || item.id;
        const storagePath = item.storage_path || item.storagePath || item.path;
        const name = item.name || item.filename || item.original_filename;
        if (typeof storagePath === 'string' && storagePath) {
          return {
            name: typeof name === 'string' && name.trim() ? name : storagePath.split('/').pop() || 'file',
            path: storagePath,
            size: item.size || item.file_size || 0,
            type: item.content_type || item.contentType || item.type || 'application/octet-stream',
            fileId: typeof fileId === 'string' ? fileId : undefined,
            storagePath: storagePath,
          } satisfies UploadedFile;
        }
      }
      return null;
    }).filter(Boolean) as (UploadedFile | string)[];
    return {
      attachments: mapped,
      cleanContent
    };
  }
  
  // Fallback to file paths for server loading
  return {
    attachments: matches,
    cleanContent
  };
}

/**
 * File type detection based on extension
 */
export type FileType = 
  | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'code' | 'other';

export function getFileType(filename: string): FileType {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (['txt', 'md', 'log', 'csv'].includes(ext)) return 'text';
  if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'py'].includes(ext)) return 'code';
  
  return 'other';
}

/**
 * Generate file size estimation based on filename and type
 */
export function getEstimatedFileSize(filepath: string, type: FileType): string {
  const base = (filepath.length * 5) % 800 + 200;
  
  const multipliers: Record<FileType, number> = {
    image: 5.0,
    video: 20.0,
    audio: 10.0,
    pdf: 8.0,
    text: 0.3,
    code: 0.5,
    other: 1.0
  };
  
  const size = base * multipliers[type];
  
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
} 
