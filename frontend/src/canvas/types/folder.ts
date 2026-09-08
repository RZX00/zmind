// 📁 虚拟文件夹类型系统
// 支持Canvas文件的分层组织管理

// 🗂️ 文件夹基础类型
export interface Folder {
  id: string;                    // 文件夹唯一ID
  name: string;                  // 文件夹名称
  parentId: string | null;       // 父文件夹ID，null表示根级文件夹
  canvasIds: string[];           // 包含的Canvas文件ID数组
  childFolderIds: string[];      // 子文件夹ID数组
  level: number;                 // 文件夹层级 (0=根级, 1=一级, 2=二级, 最多3层)
  isExpanded: boolean;           // 展开状态
  createdAt: number;             // 创建时间戳
  updatedAt: number;             // 更新时间戳
  sortOrder: number;             // 排序权重
  clientRequestId?: string;      // 客户端请求ID（本地乐观更新用）
}

// 🗂️ 文件夹树节点（包含Canvas文件）
export interface FolderTreeNode {
  id: string;
  type: 'folder' | 'canvas' | 'doc';
  name: string;
  parentId: string | null;
  level: number;
  isExpanded?: boolean;          // 只有folder类型有此字段
  canvasIds?: string[];          // 只有folder类型有此字段
  docIds?: string[];             // 只有folder类型有此字段
  childFolderIds?: string[];     // 只有folder类型有此字段
  sortOrder: number;
  createdAt: number;             // 创建时间戳
  updatedAt: number;             // 更新时间戳
  
  // Canvas相关字段（当type为'canvas'时）
  canvas?: {
    id: string;
    title: string;
    updatedAt: number;
  };

  // Doc相关字段（当type为'doc'时）
  doc?: {
    itemId: string;
    title: string;
    updatedAt: number;
    version?: number;
    folderId?: string | null;
  };
  
  // 文件夹相关字段（当type为'folder'时）
  folder?: Folder;
}

// 🗂️ 文件夹元数据容器
export interface FoldersMetadata {
  version: string;               // 元数据版本
  folders: Record<string, Folder>; // 文件夹映射表 id -> Folder
  rootFolderIds: string[];       // 根级文件夹ID数组（排序后）
  expandedFolders: Record<string, boolean>; // 文件夹展开状态映射
  lastUpdated: number;           // 最后更新时间
}

// 🎯 文件夹创建选项
export interface CreateFolderOptions {
  name: string;
  parentId?: string | null;      // 默认null（根级）
  sortOrder?: number;            // 默认自动计算
  clientRequestId?: string;      // 客户端请求ID（本地乐观更新用）
}

// 🔧 文件夹更新选项
export interface UpdateFolderOptions {
  name?: string;
  parentId?: string | null;
  isExpanded?: boolean;
  sortOrder?: number;
}

// 🚚 文件移动选项
export interface MoveCanvasOptions {
  canvasId: string;
  fromFolderId: string | null;   // null表示根目录
  toFolderId: string | null;     // null表示根目录
}

// 🚚 文件夹移动选项
export interface MoveFolderOptions {
  folderId: string;
  newParentId: string | null;
  newSortOrder?: number;
}

// 📊 文件夹统计信息
export interface FolderStats {
  totalFolders: number;
  totalCanvases: number;
  foldersByLevel: Record<number, number>;
  deepestLevel: number;
}

// 🔍 文件夹查询选项
export interface FolderQueryOptions {
  parentId?: string | null;      // 查询特定父文件夹下的子项
  level?: number;               // 查询特定层级的文件夹
  includeCanvases?: boolean;    // 是否包含Canvas文件
  expandedOnly?: boolean;       // 只查询展开的文件夹
  sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'sortOrder';
  sortOrder?: 'asc' | 'desc';
}

// 🏗️ 文件夹管理器接口
export interface FolderManager {
  // 基础CRUD
  createFolder: (options: CreateFolderOptions) => Promise<Folder>;
  updateFolder: (id: string, options: UpdateFolderOptions) => Promise<Folder>;
  deleteFolder: (id: string, moveCanvasesToParent?: boolean) => Promise<void>;
  getFolder: (id: string) => Promise<Folder | null>;
  getAllFolders: (options?: FolderQueryOptions) => Promise<Folder[]>;
  
