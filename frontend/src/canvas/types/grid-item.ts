// 🎯 网格视图项目类型定义
// 支持文件夹原地展开的网格项目结构

import type { Canvas } from './canvas';
import type { Folder } from './folder';

// 🎯 网格项目类型
export type GridItemType = 'canvas' | 'folder' | 'canvas-in-folder';

// 🎯 网格项目接口
export interface GridItem {
  type: GridItemType;
  id: string;
  level: number;              // 层级: 0=根级, 1=一级子项, 2=二级子项...
  parentId?: string;          // 父文件夹ID
  isExpanded?: boolean;       // 文件夹是否展开
  data: Canvas | Folder;      // 实际数据
}

// 🎯 画布网格项目
export interface CanvasGridItem extends GridItem {
  type: 'canvas' | 'canvas-in-folder';
  data: Canvas;
}

// 🎯 文件夹网格项目
export interface FolderGridItem extends GridItem {
  type: 'folder';
  data: Folder;
  isExpanded: boolean;
  childCount: number;         // 子项数量
}

// 🎯 网格展开状态
export interface GridExpandState {
  expandedFolders: Set<string>;
  expandedLevels: Map<string, number>; // 记录每个文件夹展开到的层级
}

// 🎯 网格构建选项
export interface GridBuildOptions {
  maxLevel?: number;          // 最大展开层级，默认无限制
  sortBy?: 'name' | 'created' | 'updated';
  sortOrder?: 'asc' | 'desc';
  showEmptyFolders?: boolean; // 是否显示空文件夹
}

// 🎯 默认网格构建选项
export const DEFAULT_GRID_BUILD_OPTIONS: GridBuildOptions = {
  maxLevel: undefined,
  sortBy: 'updated',
  sortOrder: 'desc',
  showEmptyFolders: true,
};