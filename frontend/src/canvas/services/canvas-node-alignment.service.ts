/**
 * 🎯 Canvas节点对齐算法服务
 * 
 * 提供专业级的节点对齐功能，支持6种基础对齐模式：
 * - 水平对齐：左对齐、水平居中、右对齐
 * - 垂直对齐：顶部对齐、垂直居中、底部对齐
 * 
 * 所有算法采用纯函数设计，无副作用，支持批量处理和撤销重做
 * 
 * @version 1.0.0
 * @author ZhenZhi Canvas Team
 */

import type { CanvasNode } from '../types/canvas';
import { calculateCanvasBounds } from '../components/core/systems/CoordinateSystem';

// ==================== 类型定义 ====================

/**
 * 对齐类型枚举
 */
export enum AlignmentType {
  LEFT = 'left',           // 左对齐
  RIGHT = 'right',         // 右对齐
  TOP = 'top',            // 顶部对齐
  BOTTOM = 'bottom',       // 底部对齐
  CENTER_H = 'centerH',    // 水平居中
  CENTER_V = 'centerV',    // 垂直居中
  DISTRIBUTE_H = 'distribute_h',  // 水平等距分布
  DISTRIBUTE_V = 'distribute_v'   // 垂直等距分布
}

/**
 * 对齐选项配置
 */
export interface AlignmentOptions {
  /** 是否保持节点间的相对层级 */
  preserveZIndex?: boolean;
  /** 对齐基准模式：selection=选择边界，first=第一个节点，last=最后一个节点 */
  alignTo?: 'selection' | 'first' | 'last';
  /** 是否进行边界检查，防止节点移出画布 */
  boundaryCheck?: boolean;
}

/**
 * 对齐结果信息
 */
export interface AlignmentResult {
  /** 处理的节点数量 */
  processedCount: number;
  /** 实际移动的节点数量 */
  movedCount: number;
  /** 对齐后的节点数组 */
  alignedNodes: CanvasNode[];
  /** 对齐基准线坐标 */
  alignmentLine: number;
}

// ==================== 默认配置 ====================

const DEFAULT_OPTIONS: Required<AlignmentOptions> = {
  preserveZIndex: true,
  alignTo: 'selection',
  boundaryCheck: true
};

// ==================== 核心服务类 ====================

/**
 * Canvas节点对齐算法服务
 */
export class NodeAlignmentService {
  
  // ==================== 通用对齐方法 ====================
  
  /**
   * 通用对齐方法：根据对齐类型执行相应的对齐操作
   * 
   * @param nodes - 要对齐的节点数组  
   * @param alignmentType - 对齐类型
   * @param options - 对齐选项
   * @returns 对齐结果
   */
  public static align(
    nodes: CanvasNode[], 
    alignmentType: AlignmentType, 
    options: AlignmentOptions = {}
  ): AlignmentResult {
    switch (alignmentType) {
      case AlignmentType.LEFT:
        return this.alignLeft(nodes, options);
      case AlignmentType.RIGHT:
        return this.alignRight(nodes, options);
      case AlignmentType.TOP:
        return this.alignTop(nodes, options);
      case AlignmentType.BOTTOM:
        return this.alignBottom(nodes, options);
      case AlignmentType.CENTER_H:
        return this.alignCenterH(nodes, options);
      case AlignmentType.CENTER_V:
        return this.alignCenterV(nodes, options);
      case AlignmentType.DISTRIBUTE_H:
        return this.distributeHorizontally(nodes, options);
      case AlignmentType.DISTRIBUTE_V:
        return this.distributeVertically(nodes, options);
      default:
        throw new Error(`不支持的对齐类型: ${alignmentType}`);
    }
  }
  
  // ==================== 具体对齐方法 ====================
  
  /**
   * 左对齐：将所有节点的左边缘对齐到基准线
   * 
   * @param nodes - 要对齐的节点数组
   * @param options - 对齐选项
   * @returns 对齐结果
   */
  public static alignLeft(
    nodes: CanvasNode[], 
    options: AlignmentOptions = {}
  ): AlignmentResult {
    return this.performAlignment(nodes, AlignmentType.LEFT, options);
  }

