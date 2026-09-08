// 🛠️ 工作台文件夹层级构建工具
// 将文件夹和画布数据转换为横向层级展示结构

import type { Canvas, CanvasNode } from '../types/canvas';
import type { Folder } from '../types/folder';
import type { 
  LayerData, 
  LayerItem, 
  LayerBuildOptions,
  WorkspaceFolderState
} from '../types/workspace-folder';

import { getCanvasNodeCount } from './canvasUtils';

/**
 * 🌳 构建横向层级数据
 * 核心算法：根据展开状态构建层级视图
 */
export const buildHorizontalLayers = (
  folders: Folder[],
  canvases: Canvas[],
  expandedFolders: Set<string>,
  options: LayerBuildOptions
): LayerData[] => {
  const layers: LayerData[] = [];
  const folderMap = new Map(folders.map(f => [f.id, f]));
  const canvasMap = new Map(canvases.map(c => [c.id, c]));
  
  // 🔍 获取指定层级的项目
  const getItemsForLevel = (level: number, parentId: string | null): LayerItem[] => {
    const items: LayerItem[] = [];
    
    if (level === 0) {
      // 根层级：获取所有根文件夹和未分类画布
      const rootFolders = folders.filter(f => !f.parentId);
      const unassignedCanvases = canvases.filter(c => 
        !folders.some(f => f.canvasIds.includes(c.id))
      );
      
      // 添加根文件夹
      rootFolders.forEach(folder => {
        items.push(createFolderLayerItem(folder, folderMap, canvasMap));
      });
      
      // 添加未分类画布
      unassignedCanvases.forEach(canvas => {
        items.push(createCanvasLayerItem(canvas));
      });
      
    } else if (parentId) {
      // 子层级：获取指定父文件夹的内容
      const parentFolder = folderMap.get(parentId);
      if (parentFolder) {
        // 添加子文件夹
        parentFolder.childFolderIds.forEach(childId => {
          const childFolder = folderMap.get(childId);
          if (childFolder) {
            items.push(createFolderLayerItem(childFolder, folderMap, canvasMap));
          }
        });
        
        // 添加文件夹中的画布
        parentFolder.canvasIds.forEach(canvasId => {
          const canvas = canvasMap.get(canvasId);
          if (canvas) {
            items.push(createCanvasLayerItem(canvas));
          }
        });
      }
    }
    
    // 排序
    return sortLayerItems(items, options);
  };
  
  // 🏗️ 构建层级结构
  // 第0层：根层级
  const rootItems = getItemsForLevel(0, null);
  if (rootItems.length > 0) {
    layers.push({
      level: 0,
      parentFolderId: null,
      items: rootItems,
      isExpanded: true, // 根层级总是展开
    });
  }
  
  // 递归构建子层级
  const buildChildLayers = (level: number) => {
    if (level >= options.maxLayers) return;
    
    // 找到上一层级中已展开的文件夹
    const parentLayer = layers.find(l => l.level === level - 1);
    if (!parentLayer) return;
    
    parentLayer.items.forEach(item => {
      if (item.type === 'folder' && expandedFolders.has(item.id)) {
        const childItems = getItemsForLevel(level, item.id);
        
        if (childItems.length > 0 || options.includeEmptyFolders) {
          layers.push({
            level: level,
            parentFolderId: item.id,
            items: childItems,
            isExpanded: true,
          });
        }
      }
    });
    
    // 继续构建下一层
    buildChildLayers(level + 1);
  };
  
  // 从第1层开始递归构建
  buildChildLayers(1);
  
  return layers;
};

/**
 * 📁 创建文件夹层级项
 */
const createFolderLayerItem = (
  folder: Folder, 
  folderMap: Map<string, Folder>,
  canvasMap: Map<string, Canvas>
): LayerItem => {
  // 计算子文件夹数量
  const childFolderCount = folder.childFolderIds.length;
  
  // 计算画布数量（递归计算所有子文件夹的画布）
  const getTotalCanvasCount = (folderId: string): number => {
    const currentFolder = folderMap.get(folderId);
    if (!currentFolder) return 0;
    
    let count = currentFolder.canvasIds.length;
    
    // 递归计算子文件夹的画布数
    currentFolder.childFolderIds.forEach(childId => {
      count += getTotalCanvasCount(childId);
    });
    
    return count;
  };
  
  const totalCanvasCount = getTotalCanvasCount(folder.id);
  
  return {
    id: folder.id,
    type: 'folder',
    name: folder.name,
    level: folder.level,
    isExpanded: folder.isExpanded,
    folder: {
      id: folder.id,
      name: folder.name,
      canvasCount: totalCanvasCount,
      childFolderCount: childFolderCount,
      updatedAt: folder.updatedAt,
    },
    sortOrder: folder.sortOrder,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  };
};

