// 🏭 统一节点工厂 - 所有节点创建的唯一入口
// 实现工厂模式，消除创建逻辑的重复和冲突

import type { Canvas, CanvasNode, NodeType } from '../../../../types/canvas';
import { getCurrentTimestamp } from '../../../utils/canvasUtils';
import { NodeIds } from '../../../utils/nodeIdUtils';
import { 
  getDefaultNodeSize, 
  getDefaultNodeContent, 
  getDefaultNodeTitle,
  getNodeTypeSpecificDefaults 
} from './NodeDefaults';
import { useCanvasStore } from '../../../stores/canvas.store';
import {
  DEFAULT_TEXT_LAYOUT_PRESET,
  DEFAULT_TEXT_OPACITY_PRESET,
  applyOpacityToTextStyles,
  getTextLayoutPreset,
  getTextOpacityPreset
} from '../../../constants/textNodePresets';

// 📍 位置接口
export interface Position {
  x: number;
  y: number;
}

// 📐 尺寸接口
export interface Size {
  width: number;
  height: number;
}

// 🎛️ 节点创建选项
export interface NodeCreationOptions {
  type: NodeType;
  x: number;
  y: number;
  canvasId: string;  // 新增：Canvas ID用于生成语义化节点ID
  width?: number;
  height?: number;
  content?: string;
  title?: string;
  codeType?: string;
  [key: string]: any; // 允许其他特定属性
}

// 🎯 节点创建覆盖选项
export interface NodeOverrides {
  content?: string;
  title?: string;
  codeType?: string;
  completed?: boolean;
  textStyles?: any;
  children?: string[];
  isCollapsed?: boolean;
  width?: number;
  height?: number;
  // 表格专用字段
  data?: {
    rows: string[][];
    columnWidths?: number[];
    rowHeights?: number[];
  };
  // Canvas Link专用字段
  targetCanvasId?: string;
  thumbnailUrl?: string;
  lastSyncedAt?: number;
  // Media专用字段
  fileName?: string;
  fileType?: string;
  fileExtension?: string;
  fileSize?: number;
  mediaType?: 'image' | 'document' | 'spreadsheet' | 'presentation' | 'audio' | 'video';
  localPath?: string;
  uploadStatus?: 'pending' | 'uploaded' | 'mock' | 'error';
  mediaSource?: 'file' | 'external';
  externalUrl?: string;
  embedUrl?: string;
  externalProvider?: 'youtube' | 'bilibili';
}

/**
 * 🏭 统一节点工厂类
 * 
 * 职责：
 * - 统一所有节点类型的创建逻辑
 * - 应用默认值和覆盖值
 * - 确保节点属性的一致性和有效性
 */
export class NodeFactory {
  private static cloneTableData(data?: { rows?: string[][]; columnWidths?: number[]; rowHeights?: number[] }) {
    if (!data || !Array.isArray(data.rows)) {
      return undefined;
    }
    return {
      rows: data.rows.map(row => Array.isArray(row) ? [...row] : []),
      columnWidths: data.columnWidths ? [...data.columnWidths] : undefined,
      rowHeights: data.rowHeights ? [...data.rowHeights] : undefined,
    };
  }
  