  /**
   * 右对齐：将所有节点的右边缘对齐到基准线
   * 
   * @param nodes - 要对齐的节点数组
   * @param options - 对齐选项
   * @returns 对齐结果
   */
  public static alignRight(
    nodes: CanvasNode[], 
    options: AlignmentOptions = {}
  ): AlignmentResult {
    return this.performAlignment(nodes, AlignmentType.RIGHT, options);
  }

  /**
   * 顶部对齐：将所有节点的顶边对齐到基准线
   * 
   * @param nodes - 要对齐的节点数组
   * @param options - 对齐选项
   * @returns 对齐结果
   */
  public static alignTop(
    nodes: CanvasNode[], 
    options: AlignmentOptions = {}
  ): AlignmentResult {
    return this.performAlignment(nodes, AlignmentType.TOP, options);
  }

  /**
   * 底部对齐：将所有节点的底边对齐到基准线
   * 
   * @param nodes - 要对齐的节点数组
   * @param options - 对齐选项
   * @returns 对齐结果
   */
  public static alignBottom(
    nodes: CanvasNode[], 
    options: AlignmentOptions = {}
  ): AlignmentResult {
    return this.performAlignment(nodes, AlignmentType.BOTTOM, options);
  }

  /**
   * 水平居中对齐：将所有节点的水平中心对齐到基准线
   * 
   * @param nodes - 要对齐的节点数组
   * @param options - 对齐选项
   * @returns 对齐结果
   */
  public static alignCenterH(
    nodes: CanvasNode[], 
    options: AlignmentOptions = {}
  ): AlignmentResult {
    return this.performAlignment(nodes, AlignmentType.CENTER_H, options);
  }

  /**
   * 垂直居中对齐：将所有节点的垂直中心对齐到基准线
   * 
   * @param nodes - 要对齐的节点数组
   * @param options - 对齐选项
   * @returns 对齐结果
   */
  public static alignCenterV(
    nodes: CanvasNode[], 
    options: AlignmentOptions = {}
  ): AlignmentResult {
    return this.performAlignment(nodes, AlignmentType.CENTER_V, options);
  }

  // ==================== 核心算法实现 ====================

  /**
   * 执行对齐操作的核心算法
   * 
   * @param nodes - 节点数组
   * @param alignmentType - 对齐类型
   * @param options - 对齐选项
   * @returns 对齐结果
   */
  private static performAlignment(
    nodes: CanvasNode[],
    alignmentType: AlignmentType,
    options: AlignmentOptions
  ): AlignmentResult {
    // 🛡️ 输入验证
    if (!nodes || nodes.length < 2) {
      return {
        processedCount: nodes?.length || 0,
        movedCount: 0,
        alignedNodes: nodes ? [...nodes] : [],
        alignmentLine: 0
      };
    }

    // 🎯 合并配置选项
    const config = { ...DEFAULT_OPTIONS, ...options };

    // 🎯 深拷贝节点数组，确保纯函数特性
    const alignedNodes = nodes.map(node => ({ ...node }));

    // 📏 计算对齐基准线
    const alignmentLine = this.calculateAlignmentLine(alignedNodes, alignmentType, config);

    // 🎯 执行对齐操作
    let movedCount = 0;
    alignedNodes.forEach(node => {
      const newPosition = this.calculateNewPosition(node, alignmentType, alignmentLine);
      
      // 检查是否真的需要移动
      const needsMove = this.needsPositionUpdate(node, alignmentType, newPosition);
      if (needsMove) {
        // 更新节点位置
        this.updateNodePosition(node, alignmentType, newPosition);
        movedCount++;
      }
    });

    // 🛡️ 边界检查（如果启用）
    if (config.boundaryCheck) {
      this.performBoundaryCheck(alignedNodes);
    }

    return {
      processedCount: nodes.length,
      movedCount,
      alignedNodes,
      alignmentLine
    };
  }

