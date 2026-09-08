/**
 * Group Data Processing Service
 *
 * Unified processing of group-related data calculations, eliminating duplicate logic
 * Provides high-performance group boundary calculation, depth calculation, node indexing and other functions
 *
 * Design Principles:
 * - Single Responsibility: Focus on group data processing
 * - High Performance: Use caching and index optimization
 * - Pure Functions: No side effects, easy to test
 * - Type Safety: Complete TypeScript support
 */

import type { Canvas, CanvasNode, CanvasConnection, GroupBounds } from '../types/canvas';
import { sampleConnectionPoints } from '../utils/connectionGeometry';
import { calculateGroupBounds } from '../components/core/systems/CoordinateSystem';
import {
  isGroupNode,
  isMindmapGroup,
  createNodeIndex,
  createGroupIndex,
  safeStringArray,
  getDefaultGroupColor,
  getMaxDepth,
  getHiddenMindmapNodesForGroup,
} from '../utils/groupUtils';
import {
  safeExecute,
  requireNonNull,
  validateOrThrow,
  ErrorCode,
  GroupError
} from '../utils/errorHandling';

/**
 * Group node interface (for type guards)
 */
export interface GroupNode extends CanvasNode {
  type: 'group';
  children?: string[];
  parentGroupId?: string;
  accentColor?: string;
  groupStyles?: {
    bgOpacity?: number;
  };
  mindmap?: {
    rootId: string;
    spacingX: number;
    spacingY: number;
    showCrossLinks?: boolean;
    orientation?: 'right';
    collapsed?: Record<string, boolean>;
    siblingOrder?: Record<string, string[]>;
  };
  groupMode?: 'mindmap' | 'normal';
}

/**
 * Processed group data
 */
export interface ProcessedGroupData {
  id: string;
  node: GroupNode;
  bounds: GroupBounds;
  depth: number;
  color: string;
  opacity: number;
  leafNodes: CanvasNode[];
  childCount: number;
  isMindmap: boolean;
}

/**
 * Group data processor cache
 */
interface GroupDataCache {
  canvas: Canvas;
  nodeIndex: Map<string, CanvasNode>;
  groupIndex: Map<string, GroupNode>;
  depthCache: Map<string, number>;
  leafNodesCache: Map<string, CanvasNode[]>;
  processedGroups: ProcessedGroupData[];
  lastUpdated: number;
}

/**
 * Group Data Processor Class
 *
 * Provides unified group data processing interface, optimizes performance and eliminates duplicate code
 */
export class GroupDataProcessor {
  private cache: GroupDataCache | null = null;
  private readonly CACHE_TIMEOUT = 100; // 100ms cache timeout

  /**
   * Type guard: Check if node is a group node (using utility function)
   */
  static isGroupNode(node: CanvasNode): node is GroupNode {
    return isGroupNode(node);
  }

  /**
   * Type guard: Check if group is a mindmap group (using utility function)
   */
  static isMindmapGroup(group: GroupNode): boolean {
    return isMindmapGroup(group);
  }

  /**
   * Process canvas data and return complete information for all groups
   *
   * @param canvas - Canvas data
   * @param forceRefresh - Whether to force cache refresh
   * @returns Array of processed group data
   */
  processCanvas(canvas: Canvas, forceRefresh: boolean = false): ProcessedGroupData[] {
    return safeExecute(
      () => this._processCanvasInternal(canvas, forceRefresh),
      {
        logLevel: 'error',
        fallbackValue: [],
        context: { method: 'processCanvas' }
      }
    ) || [];
  }

  /**
   * Internal processing method (actual implementation)
   */
  private _processCanvasInternal(canvas: Canvas, forceRefresh: boolean = false): ProcessedGroupData[] {
    // 🛡️ 参数验证
    requireNonNull(canvas, 'canvas', { method: 'processCanvas' });
    validateOrThrow(
      Array.isArray(canvas.nodes),
      'canvas.nodes must be an array',
      { method: 'processCanvas' }
    );
    // 🎯 检查缓存有效性
    const now = Date.now();
    if (!forceRefresh && this.cache &&
        this.cache.canvas === canvas &&
        (now - this.cache.lastUpdated) < this.CACHE_TIMEOUT) {
      return this.cache.processedGroups;
    }

    // 🏗️ 构建新缓存
    this.cache = this.buildCache(canvas);
    this.cache.lastUpdated = now;

    return this.cache.processedGroups;
  }