  /**
   * 创建单个节点
   * 
   * @param type 节点类型
   * @param position 节点位置
   * @param canvasId Canvas ID（用于生成语义化节点ID）
   * @param overrides 覆盖的属性（可选）
   * @returns 完整的CanvasNode对象
   */
  static create(
    type: NodeType, 
    position: Position, 
    canvasId: string,
    overrides: NodeOverrides = {}
  ): CanvasNode {
    
    // 🎯 获取基础默认值 - 修复参数传递时序问题
    const codeType = overrides.codeType; // 提前获取codeType
    const defaultSize = getDefaultNodeSize(type, codeType);
    const defaultContent = getDefaultNodeContent(type, codeType);
    const defaultTitle = getDefaultNodeTitle(type);
    const typeSpecificDefaults = getNodeTypeSpecificDefaults(type, codeType);
    const tableDefaultData = type === 'table' && typeSpecificDefaults && (typeSpecificDefaults as any).data
      ? NodeFactory.cloneTableData((typeSpecificDefaults as any).data)
      : undefined;

    
    // ⏰ 时间戳
    const now = getCurrentTimestamp();
    
    // 🔧 构建基础节点对象 - 使用语义化ID，不包含UI状态
    const baseNode: CanvasNode = {
      id: NodeIds.generateNodeId(canvasId, type),
      type,
      x: position.x,
      y: position.y,
      width: overrides.width ?? defaultSize.width,
      height: overrides.height ?? defaultSize.height,
      content: overrides.content ?? (typeof defaultContent === 'string' ? defaultContent : ''),
      locked: false,
      createdAt: now,
      updatedAt: now
    };
    
    // 🏷️ 添加标题（仅对允许的类型）
    const allowTitle = (type === 'canvas-link');
    if (allowTitle && defaultTitle) {
      baseNode.title = overrides.title ?? defaultTitle;
    }
    
    // 🎯 应用类型特定的默认属性（避免直接复用 data 引用）
    if (typeSpecificDefaults) {
      const { data, ...rest } = typeSpecificDefaults as any;
      Object.assign(baseNode, rest);
    }
    
    // 🎛️ 应用覆盖属性（表格 data 单独处理以防引用污染）
    let overrideTableData: NodeOverrides['data'] | undefined;
    if (type === 'table' && overrides && Object.prototype.hasOwnProperty.call(overrides, 'data')) {
      overrideTableData = overrides.data;
    }
    const overridesForAssign = type === 'table' ? { ...overrides } : overrides;
    if (type === 'table' && overridesForAssign && 'data' in (overridesForAssign as any)) {
      delete (overridesForAssign as any).data;
    }
    Object.assign(baseNode, overridesForAssign);

    if (type === 'table') {
      baseNode.data = NodeFactory.cloneTableData(overrideTableData || tableDefaultData) || {
        rows: [['Header 1', 'Header 2'], ['', '']],
        columnWidths: [160, 160],
        rowHeights: [40, 40]
      };
    }

    // 🔒 约束：仅允许 canvas-link 持有 title；
    // 对 column / group：若传入了 title，但未提供 content，则将 title 映射到 content，并移除 title。
    if (!allowTitle) {
      const hasOverrideTitle = Object.prototype.hasOwnProperty.call(overrides, 'title');
      if (type === 'column' || type === 'group') {
        if (hasOverrideTitle && !Object.prototype.hasOwnProperty.call(overrides, 'content')) {
          const t = (overrides as any).title;
          if (typeof t === 'string' && t.length > 0) {
            baseNode.content = t;
          }
        }
      }
      // 移除不被允许的 title 字段（避免后续逻辑误用）
      if ((baseNode as any).title !== undefined) {
        delete (baseNode as any).title;
      }
    }
    
    // 🔗 Canvas Link特殊处理：强制确保关键字段不被覆盖
    if (type === 'canvas-link' && overrides) {
      if (overrides.content !== undefined) {
        baseNode.content = overrides.content;
      }
      if (overrides.title !== undefined) {
        baseNode.title = overrides.title;
      }
      if (overrides.targetCanvasId !== undefined) {
        baseNode.targetCanvasId = overrides.targetCanvasId;
      }
    }

    if (type === 'text' || type === 'todo') {
      const { canvas } = useCanvasStore.getState();
      const opacityPreset = getTextOpacityPreset(canvas?.textOpacityPreset ?? DEFAULT_TEXT_OPACITY_PRESET);
      const layoutPreset = getTextLayoutPreset(canvas?.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET);

      const minWidthPreset = layoutPreset.metrics.minWidth;
      const minHeight = layoutPreset.metrics.minHeight;

      // Mindmap-aware width floor: allow narrower than preset minWidth down to 0.5× default width
      let widthFloor = minWidthPreset;
      try {
        const parentGroupId = (overrides as any)?.parentGroupId;
        if (parentGroupId && canvas) {
          const g = canvas.nodes.find(n => n.id === parentGroupId && (n as any).type === 'group');
          const isMindmap = !!(g && ((g as any).groupMode === 'mindmap' || (g as any).mindmap));
          if (isMindmap) {
            // Default width for this node type (use factory defaults helper)
            const def = getDefaultNodeSize(type, codeType);
            const half = Math.max(1, Math.floor((def?.width || minWidthPreset) * 0.5));
            widthFloor = Math.min(minWidthPreset, half) === half ? half : half; // prefer half as floor for mindmap
          }
        }
      } catch {}

      baseNode.width = Math.max(widthFloor, baseNode.width || widthFloor);
      baseNode.height = Math.max(minHeight, baseNode.height || minHeight);

      const existingStyles = (baseNode as any).textStyles;
      baseNode.textStyles = applyOpacityToTextStyles(existingStyles, opacityPreset.value);
    }
    
    return baseNode;
  }
  