  /**
   * 计算对齐基准线
   * 
   * @param nodes - 节点数组
   * @param alignmentType - 对齐类型
   * @param config - 配置选项
   * @returns 基准线坐标
   */
  private static calculateAlignmentLine(
    nodes: CanvasNode[],
    alignmentType: AlignmentType,
    config: Required<AlignmentOptions>
  ): number {
    switch (config.alignTo) {
      case 'first':
        return this.getNodeAlignmentCoordinate(nodes[0], alignmentType);
      
      case 'last':
        return this.getNodeAlignmentCoordinate(nodes[nodes.length - 1], alignmentType);
      
      case 'selection':
      default:
        return this.calculateSelectionBaseline(nodes, alignmentType);
    }
  }

  /**
   * 基于选择区域计算基准线
   * 
   * @param nodes - 节点数组
   * @param alignmentType - 对齐类型
   * @returns 基准线坐标
   */
  private static calculateSelectionBaseline(
    nodes: CanvasNode[],
    alignmentType: AlignmentType
  ): number {
    const bounds = calculateCanvasBounds(nodes, 0); // 不加padding
    
    switch (alignmentType) {
      case AlignmentType.LEFT:
        return bounds.minX;
      
      case AlignmentType.RIGHT:
        return bounds.maxX;
      
      case AlignmentType.TOP:
        return bounds.minY;
      
      case AlignmentType.BOTTOM:
        return bounds.maxY;
      
      case AlignmentType.CENTER_H:
        return bounds.minX + bounds.width / 2;
      
      case AlignmentType.CENTER_V:
        return bounds.minY + bounds.height / 2;
      
      default:
        throw new Error(`Unsupported alignment type: ${alignmentType}`);
    }
  }

  /**
   * 获取单个节点的对齐坐标
   * 
   * @param node - 节点
   * @param alignmentType - 对齐类型
   * @returns 对齐坐标
   */
  private static getNodeAlignmentCoordinate(
    node: CanvasNode,
    alignmentType: AlignmentType
  ): number {
    switch (alignmentType) {
      case AlignmentType.LEFT:
        return node.x;
      
      case AlignmentType.RIGHT:
        return node.x + node.width;
      
      case AlignmentType.TOP:
        return node.y;
      
      case AlignmentType.BOTTOM:
        return node.y + node.height;
      
      case AlignmentType.CENTER_H:
        return node.x + node.width / 2;
      
      case AlignmentType.CENTER_V:
        return node.y + node.height / 2;
      
      default:
        throw new Error(`Unsupported alignment type: ${alignmentType}`);
    }
  }

  /**
   * 计算节点的新位置
   * 
   * @param node - 节点
   * @param alignmentType - 对齐类型
   * @param alignmentLine - 基准线坐标
   * @returns 新位置坐标
   */
  private static calculateNewPosition(
    node: CanvasNode,
    alignmentType: AlignmentType,
    alignmentLine: number
  ): number {
    switch (alignmentType) {
      case AlignmentType.LEFT:
      case AlignmentType.TOP:
        return alignmentLine;
      
      case AlignmentType.RIGHT:
        return alignmentLine - node.width;
      
      case AlignmentType.BOTTOM:
        return alignmentLine - node.height;
      
      case AlignmentType.CENTER_H:
        return alignmentLine - node.width / 2;
      
      case AlignmentType.CENTER_V:
        return alignmentLine - node.height / 2;
      
      default:
        throw new Error(`Unsupported alignment type: ${alignmentType}`);
    }
  }

  /**
   * 检查节点是否需要位置更新
   * 
   * @param node - 节点
   * @param alignmentType - 对齐类型
   * @param newPosition - 新位置
   * @returns 是否需要更新
   */
  private static needsPositionUpdate(
    node: CanvasNode,
    alignmentType: AlignmentType,
    newPosition: number
  ): boolean {
    const currentPosition = this.isHorizontalAlignment(alignmentType) ? node.x : node.y;
    // 使用小的容差值避免浮点数精度问题
    return Math.abs(currentPosition - newPosition) > 0.001;
  }

