export type ObsidianImportSourceType = 'zip' | 'directory';
export type ObsidianImportStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partially_completed';
export type ObsidianExportStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ObsidianImportJobStats {
  total_files: number;
  imported_docs: number;
  imported_assets: number;
  created_references: number;
  unresolved_links: number;
  failed_files: number;
}

export interface ObsidianImportJob {
  id: string;
  status: ObsidianImportStatus;
  sourceType: ObsidianImportSourceType;
  progress: number;
  stats: ObsidianImportJobStats;
  reportUrl: string;
  errorMessage?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
}

export interface ObsidianImportUploadPayload {
  files: Array<{
    path: string;
    content: string;
  }>;
  assets?: Array<{
    path: string;
    base64: string;
    contentType?: string;
    originalFilename?: string;
  }>;
  zipBase64?: string;
}

export interface ObsidianImportReport {
  pathToItemId?: Record<string, string>;
  unresolvedLinks?: Array<Record<string, unknown>>;
  unresolvedAssets?: Array<Record<string, unknown>>;
  summary?: ObsidianImportJobStats;
}

export interface ObsidianExportJob {
  id: string;
  status: ObsidianExportStatus;
  progress: number;
  scopeType: 'workspace' | 'folder';
  scopeId?: string | null;
  stats: Record<string, unknown>;
  errorMessage?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  downloadUrl?: string | null;
}
