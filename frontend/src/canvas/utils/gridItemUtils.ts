// 🎯 网格项目工具函数
// 实现文件夹原地展开的核心算法

import type { Canvas, CanvasNode } from '../../types/canvas';
import type { Folder } from '../types/folder';
import type { 
  GridItem, 
  CanvasGridItem, 
  FolderGridItem, 
  GridBuildOptions,
  GridExpandState 
} from '../types/grid-item';
import { DEFAULT_GRID_BUILD_OPTIONS } from '../types/grid-item';

/**
 * 🎯 将文件夹和画布扁平化为网格项目
 * 支持原地展开，按层级插入子项目
 */
export const buildGridItems = (
  folders: Folder[],
  canvases: Canvas[],
  expandState: GridExpandState,
  options: GridBuildOptions = {}
): GridItem[] => {
  const config = { ...DEFAULT_GRID_BUILD_OPTIONS, ...options };
  const result: GridItem[] = [];
  
  // 🛡️ 空值检查
  const safeFolders = folders || [];
  const safeCanvases = canvases || [];
  
  
  // 🔧 构建文件夹映射
  const folderMap = new Map<string, Folder>();
  safeFolders.forEach(folder => folderMap.set(folder.id, folder));
  
  // 🔧 构建画布映射
  const canvasMap = new Map<string, Canvas>();
  safeCanvases.forEach(canvas => canvasMap.set(canvas.id, canvas));
  
  // 🔧 计算画布归属：根据文件夹的 canvasIds 判定哪些画布在根目录
  const assignedCanvasIds = new Set<string>();
  for (const f of safeFolders) {
    for (const cid of f.canvasIds || []) assignedCanvasIds.add(cid);
  }
  // 🔧 按父级分组
  const rootFolders = safeFolders.filter(f => !f.parentId);
  const rootCanvases = safeCanvases.filter(c => !assignedCanvasIds.has(c.id));
  
  // 🎯 递归构建函数
  const buildLevel = (
    levelFolders: Folder[],
    levelCanvases: Canvas[],
    level: number,
    parentId?: string
  ): GridItem[] => {
    const levelItems: GridItem[] = [];
    
    // 如果超过最大层级，停止构建
    if (config.maxLevel !== undefined && level > config.maxLevel) {
      return levelItems;
    }
    
    // 层内排序：文件夹与画布分别按更新时间降序
    const sortedFolders = [...levelFolders].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const sortedCanvases = [...levelCanvases].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    // 📁 添加文件夹
    for (const folder of sortedFolders) {
      const childFolders = safeFolders.filter(f => f.parentId === folder.id);
      const childCanvases = safeCanvases.filter(c => (folder.canvasIds || []).includes(c.id));
      const childCount = childFolders.length + childCanvases.length;
      
      
      // 跳过空文件夹（如果配置要求）
      if (!config.showEmptyFolders && childCount === 0) {
        continue;
      }
      
      const folderItem: FolderGridItem = {
        type: 'folder',
        id: folder.id,
        level,
        parentId,
        isExpanded: expandState.expandedFolders.has(folder.id),
        childCount,
        data: folder,
      };
      
      levelItems.push(folderItem);
      
      // 🔄 如果文件夹展开，递归添加子项目
      if (expandState.expandedFolders.has(folder.id)) {
        const childItems = buildLevel(
          childFolders,
          childCanvases,
          level + 1,
          folder.id
        );
        levelItems.push(...childItems);
      }
    }
    
    // 🎨 添加画布
    for (const canvas of sortedCanvases) {
      const canvasItem: CanvasGridItem = {
        type: level === 0 ? 'canvas' : 'canvas-in-folder',
        id: canvas.id,
        level,
        parentId,
        data: canvas,
      };
      
      levelItems.push(canvasItem);
    }
    
    return levelItems;
  };
  
  // 🚀 从根级开始构建
  const gridItems = buildLevel(rootFolders, rootCanvases, 0);
  
  
  // 🔄 排序（保持构建顺序，不再二次全局排序）
  return sortGridItems(gridItems, config);
};

/**
 * 🔄 网格项目排序
 */
export const sortGridItems = (
  items: GridItem[],
  options: GridBuildOptions
): GridItem[] => {
  const { sortBy = 'updated', sortOrder = 'desc' } = options;
  
  // 🎯 关键修复：不进行排序！保持buildLevel构建时的顺序
  // buildLevel已经按照正确的层级结构插入了项目：文件夹 -> 子项目 -> 下一个文件夹...
  // 任何排序都会破坏这个精心构建的层级结构
  
  return items; // 直接返回原序列，保持层级结构
};

/**
 * 🎯 切换文件夹展开状态
 */
export const toggleFolderExpansion = (
  folderId: string,
  currentState: GridExpandState
): GridExpandState => {
  const newExpandedFolders = new Set(currentState.expandedFolders);
  const newExpandedLevels = new Map(currentState.expandedLevels);
  
  if (newExpandedFolders.has(folderId)) {
    // 收起文件夹
    newExpandedFolders.delete(folderId);
    newExpandedLevels.delete(folderId);
  } else {
    // 展开文件夹
    newExpandedFolders.add(folderId);
    // 记录展开层级（用于后续优化）
    newExpandedLevels.set(folderId, Date.now());
  }
  
  return {
    expandedFolders: newExpandedFolders,
    expandedLevels: newExpandedLevels,
  };
};

/**
 * 🎯 获取项目的缩进级别（用于CSS样式）
 */
export const getItemIndentLevel = (item: GridItem): number => {
  return item.level;
};

/**
 * 🎯 判断项目是否需要分割线
 * 新逻辑：分割线显示在文件夹内容结束之后，分隔文件夹内容和外部内容
 */
export const shouldShowDivider = (
  item: GridItem,
  index: number,
  allItems: GridItem[]
): boolean => {
  // 🎯 只在根级项目前显示分割线，且前面有展开的文件夹内容
  if (item.level === 0 && index > 0) {
    // 检查前一个项目是否为子项目（level > 0）
    const prevItem = allItems[index - 1];
    if (prevItem && prevItem.level > 0) {
      // 前面有子项目，当前是根级项目，需要分割线分隔
      return true;
    }
  }
  
  return false;
};

/**
 * 🎯 获取分割线样式配置
 */
export const getDividerStyle = (item: GridItem) => {
  return {
    marginTop: '24px',
    marginBottom: '16px',
    borderTop: '2px dashed #D1D5DB',
    paddingTop: '16px',
  };
};