  /**
   * 更新节点位置
   * 
   * @param node - 节点（会被直接修改）
   * @param alignmentType - 对齐类型
   * @param newPosition - 新位置
   */
  private static updateNodePosition(
    node: CanvasNode,
    alignmentType: AlignmentType,
    newPosition: number
  ): void {
    if (this.isHorizontalAlignment(alignmentType)) {
      node.x = Math.round(newPosition); // 舍入到整数像素
    } else {
      node.y = Math.round(newPosition);
    }
  }

  /**
   * 判断是否为水平对齐
   * 
   * @param alignmentType - 对齐类型
   * @returns 是否为水平对齐
   */
  private static isHorizontalAlignment(alignmentType: AlignmentType): boolean {
    return [
      AlignmentType.LEFT,
      AlignmentType.RIGHT,
      AlignmentType.CENTER_H
    ].includes(alignmentType);
  }

  /**
   * 执行边界检查，防止节点移出合理范围
   * 
   * @param nodes - 节点数组
   */
  private static performBoundaryCheck(nodes: CanvasNode[]): void {
    // 定义合理的画布边界（可根据实际需求调整）
    const CANVAS_BOUNDS = {
      minX: -10000,
      minY: -10000,
      maxX: 50000,
      maxY: 50000
    };

    nodes.forEach(node => {
      // 确保节点不会移出边界
      node.x = Math.max(CANVAS_BOUNDS.minX, Math.min(node.x, CANVAS_BOUNDS.maxX - node.width));
      node.y = Math.max(CANVAS_BOUNDS.minY, Math.min(node.y, CANVAS_BOUNDS.maxY - node.height));
    });
  }

  // ==================== 工具方法 ====================

  /**
   * 批量对齐：支持一次对多种类型进行对齐
   * 
   * @param nodes - 节点数组
   * @param alignmentTypes - 对齐类型数组
   * @param options - 对齐选项
   * @returns 对齐结果数组
   */
  public static batchAlign(
    nodes: CanvasNode[],
    alignmentTypes: AlignmentType[],
    options: AlignmentOptions = {}
  ): AlignmentResult[] {
    const results: AlignmentResult[] = [];
    let currentNodes = [...nodes];

    alignmentTypes.forEach(alignmentType => {
      const result = this.performAlignment(currentNodes, alignmentType, options);
      results.push(result);
      currentNodes = result.alignedNodes;
    });

    return results;
  }

  /**
   * 获取对齐预览：不实际修改节点，仅返回预览位置
   * 
   * @param nodes - 节点数组
   * @param alignmentType - 对齐类型
   * @param options - 对齐选项
   * @returns 预览位置映射表
   */
  public static getAlignmentPreview(
    nodes: CanvasNode[],
    alignmentType: AlignmentType,
    options: AlignmentOptions = {}
  ): Map<string, { x: number; y: number }> {
    const result = this.performAlignment(nodes, alignmentType, options);
    const preview = new Map<string, { x: number; y: number }>();

    result.alignedNodes.forEach(node => {
      preview.set(node.id, { x: node.x, y: node.y });
    });

    return preview;
  }

  /**
   * 验证节点数组是否适合对齐操作
   * 
   * @param nodes - 节点数组
   * @returns 验证结果
   */
  public static validateNodesForAlignment(nodes: CanvasNode[]): {
    isValid: boolean;
    reason?: string;
    validCount: number;
  } {
    if (!nodes || nodes.length === 0) {
      return {
        isValid: false,
        reason: '没有选中的节点',
        validCount: 0
      };
    }

    if (nodes.length < 2) {
      return {
        isValid: false,
        reason: '至少需要选择2个节点才能进行对齐',
        validCount: nodes.length
      };
    }

    // 检查节点是否有有效的位置和尺寸信息
    const validNodes = nodes.filter(node => 
      typeof node.x === 'number' &&
      typeof node.y === 'number' &&
      typeof node.width === 'number' &&
      typeof node.height === 'number' &&
      node.width > 0 &&
      node.height > 0
    );

    if (validNodes.length < 2) {
      return {
        isValid: false,
        reason: '至少需要2个具有有效位置和尺寸的节点',
        validCount: validNodes.length
      };
    }

    return {
      isValid: true,
      validCount: validNodes.length
    };
  }