/**
 * 🎨 创建画布层级项
 */
const createCanvasLayerItem = (canvas: Canvas): LayerItem => {
  const nodeCount = getCanvasNodeCount(canvas);
  const title = typeof canvas.title === 'string' ? canvas.title : 'Untitled Canvas';
  
  return {
    id: canvas.id,
    type: 'canvas',
    name: title,
    level: 0, // 画布层级由其父文件夹决定
    canvas: {
      id: canvas.id,
      title: title,
      updatedAt: canvas.updatedAt || canvas.createdAt || Date.now(),
      nodeCount: nodeCount,
    },
    sortOrder: canvas.updatedAt || canvas.createdAt || Date.now(),
    createdAt: canvas.createdAt || Date.now(),
    updatedAt: canvas.updatedAt || canvas.createdAt || Date.now(),
  };
};

/**
 * 🎯 排序层级项目
 */
const sortLayerItems = (items: LayerItem[], options: LayerBuildOptions): LayerItem[] => {
  return items.sort((a, b) => {
    // 文件夹总是在画布前面
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }
    
    // 同类型按指定规则排序
    let comparison = 0;
    
    switch (options.sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'createTime':
        comparison = a.createdAt - b.createdAt;
        break;
      case 'updateTime':
      default:
        comparison = a.updatedAt - b.updatedAt;
        break;
    }
    
    return options.sortOrder === 'asc' ? comparison : -comparison;
  });
};

/**
 * 🔍 查找项目所在的层级
 */
export const findItemLayer = (layers: LayerData[], itemId: string): LayerData | null => {
  for (const layer of layers) {
    const item = layer.items.find(item => item.id === itemId);
    if (item) return layer;
  }
  return null;
};

/**
 * 🎯 获取文件夹的所有子项ID（递归）
 */
export const getAllDescendantIds = (
  folderId: string, 
  folders: Folder[]
): { folderIds: string[]; canvasIds: string[] } => {
  const folderMap = new Map(folders.map(f => [f.id, f]));
  const folderIds: string[] = [];
  const canvasIds: string[] = [];
  
  const traverse = (currentFolderId: string) => {
    const folder = folderMap.get(currentFolderId);
    if (!folder) return;
    
    // 添加子文件夹
    folder.childFolderIds.forEach(childId => {
      folderIds.push(childId);
      traverse(childId); // 递归
    });
    
    // 添加画布
    canvasIds.push(...folder.canvasIds);
  };
  
  traverse(folderId);
  return { folderIds, canvasIds };
};

/**
 * 📊 计算层级统计信息
 */
export const calculateLayerStats = (layers: LayerData[]) => {
  let totalFolders = 0;
  let totalCanvases = 0;
  const statsByLevel: Record<number, { folders: number; canvases: number }> = {};
  
  layers.forEach(layer => {
    const folderCount = layer.items.filter(item => item.type === 'folder').length;
    const canvasCount = layer.items.filter(item => item.type === 'canvas').length;
    
    totalFolders += folderCount;
    totalCanvases += canvasCount;
    
    statsByLevel[layer.level] = {
      folders: folderCount,
      canvases: canvasCount,
    };
  });
  
  return {
    totalFolders,
    totalCanvases,
    totalLayers: layers.length,
    maxLevel: Math.max(...layers.map(l => l.level), -1) + 1,
    statsByLevel,
  };
};

/**
 * 🔧 层级数据调试工具
 */
export const debugLayerStructure = (layers: LayerData[]): void => {
  // Debug function disabled in production
  if (process.env.NODE_ENV !== 'development') return;
};

/**
 * 🎨 生成连接线CSS样式
 */
export const generateConnectionLineStyle = (
  fromLevel: number,
  toLevel: number,
  connectionLineColor: string,
  connectionLineWidth: number,
  layerGap: number
): React.CSSProperties => {
  if (toLevel <= fromLevel) return {};
  
  const distance = (toLevel - fromLevel) * layerGap;
  
  return {
    position: 'absolute' as const,
    right: -layerGap / 2,
    top: '50%',
    width: distance,
    height: connectionLineWidth,
    backgroundColor: connectionLineColor,
    opacity: 0.6,
    transform: 'translateY(-50%)',
    borderRadius: connectionLineWidth / 2,
  };
};
