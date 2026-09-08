// 🔄 Canvas数据迁移工具
// 将现有Canvas文件从旧格式迁移到新的语义化ID + 全局样式架构

import type { Canvas, CanvasNode, NodeType } from '../../types/canvas';
import { NodeIds } from './nodeIdUtils';

// 全局样式默认配置
const DEFAULT_GLOBAL_STYLES = {
  borderRadius: 8,           // 节点圆角
  fontFamily: 'monospace', // 默认字体
  canvasBackground: '#eeeded', // 默认画布背景
  canvasForeground: '#333333'  // 默认前景色
};

// 旧Canvas数据结构（向后兼容）
interface LegacyCanvas {
  id: string;
  title: string;
  nodes: Array<{
    id: string;
    type: NodeType;
    [key: string]: any;
  }>;
  connections?: any[];
  createdAt?: number;
  updatedAt?: number;
  version?: string;
  // 可能没有全局样式
  globalStyles?: any;
}

// 新Canvas数据结构
interface ModernCanvas {
  id: string;
  title: string;
  nodes: CanvasNode[];
  connections: any[];
  createdAt: number;
  updatedAt: number;
  version: string;
  globalStyles: {
    borderRadius: number;
    fontFamily: string;
    canvasBackground: string;
    canvasForeground: string;
  };
}

/**
 * 检查Canvas是否需要迁移
 * @param canvas Canvas数据
 * @returns 是否需要迁移
 */
export function needsMigration(canvas: LegacyCanvas): boolean {
  // 检查是否缺少全局样式
  if (!canvas.globalStyles) {
    return true;
  }

  // 检查是否有旧格式的节点ID
  const hasLegacyIds = canvas.nodes.some(node => 
    node.id.startsWith('canvas_') && node.id.includes('_')
  );

  return hasLegacyIds;
}

/**
 * 将节点ID从旧格式迁移到语义化格式
 * @param canvasId Canvas ID
 * @param nodes 节点列表
 * @returns 迁移后的节点列表和ID映射
 */
export function migrateNodeIds(canvasId: string, nodes: any[]): {
  migratedNodes: CanvasNode[];
  idMapping: Map<string, string>;
} {
  const idMapping = new Map<string, string>();
  const shortIdPattern = /^[0-9A-Za-z]{16}$/;
  
  // 第一遍：生成新ID并建立映射
  const migratedNodes = nodes.map(node => {
    const oldId = node.id;
    let newId: string;
    
    // 如果已经是新短ID，保持不变
    if (shortIdPattern.test(oldId)) {
      newId = oldId;
    } else {
      // 生成新的短ID
      newId = NodeIds.generateNodeId(canvasId, node.type);
    }
    
    idMapping.set(oldId, newId);
    
    return {
      ...node,
      id: newId
    };
  });

  return { migratedNodes, idMapping };
}

/**
 * 清理节点中的无用字体属性
 * @param node 节点数据
 * @returns 清理后的节点数据
 */
export function cleanNodeFontProperties(node: any): any {
  const cleanedNode = { ...node };
  
  // 移除节点级的字体属性（现在由全局样式控制）
  if (cleanedNode.textStyles) {
    const { fontSize, fontFamily, color, backgroundColor, ...keepTextStyles } = cleanedNode.textStyles;
    
    // 只保留UI中实际存在的属性：textAlign, accentColor, opacity
    const filteredTextStyles = {
      ...(keepTextStyles.textAlign && { textAlign: keepTextStyles.textAlign }),
      ...(keepTextStyles.accentColor && { accentColor: keepTextStyles.accentColor }),
      ...(keepTextStyles.opacity !== undefined && { opacity: keepTextStyles.opacity })
    };
    
    // 如果没有有效属性，删除textStyles；否则保留过滤后的属性
    if (Object.keys(filteredTextStyles).length > 0) {
      cleanedNode.textStyles = filteredTextStyles;
    } else {
      delete cleanedNode.textStyles;
    }
  }
  
  return cleanedNode;
}

/**
 * 迁移单个Canvas文件
 * @param canvas 原始Canvas数据
 * @returns 迁移后的Canvas数据
 */
export function migrateCanvas(canvas: LegacyCanvas): ModernCanvas {
  console.log('🔄 开始迁移Canvas:', canvas.id);
  
  // 1. 迁移节点ID
  const { migratedNodes, idMapping } = migrateNodeIds(canvas.id, canvas.nodes);
  
  // 2. 清理节点字体属性
  const cleanedNodes = migratedNodes.map(cleanNodeFontProperties);
  
  // 3. 更新连接中的节点引用（如果有连接）
  const migratedConnections = (canvas.connections || []).map(connection => ({
    ...connection,
    fromNodeId: idMapping.get(connection.fromNodeId) || connection.fromNodeId,
    toNodeId: idMapping.get(connection.toNodeId) || connection.toNodeId
  }));
  
  // 4. 添加全局样式配置
  const globalStyles = {
    ...DEFAULT_GLOBAL_STYLES,
    ...(canvas.globalStyles || {})
  };
  
  // 5. 构建迁移后的Canvas
  const migratedCanvas: ModernCanvas = {
    id: canvas.id,
    title: canvas.title,
    nodes: cleanedNodes,
    connections: migratedConnections,
    globalStyles,
    createdAt: canvas.createdAt || Date.now(),
    updatedAt: Date.now(),
    version: '2.0.0' // 升级版本号
  };
  
  console.log(`✅ Canvas迁移完成: ${migratedNodes.length}个节点, ${idMapping.size}个ID更新`);
  
  return migratedCanvas;
}

/**
 * 批量迁移多个Canvas文件
 * @param canvases Canvas文件列表
 * @returns 迁移后的Canvas文件列表
 */
export function batchMigrateCanvases(canvases: LegacyCanvas[]): ModernCanvas[] {
  console.log(`🚀 开始批量迁移 ${canvases.length} 个Canvas文件`);
  
  const migratedCanvases = canvases.map(canvas => {
    if (needsMigration(canvas)) {
      return migrateCanvas(canvas);
    } else {
      console.log(`⏭️ Canvas ${canvas.id} 已经是最新格式，跳过迁移`);
      return canvas as ModernCanvas;
    }
  });
  
  console.log(`🎉 批量迁移完成！`);
  return migratedCanvases;
}

/**
 * 生成迁移报告
 * @param original 原始Canvas
 * @param migrated 迁移后的Canvas
 * @returns 迁移报告
 */
export function generateMigrationReport(original: LegacyCanvas, migrated: ModernCanvas): {
  canvasId: string;
  nodeCount: number;
  idChanges: number;
  globalStylesAdded: boolean;
  version: { from: string; to: string };
} {
  const originalIds = new Set(original.nodes.map(n => n.id));
  const migratedIds = new Set(migrated.nodes.map(n => n.id));
  
  // 计算ID变更数量
  const commonIds = new Set([...originalIds].filter(id => migratedIds.has(id)));
  const idChanges = originalIds.size - commonIds.size;
  
  return {
    canvasId: original.id,
    nodeCount: original.nodes.length,
    idChanges,
    globalStylesAdded: !original.globalStyles,
    version: {
      from: original.version || '1.0.0',
      to: migrated.version
    }
  };
}

// 🎯 导出主要迁移接口
const canvasDataMigration = {
  needsMigration,
  migrateCanvas,
  batchMigrateCanvases,
  generateMigrationReport
};

export default canvasDataMigration;