  // ==================== 分布算法实现 ====================

  /**
   * 水平等距分布对齐
   * 保持第一个和最后一个节点位置不变，中间节点等距分布
   */
  static distributeHorizontally(nodes: CanvasNode[], options: AlignmentOptions = {}): AlignmentResult {
    // 开始水平等距分布对齐

    // 验证节点数量
    if (nodes.length < 3) {
      // 水平分布至少需要3个节点
      return {
        processedCount: nodes.length,
        movedCount: 0,
        alignedNodes: [...nodes],
        alignmentLine: 0
      };
    }

    const validationResult = NodeAlignmentService.validateNodesForAlignment(nodes);
    if (!validationResult.isValid) {
      // 节点验证失败
      return {
        processedCount: nodes.length,
        movedCount: 0,
        alignedNodes: [...nodes],
        alignmentLine: 0
      };
    }

    // 按x坐标排序节点（基于中心点）
    const sortedNodes = [...nodes].sort((a, b) => {
      const centerA = a.x + (a.width || 0) / 2;
      const centerB = b.x + (b.width || 0) / 2;
      return centerA - centerB;
    });

    // 计算第一个和最后一个节点的中心点
    const firstNode = sortedNodes[0];
    const lastNode = sortedNodes[sortedNodes.length - 1];
    const firstCenter = firstNode.x + (firstNode.width || 0) / 2;
    const lastCenter = lastNode.x + (lastNode.width || 0) / 2;

    // 计算总间距和每个间隔的距离
    const totalDistance = lastCenter - firstCenter;
    const gaps = sortedNodes.length - 1;
    const gapDistance = totalDistance / gaps;

    console.log(`📏 分布参数: 总距离=${totalDistance}, 间隔数=${gaps}, 单个间距=${gapDistance}`);

    // 对齐后的节点数组
    const alignedNodes = sortedNodes.map((node, index) => {
      if (index === 0 || index === sortedNodes.length - 1) {
        // 保持第一个和最后一个节点不变
        return { ...node };
      }

      // 计算新的中心位置
      const targetCenter = firstCenter + (gapDistance * index);
      const newX = targetCenter - (node.width || 0) / 2;

      console.log(`📍 节点${index}: 原始x=${node.x}, 新x=${newX}`);

      return {
        ...node,
        x: newX
      };
    });

    // 计算移动的节点数量
    const movedCount = alignedNodes.reduce((count, aligned, index) => {
      return Math.abs(aligned.x - sortedNodes[index].x) > 0.1 ? count + 1 : count;
    }, 0);

    // 对齐基准线为第一个和最后一个节点中心的y坐标平均值
    const alignmentLine = (firstNode.y + (firstNode.height || 0) / 2 + lastNode.y + (lastNode.height || 0) / 2) / 2;

    console.log(`✅ 水平分布完成: 移动了${movedCount}个节点`);

    return {
      processedCount: sortedNodes.length,
      movedCount,
      alignedNodes,
      alignmentLine
    };
  }