  // 文件夹树构建
  buildFolderTree: (includeCanvases?: boolean) => Promise<FolderTreeNode[]>;
  getFolderPath: (folderId: string) => Promise<string[]>; // 返回路径数组 ["根文件夹", "子文件夹"]
  
  // 文件移动
  moveCanvas: (options: MoveCanvasOptions) => Promise<void>;
  moveFolder: (options: MoveFolderOptions) => Promise<void>;
  
  // 展开/折叠
  toggleFolder: (id: string) => Promise<Folder>;
  expandAllFolders: () => Promise<void>;
  collapseAllFolders: () => Promise<void>;
  
  // 统计和验证
  getStats: () => Promise<FolderStats>;
  validateStructure: () => Promise<boolean>;
  
  // 搜索
  searchFolders: (query: string) => Promise<Folder[]>;
  findFoldersByCanvas: (canvasId: string) => Promise<Folder | null>;
}

// 🎮 文件夹操作事件类型
export type FolderEvent = 
  | { type: 'CREATE_FOLDER'; payload: CreateFolderOptions }
  | { type: 'UPDATE_FOLDER'; payload: { id: string; updates: UpdateFolderOptions } }
  | { type: 'DELETE_FOLDER'; payload: { id: string; moveCanvasesToParent?: boolean } }
  | { type: 'MOVE_CANVAS'; payload: MoveCanvasOptions }
  | { type: 'MOVE_FOLDER'; payload: MoveFolderOptions }
  | { type: 'TOGGLE_FOLDER'; payload: { id: string } }
  | { type: 'EXPAND_ALL_FOLDERS' }
  | { type: 'COLLAPSE_ALL_FOLDERS' };

// 🎨 拖拽相关类型
export interface DragItem {
  type: 'canvas' | 'folder' | 'doc';
  id: string;
  name: string;
  sourceParentId: string | null;
}

export interface DropTarget {
  type: 'folder' | 'root';
  id: string | null;            // null表示根目录
  accept: ('canvas' | 'folder' | 'doc')[];
  level?: number;
}

// 🔄 文件夹树渲染帮助类型
export interface FolderTreeRenderOptions {
  showEmptyFolders: boolean;
  maxDisplayLevel: number;
  enableDragDrop: boolean;
  showCanvasCount: boolean;
  compactMode: boolean;
}

// 📝 常量定义
export const FOLDER_CONSTANTS = {
  MAX_FOLDER_LEVELS: 3,         // 最大层级数
  MAX_FOLDER_NAME_LENGTH: 50,   // 文件夹名称最大长度
  MAX_FOLDERS_PER_LEVEL: 100,   // 每层最大文件夹数
  DEFAULT_FOLDER_NAME: 'New Folder',
  ROOT_FOLDER_ID: null,         // 根目录标识
  METADATA_FILE_NAME: 'folders-metadata.json',
} as const;

// 🛠️ 工具函数类型
export interface FolderUtils {
  // 验证函数
  isValidFolderName: (name: string) => boolean;
  isValidFolderLevel: (level: number) => boolean;
  canMoveFolderToParent: (folderId: string, parentId: string | null) => boolean;
  
  // 路径处理
  getFolderDisplayPath: (folder: Folder, allFolders: Folder[]) => string;
  getRelativePath: (fromFolderId: string, toFolderId: string) => string[];
  
  // 排序和过滤
  sortFolders: (folders: Folder[], sortBy?: string) => Folder[];
  filterFoldersForLevel: (folders: Folder[], level: number) => Folder[];
  
  // 数据转换
  folderToTreeNode: (folder: Folder) => FolderTreeNode;
  canvasToTreeNode: (canvas: any, parentId: string | null) => FolderTreeNode;
}

// 🎯 默认值和初始化
export const DEFAULT_FOLDERS_METADATA: FoldersMetadata = {
  version: '1.0.0',
  folders: {},
  rootFolderIds: [],
  expandedFolders: {},
  lastUpdated: Date.now(),
};

export const DEFAULT_FOLDER_TREE_RENDER_OPTIONS: FolderTreeRenderOptions = {
  showEmptyFolders: true,
  maxDisplayLevel: 3,
  enableDragDrop: true,
  showCanvasCount: true,
  compactMode: false,
};
