export type WorkspaceItemType = 'canvas' | 'doc';

export interface WorkspaceItem {
  id: string;
  type: WorkspaceItemType;
  title: string;
  folderId?: string | null;
  parentItemId?: string | null;
  sourceId?: string | null;
  isDeleted?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceDocMeta {
  itemId: string;
  title: string;
  version: number;
  updatedAt: number;
}