  /**
   * 🏗️ 构建群组数据缓存
   *
   * @param canvas - 画布数据
   * @returns 构建的缓存对象
   */
  private buildCache(canvas: Canvas): GroupDataCache {
    // 🎯 使用工具函数构建索引
    const nodeIndex = createNodeIndex(canvas.nodes || []);
    const groupIndex = createGroupIndex(canvas.nodes || []) as Map<string, GroupNode>;

    // 🎯 初始化缓存对象
    const cache: GroupDataCache = {
      canvas,
      nodeIndex,
      groupIndex,
      depthCache: new Map(),
      leafNodesCache: new Map(),
      processedGroups: [],
      lastUpdated: 0
    };

    // 🎯 处理所有群组
    const processedGroups: ProcessedGroupData[] = [];

    for (const [groupId, groupNode] of Array.from(groupIndex.entries())) {
      try {
        const leafNodes = this.getDescendantLeafNodes(groupId, cache);

        // 🛡️ 跳过没有叶子节点的群组
        if (leafNodes.length === 0) {
          continue;
        }

        // 🛡️ 安全计算群组边界（基础：仅叶子节点）
        let bounds = safeExecute(
          () => calculateGroupBounds(leafNodes),
          {
            logLevel: 'warn',
            context: { groupId, leafNodeCount: leafNodes.length },
            throwOnError: true
          }
        );

        // ➕ 扩展：如果该组附加了连线（attachedConnections），将连线的几何范围也合并进来
        try {
          const attached = (groupNode as any).attachedConnections as string[] | undefined;
          const allConns = (canvas.connections || []) as CanvasConnection[];
          if (bounds && attached && attached.length > 0 && allConns.length > 0) {
            const connById = new Map<string, CanvasConnection>();
            for (const c of allConns) connById.set(c.id, c);

            const extendByPoints = (pts: Array<{ x: number; y: number }>) => {
              if (!pts || pts.length === 0) return;
              let minX = bounds!.minX, minY = bounds!.minY, maxX = bounds!.maxX, maxY = bounds!.maxY;
              for (const p of pts) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
              }
              bounds = {
                x: minX,
                y: minY,
                width: Math.max(0, maxX - minX),
                height: Math.max(0, maxY - minY),
                minX,
                minY,
                maxX,
                maxY,
              } as any;
            };

            for (const cid of attached) {
              const conn = connById.get(cid);
              if (!conn) continue;
              try {
                const pts = sampleConnectionPoints(conn, nodeIndex);
                if (pts.length > 0) extendByPoints(pts);
              } catch {}
            }
          }
        } catch {}

        if (!bounds) {
          console.warn(`GroupDataProcessor: Skip group ${groupId}, bounds calculation failed`);
          continue;
        }

        const depth = this.getGroupDepth(groupId, cache);
        const isMindmap = GroupDataProcessor.isMindmapGroup(groupNode);
        const defaultColor = getDefaultGroupColor(isMindmap);
        const color = groupNode.accentColor || defaultColor;
        const opacity = groupNode.groupStyles?.bgOpacity ?? 0.06;
        const childCount = safeStringArray(groupNode.children).length;

        processedGroups.push({
          id: groupId,
          node: groupNode,
          bounds,
          depth,
          color,
          opacity,
          leafNodes,
          childCount,
          isMindmap
        });
      } catch (error) {
        console.warn(`GroupDataProcessor: Process group ${groupId} failed:`, error);
      }
    }

    // Sort by depth (parent groups first, child groups last)
    processedGroups.sort((a, b) => a.depth - b.depth);