  /**
   * 垂直等距分布对齐
   * 保持第一个和最后一个节点位置不变，中间节点等距分布
   */
  static distributeVertically(nodes: CanvasNode[], options: AlignmentOptions = {}): AlignmentResult {
    console.log('🔄 开始垂直等距分布对齐:', nodes.length, '个节点');

    // 验证节点数量
    if (nodes.length < 3) {
      // 垂直分布至少需要3个节点
      return {
        processedCount: nodes.length,
        movedCount: 0,
        alignedNodes: [...nodes],
        alignmentLine: 0
      };
    }

    const validationResult = NodeAlignmentService.validateNodesForAlignment(nodes);
    if (!validationResult.isValid) {
      // 节点验证失败
      return {
        processedCount: nodes.length,
        movedCount: 0,
        alignedNodes: [...nodes],
        alignmentLine: 0
      };
    }

    // 按y坐标排序节点（基于中心点）
    const sortedNodes = [...nodes].sort((a, b) => {
      const centerA = a.y + (a.height || 0) / 2;
      const centerB = b.y + (b.height || 0) / 2;
      return centerA - centerB;
    });

    // 计算第一个和最后一个节点的中心点
    const firstNode = sortedNodes[0];
    const lastNode = sortedNodes[sortedNodes.length - 1];
    const firstCenter = firstNode.y + (firstNode.height || 0) / 2;
    const lastCenter = lastNode.y + (lastNode.height || 0) / 2;

    // 计算总间距和每个间隔的距离
    const totalDistance = lastCenter - firstCenter;
    const gaps = sortedNodes.length - 1;
    const gapDistance = totalDistance / gaps;

    console.log(`📏 分布参数: 总距离=${totalDistance}, 间隔数=${gaps}, 单个间距=${gapDistance}`);

    // 对齐后的节点数组
    const alignedNodes = sortedNodes.map((node, index) => {
      if (index === 0 || index === sortedNodes.length - 1) {
        // 保持第一个和最后一个节点不变
        return { ...node };
      }

      // 计算新的中心位置
      const targetCenter = firstCenter + (gapDistance * index);
      const newY = targetCenter - (node.height || 0) / 2;

      console.log(`📍 节点${index}: 原始y=${node.y}, 新y=${newY}`);

      return {
        ...node,
        y: newY
      };
    });

    // 计算移动的节点数量
    const movedCount = alignedNodes.reduce((count, aligned, index) => {
      return Math.abs(aligned.y - sortedNodes[index].y) > 0.1 ? count + 1 : count;
    }, 0);

    // 对齐基准线为第一个和最后一个节点中心的x坐标平均值
    const alignmentLine = (firstNode.x + (firstNode.width || 0) / 2 + lastNode.x + (lastNode.width || 0) / 2) / 2;

    console.log(`✅ 垂直分布完成: 移动了${movedCount}个节点`);

    return {
      processedCount: sortedNodes.length,
      movedCount,
      alignedNodes,
      alignmentLine
    };
  }
}

// ==================== 便捷函数导出 ====================

/**
 * 快速左对齐
 */
export const alignLeft = (nodes: CanvasNode[], options?: AlignmentOptions): AlignmentResult => 
  NodeAlignmentService.alignLeft(nodes, options);

/**
 * 快速右对齐
 */
export const alignRight = (nodes: CanvasNode[], options?: AlignmentOptions): AlignmentResult => 
  NodeAlignmentService.alignRight(nodes, options);

/**
 * 快速顶部对齐
 */
export const alignTop = (nodes: CanvasNode[], options?: AlignmentOptions): AlignmentResult => 
  NodeAlignmentService.alignTop(nodes, options);

/**
 * 快速底部对齐
 */
export const alignBottom = (nodes: CanvasNode[], options?: AlignmentOptions): AlignmentResult => 
  NodeAlignmentService.alignBottom(nodes, options);

/**
 * 快速水平居中
 */
export const alignCenterH = (nodes: CanvasNode[], options?: AlignmentOptions): AlignmentResult => 
  NodeAlignmentService.alignCenterH(nodes, options);

/**
 * 快速垂直居中
 */
export const alignCenterV = (nodes: CanvasNode[], options?: AlignmentOptions): AlignmentResult => 
  NodeAlignmentService.alignCenterV(nodes, options);

// ==================== 默认导出 ====================

export default NodeAlignmentService;

/**
 * 🎯 使用示例：
 * 
 * ```typescript
 * import { NodeAlignmentService, AlignmentType } from './canvas-node-alignment.service';
 * 
 * // 基础用法
 * const result = NodeAlignmentService.alignLeft(selectedNodes);
 * 
 * // 高级选项
 * const result2 = NodeAlignmentService.alignCenterH(selectedNodes, {
 *   alignTo: 'first',
 *   boundaryCheck: true
 * });
 * 
 * // 批量对齐
 * const results = NodeAlignmentService.batchAlign(selectedNodes, [
 *   AlignmentType.LEFT,
 *   AlignmentType.TOP
 * ]);
 * 
 * // 预览功能
 * const preview = NodeAlignmentService.getAlignmentPreview(nodes, AlignmentType.CENTER_H);
 * ```
 */