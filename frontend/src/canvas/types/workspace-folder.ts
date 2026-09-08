// 🏢 工作台文件夹层级展示类型系统
// 专为横向层级展开设计

import type { Canvas } from './canvas';
import type { Folder, FolderTreeNode } from './folder';

// 🔧 层级数据结构
export interface LayerData {
  level: number;                    // 层级号 (0, 1, 2, 3...)
  parentFolderId: string | null;    // 父文件夹ID，null表示根层级
  items: LayerItem[];               // 该层级的所有项目
  isExpanded: boolean;              // 该层级是否展开显示
}

// 📁 层级项目（统一的文件夹和画布项）
export interface LayerItem {
  id: string;
  type: 'folder' | 'canvas';
  name: string;
  level: number;
  isExpanded?: boolean;             // 仅文件夹有效
  
  // Canvas相关数据
  canvas?: {
    id: string;
    title: string;
    updatedAt: number;
    nodeCount: number;
  };
  
  // Folder相关数据
  folder?: {
    id: string;
    name: string;
    canvasCount: number;
    childFolderCount: number;
    updatedAt: number;
  };
  
  // 展示属性
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

// 🌊 工作台文件夹状态
export interface WorkspaceFolderState {
  // 数据状态
  allFolders: Folder[];             // 所有文件夹
  allCanvases: Canvas[];            // 所有画布
  horizontalLayers: LayerData[];    // 横向层级数据
  
  // 交互状态
  expandedFolders: Set<string>;     // 已展开的文件夹ID
  selectedItemId: string | null;    // 当前选中的项目ID
  selectedItemType: 'folder' | 'canvas' | null; // 选中项的类型
  
  // UI状态
  isLoading: boolean;
  error: string | null;
  maxVisibleLayers: number;         // 最大可见层级数（响应式）
  
  // 拖拽状态
  dragState: DragState | null;
}

// 🎯 拖拽状态
export interface DragState {
  dragItem: {
    id: string;
    type: 'folder' | 'canvas';
    name: string;
    sourceLayer: number;
    sourceParentId: string | null;
  };
  dragOverItemId: string | null;
  dragOverLayer: number | null;
  isValidDrop: boolean;
}

// 🏗️ 层级构建选项
export interface LayerBuildOptions {
  includeEmptyFolders: boolean;     // 是否包含空文件夹
  maxLayers: number;                // 最大层级数
  sortBy: 'name' | 'updateTime' | 'createTime'; // 排序方式
  sortOrder: 'asc' | 'desc';        // 排序方向
  showCanvasCount: boolean;         // 是否显示画布数量
}

// 🎮 操作类型定义
export type WorkspaceFolderAction = 
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_DATA'; payload: { folders: Folder[]; canvases: Canvas[]; expandedFolders?: Set<string> } }
  | { type: 'EXPAND_FOLDER'; payload: string }
  | { type: 'COLLAPSE_FOLDER'; payload: string }
  | { type: 'SELECT_ITEM'; payload: { id: string; type: 'folder' | 'canvas' } | null }
  | { type: 'SET_DRAG_STATE'; payload: DragState | null }
  | { type: 'SET_MAX_VISIBLE_LAYERS'; payload: number };

// 🔧 操作接口
export interface WorkspaceFolderOperations {
  // 基础数据操作
  loadData: () => Promise<void>;
  refreshData: () => Promise<void>;
  
  // 文件夹操作
  createFolder: (name: string, parentId?: string | null) => Promise<Folder>;
  renameFolder: (id: string, newName: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  
  // 画布操作
  duplicateCanvas: (id: string) => Promise<void>;
  deleteCanvas: (id: string) => Promise<void>;
  moveCanvas: (canvasId: string, fromFolderId: string | null, toFolderId: string | null) => Promise<void>;
  
  // 交互操作
  expandFolder: (folderId: string) => void;
  collapseFolder: (folderId: string) => void;
  toggleFolder: (folderId: string) => void;
  selectItem: (id: string, type: 'folder' | 'canvas') => void;
  clearSelection: () => void;
  
  // 拖拽操作
  handleDragStart: (item: LayerItem) => void;
  handleDragOver: (targetId: string, targetLayer: number) => void;
  handleDrop: (targetId: string, targetType: 'folder' | 'root') => Promise<void>;
  handleDragEnd: () => void;
  
  // 视图操作
  setMaxVisibleLayers: (count: number) => void;
  collapseAllFolders: () => void;
  expandAllFolders: () => void;
}

// 📐 响应式断点配置
export interface ResponsiveConfig {
  mobile: { maxLayers: number; minColumnWidth: number };      // < 768px
  tablet: { maxLayers: number; minColumnWidth: number };      // 768px - 1024px  
  desktop: { maxLayers: number; minColumnWidth: number };     // > 1024px
  ultrawide: { maxLayers: number; minColumnWidth: number };   // > 1920px
}

// 🎨 视觉配置
export interface VisualConfig {
  layerGap: number;                 // 层级间距 (px)
  itemHeight: number;               // 项目高度 (px)
  indentSize: number;               // 缩进大小 (px)
  connectionLineWidth: number;      // 连接线宽度 (px)
  connectionLineColor: string;      // 连接线颜色
  expandAnimationDuration: number;  // 展开动画时长 (ms)
  hoverAnimationDuration: number;   // 悬停动画时长 (ms)
}

// 🎯 默认配置
export const DEFAULT_WORKSPACE_FOLDER_STATE: Omit<WorkspaceFolderState, 'allFolders' | 'allCanvases' | 'horizontalLayers'> = {
  expandedFolders: new Set(),
  selectedItemId: null,
  selectedItemType: null,
  isLoading: false,
  error: null,
  maxVisibleLayers: 4,
  dragState: null,
};

export const DEFAULT_LAYER_BUILD_OPTIONS: LayerBuildOptions = {
  includeEmptyFolders: true,
  maxLayers: 4,
  sortBy: 'updateTime',
  sortOrder: 'desc',
  showCanvasCount: true,
};

export const DEFAULT_RESPONSIVE_CONFIG: ResponsiveConfig = {
  mobile: { maxLayers: 2, minColumnWidth: 280 },
  tablet: { maxLayers: 3, minColumnWidth: 320 },
  desktop: { maxLayers: 4, minColumnWidth: 280 },
  ultrawide: { maxLayers: 6, minColumnWidth: 300 },
};

export const DEFAULT_VISUAL_CONFIG: VisualConfig = {
  layerGap: 24,
  itemHeight: 120,
  indentSize: 16,
  connectionLineWidth: 2,
  connectionLineColor: '#7A8C7E',
  expandAnimationDuration: 300,
  hoverAnimationDuration: 150,
};