    cache.processedGroups = processedGroups;
    return cache;
  }

  /**
   * 🎯 获取群组深度（支持缓存）
   *
   * @param groupId - 群组ID
   * @param cache - 缓存对象
   * @returns 群组深度
   */
  private getGroupDepth(groupId: string, cache: GroupDataCache): number {
    // 🎯 检查缓存
    if (cache.depthCache.has(groupId)) {
      return cache.depthCache.get(groupId)!;
    }

    const group = cache.groupIndex.get(groupId);
    const depth = group?.parentGroupId
      ? this.getGroupDepth(group.parentGroupId, cache) + 1
      : 0;

    // 🎯 更新缓存
    cache.depthCache.set(groupId, depth);
    return depth;
  }

  /**
   * 🎯 获取群组的所有叶子节点（支持缓存）
   *
   * @param groupId - 群组ID
   * @param cache - 缓存对象
   * @returns 叶子节点数组
   */
  private getDescendantLeafNodes(groupId: string, cache: GroupDataCache): CanvasNode[] {
    // 🎯 检查缓存
    if (cache.leafNodesCache.has(groupId)) {
      return cache.leafNodesCache.get(groupId)!;
    }

    const group = cache.groupIndex.get(groupId);
    if (!group) {
      cache.leafNodesCache.set(groupId, []);
      return [];
    }

    let leafNodes: CanvasNode[] = [];
    const stack: string[] = [...safeStringArray(group.children)];

    while (stack.length > 0) {
      const nodeId = stack.pop()!;
      const childGroup = cache.groupIndex.get(nodeId);

      if (childGroup) {
        // 🎯 如果是子群组，展开其子节点
        const childChildren = safeStringArray(childGroup.children);
        stack.push(...childChildren);
      } else {
        // 🎯 如果是普通节点，添加到叶子节点列表
        const node = cache.nodeIndex.get(nodeId);
        if (node && !isGroupNode(node)) {
          leafNodes.push(node);
        }
      }
    }

    // 思维导图：按折叠状态过滤隐藏成员
    try {
      const group = cache.groupIndex.get(groupId);
      if (group && isMindmapGroup(group)) {
        const hidden = getHiddenMindmapNodesForGroup(cache.canvas, groupId);
        if (hidden && hidden.size > 0) {
          leafNodes = leafNodes.filter(n => !hidden.has(n.id));
        }
        // 兜底：若全部被过滤掉，至少包含 rootId（若存在）
        if (leafNodes.length === 0) {
          const rootId = (group.mindmap as any)?.rootId as string | undefined;
          if (rootId) {
            const rootNode = cache.nodeIndex.get(rootId);
            if (rootNode && !isGroupNode(rootNode)) {
              leafNodes = [rootNode];
            }
          }
        }
      }
    } catch {}

    // 🎯 更新缓存
    cache.leafNodesCache.set(groupId, leafNodes);
    return leafNodes;
  }

  /**
   * 🎯 获取最大群组深度（使用工具函数）
   *
   * @param processedGroups - 处理后的群组数据
   * @returns 最大深度
   */
  static getMaxDepth(processedGroups: ProcessedGroupData[]): number {
    return getMaxDepth(processedGroups);
  }

  /**
   * 🎯 根据ID获取处理后的群组数据
   *
   * @param groupId - 群组ID
   * @param processedGroups - 处理后的群组数据
   * @returns 群组数据或null
   */
  static getProcessedGroup(
    groupId: string,
    processedGroups: ProcessedGroupData[]
  ): ProcessedGroupData | null {
    return processedGroups.find(g => g.id === groupId) || null;
  }

  /**
   * 🎯 过滤特定类型的群组
   *
   * @param processedGroups - 处理后的群组数据
   * @param isMindmap - 是否为思维导图群组
   * @returns 过滤后的群组数据
   */
  static filterGroups(
    processedGroups: ProcessedGroupData[],
    isMindmap: boolean
  ): ProcessedGroupData[] {
    return processedGroups.filter(g => g.isMindmap === isMindmap);
  }

  /**
   * Calculate group bounds including label height (SAFE VERSION)
   *
   * @param leafNodes - Leaf nodes in the group
   * @param depth - Group depth level
   * @param maxDepth - Maximum depth across all groups
   * @returns Group bounds including label space
   */
  private calculateGroupBoundsWithLabel(
    leafNodes: CanvasNode[],
    depth: number,
    maxDepth: number
  ): GroupBounds {
    // 🛡️ Safety checks
    if (!leafNodes || leafNodes.length === 0) {
      throw new Error('No leaf nodes provided for bounds calculation');
    }

    if (typeof depth !== 'number' || depth < 0) {
      console.warn('Invalid depth provided, using 0:', depth);
      depth = 0;
    }

    if (typeof maxDepth !== 'number' || maxDepth < 0) {
      console.warn('Invalid maxDepth provided, using depth:', maxDepth);
      maxDepth = depth;
    }

    // Get base bounds from leaf nodes
    const baseBounds = calculateGroupBounds(leafNodes);

    // 🛡️ Validate base bounds
    if (!baseBounds || baseBounds.width < 0 || baseBounds.height < 0) {
      throw new Error('Invalid base bounds calculated');
    }

    // Label configuration
    const LABEL_HEIGHT = 28; // Height needed for label (matching top: -28 in GroupOverlays)
    const BASE_EXTENSION = 8;
    const STEP_EXTENSION = 6;

    // Calculate layer extension for visual hierarchy
    const layerExtension = Math.max(0, BASE_EXTENSION + (maxDepth - depth) * STEP_EXTENSION);

    // Calculate final extensions
    const horizontalExtension = Math.max(layerExtension, 4); // Minimum 4px for border
    const topExtension = Math.max(layerExtension, LABEL_HEIGHT); // Ensure label fits
    const bottomExtension = layerExtension;

    // 🛡️ Final bounds with validation
    const result = {
      x: baseBounds.x - horizontalExtension,
      y: baseBounds.y - topExtension, // Extended upward to include label
      width: baseBounds.width + 2 * horizontalExtension,
      height: baseBounds.height + topExtension + bottomExtension,
      minX: baseBounds.minX - horizontalExtension,
      minY: baseBounds.minY - topExtension,
      maxX: baseBounds.maxX + horizontalExtension,
      maxY: baseBounds.maxY + bottomExtension
    };

    // 🛡️ Validate result bounds
    if (result.width < 0 || result.height < 0) {
      console.error('Calculated invalid bounds:', result);
      return baseBounds; // Fallback to base bounds
    }

    return result;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * 📊 获取缓存统计信息（调试用）
   */
  getCacheStats(): object | null {
    if (!this.cache) return null;

    return {
      nodeCount: this.cache.nodeIndex.size,
      groupCount: this.cache.groupIndex.size,
      depthCacheSize: this.cache.depthCache.size,
      leafNodesCacheSize: this.cache.leafNodesCache.size,
      processedGroupsCount: this.cache.processedGroups.length,
      cacheAge: Date.now() - this.cache.lastUpdated
    };
  }
}

// 🎯 导出单例实例供全局使用
export const groupDataProcessor = new GroupDataProcessor();

// 🎯 导出工具函数以供其他模块使用
export { getMaxDepth } from '../utils/groupUtils';