  /**
   * 批量创建节点
   * 
   * @param canvasId Canvas ID
   * @param specs 节点创建规格数组
   * @returns CanvasNode数组
   */
  static createBatch(canvasId: string, specs: Array<{
    type: NodeType;
    position: Position;
    overrides?: NodeOverrides;
  }>): CanvasNode[] {
    return specs.map(spec => 
      NodeFactory.create(spec.type, spec.position, canvasId, spec.overrides)
    );
  }
  
  /**
   * 克隆现有节点
   * 
   * @param sourceNode 源节点
   * @param canvasId Canvas ID
   * @param newPosition 新位置（可选，默认偏移50px）
   * @returns 克隆的新节点
   */
  static clone(sourceNode: CanvasNode, canvasId: string, newPosition?: Position): CanvasNode {
    const position = newPosition || {
      x: sourceNode.x + 50,
      y: sourceNode.y + 50
    };
    
    // 🎯 提取源节点的所有属性作为覆盖选项
    const overrides: NodeOverrides = {
      content: sourceNode.content,
      width: sourceNode.width,
      height: sourceNode.height
    };
    
    // 🎯 表格节点特殊处理：深拷贝data字段，防止引用污染
    if (sourceNode.type === 'table' && sourceNode.data) {
      overrides.data = NodeFactory.cloneTableData(sourceNode.data as any);
    }
    
    // 📋 复制类型特定的属性
    if (sourceNode.type === 'todo') {
      overrides.completed = sourceNode.completed;
    }
    
    if (sourceNode.type === 'code') {
      overrides.codeType = sourceNode.codeType;
    }
    
    if (sourceNode.type === 'column') {
      overrides.title = sourceNode.title;
      overrides.children = [...(sourceNode.children || [])];
      overrides.isCollapsed = sourceNode.isCollapsed;
    }
    
    return NodeFactory.create(sourceNode.type, position, canvasId, overrides);
  }
  
  /**
   * 从旧式CreateNodeOptions创建节点（兼容性方法）
   * 
   * @param options 旧式创建选项
   * @returns CanvasNode对象
   */
  static fromLegacyOptions(options: NodeCreationOptions): CanvasNode {
    const { type, x, y, canvasId, ...overrides } = options;
    
    return NodeFactory.create(
      type, 
      { x, y }, 
      canvasId,
      overrides
    );
  }
}

/**
 * 🎯 对外统一接口 - 兼容旧的createNode调用
 * 
 * @param options 节点创建选项
 * @returns CanvasNode对象
 */
export function createNode(options: NodeCreationOptions): CanvasNode {
  return NodeFactory.fromLegacyOptions(options);
}

/**
 * 🎯 新的简洁接口 - 推荐使用
 * 
 * @param type 节点类型
 * @param position 位置
 * @param canvasId Canvas ID
 * @param overrides 覆盖选项
 * @returns CanvasNode对象
 */
export function createNodeAtPosition(
  type: NodeType, 
  position: Position, 
  canvasId: string,
  overrides?: NodeOverrides
): CanvasNode {
  return NodeFactory.create(type, position, canvasId, overrides);
}

// 🚀 导出工厂类供其他模块使用
export { NodeFactory as default };
