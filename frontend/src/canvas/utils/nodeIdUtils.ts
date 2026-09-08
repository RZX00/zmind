// 🆔 节点ID管理工具 - 语义化ID生成系统
// 生成语义化的节点ID: text-1, code-2, mermaid-3 等
// 生成语义化的连接ID: connection-1, connection-2 等

import type { Canvas, CanvasNode, NodeType } from '../../types/canvas';

// 🎯 扩展类型定义：支持节点和连接
export type EntityType = NodeType | 'connection';

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE62_BASE = BigInt(62);
const TIME_PART_LENGTH = 8;
const RAND_PART_LENGTH = 8;
const SHORT_ID_LENGTH = TIME_PART_LENGTH + RAND_PART_LENGTH;
// Canonical ID: 16-char Base62 (time + random). Legacy semantic IDs remain valid for compatibility.
const SHORT_ENTITY_ID_PATTERN = new RegExp(`^[0-9A-Za-z]{${SHORT_ID_LENGTH}}$`);
const LEGACY_UNIQUE_ENTITY_ID_PATTERN = /^[a-z][\w-]*_[a-z0-9]+_[a-z0-9]+$/i;
const RAND_MAX = BASE62_BASE ** BigInt(RAND_PART_LENGTH);
const RAND_BYTES = 6; // 48 bits covers 62^8

const encodeBase62 = (value: bigint): string => {
  if (value <= BigInt(0)) return '0';
  let v = value;
  let out = '';
  while (v > BigInt(0)) {
    const rem = v % BASE62_BASE;
    out = BASE62_ALPHABET[Number(rem)] + out;
    v = v / BASE62_BASE;
  }
  return out;
};

const padBase62 = (value: bigint, length: number): string => {
  let s = encodeBase62(value);
  if (s.length < length) {
    s = `${'0'.repeat(length - s.length)}${s}`;
  } else if (s.length > length) {
    s = s.slice(-length);
  }
  return s;
};

const getRandomBytes = (size: number): Uint8Array => {
  const globalCrypto: any = (globalThis as any)?.crypto;
  if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
    const arr = new Uint8Array(size);
    globalCrypto.getRandomValues(arr);
    return arr;
  }
  const fallback = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    fallback[i] = Math.floor(Math.random() * 256);
  }
  return fallback;
};

const buildShortEntityId = (): string => {
  const timePart = padBase62(BigInt(Date.now()), TIME_PART_LENGTH);
  let randPart = '';
  while (!randPart) {
    const bytes = getRandomBytes(RAND_BYTES);
    let value = BigInt(0);
    for (const b of bytes) {
      value = (value << BigInt(8)) + BigInt(b);
    }
    if (value < RAND_MAX) {
      randPart = padBase62(value, RAND_PART_LENGTH);
    }
  }
  return `${timePart}${randPart}`;
};

const isShortEntityId = (id: string): boolean => {
  return SHORT_ENTITY_ID_PATTERN.test(id);
};

const isUniqueEntityId = (id: string): boolean => {
  return LEGACY_UNIQUE_ENTITY_ID_PATTERN.test(id);
};

const parseUniqueEntityId = (id: string): { type: string; number: number } | null => {
  if (!isUniqueEntityId(id)) return null;
  const type = id.split('_')[0] || '';
  if (!type) return null;
  return { type, number: 0 };
};

const parseShortEntityId = (id: string): { type: string; number: number } | null => {
  if (!isShortEntityId(id)) return null;
  return { type: 'short', number: 0 };
};

/**
 * 节点和连接ID计数器管理
 * 为每个Canvas维护独立的计数器
 */
class NodeIdCounters {
  private canvasCounters = new Map<string, Map<EntityType, number>>();

  /**
   * 获取指定Canvas和实体类型的下一个计数值
   */
  getNext(canvasId: string, entityType: EntityType): number {
    if (!this.canvasCounters.has(canvasId)) {
      this.canvasCounters.set(canvasId, new Map());
    }

    const canvasCounters = this.canvasCounters.get(canvasId)!;
    const currentCount = canvasCounters.get(entityType) || 0;
    const nextCount = currentCount + 1;

    canvasCounters.set(entityType, nextCount);
    return nextCount;
  }

  /**
   * 重置指定Canvas的所有计数器（用于Canvas加载时重新统计）
   */
  reset(canvasId: string): void {
    this.canvasCounters.delete(canvasId);
  }

  /**
   * 根据现有节点和连接重新初始化计数器
   */
  initializeFromExistingEntities(
    canvasId: string,
    nodes: Array<{ id: string; type: NodeType }>,
    connections: Array<{ id: string }> = []
  ): void {
    const counters = new Map<EntityType, number>();
    const entityTypeCounts = new Map<EntityType, number>();

    // 统计节点类型总数
    for (const node of nodes) {
      entityTypeCounts.set(node.type, (entityTypeCounts.get(node.type) || 0) + 1);
    }

    // 统计连接总数
    if (connections.length > 0) {
      entityTypeCounts.set('connection', connections.length);
    }

    // 统计节点的语义化ID最大编号
    for (const node of nodes) {
      const match = node.id.match(/^(\w+)-(\d+)$/);
      if (match) {
        const [, typePrefix, numberStr] = match;
        const number = parseInt(numberStr, 10);

        // 匹配节点类型和ID前缀
        if (this.getEntityTypePrefix(node.type) === typePrefix) {
          const currentMax = counters.get(node.type) || 0;
          counters.set(node.type, Math.max(currentMax, number));
        }
      }
    }

    // 统计连接的语义化ID最大编号
    for (const connection of connections) {
      const match = connection.id.match(/^connection-(\d+)$/);
      if (match) {
        const [, numberStr] = match;
        const number = parseInt(numberStr, 10);
        const currentMax = counters.get('connection') || 0;
        counters.set('connection', Math.max(currentMax, number));
      }
    }

    // 对于没有语义化ID的实体类型，使用实体总数作为计数器起点
    for (const [entityType, totalCount] of entityTypeCounts) {
      const semanticMax = counters.get(entityType) || 0;
      counters.set(entityType, Math.max(semanticMax, totalCount));
    }

    this.canvasCounters.set(canvasId, counters);
  }

  /**
   * 【兼容性方法】根据现有节点重新初始化计数器
   */
  initializeFromExistingNodes(canvasId: string, nodes: Array<{ id: string; type: NodeType }>): void {
    this.initializeFromExistingEntities(canvasId, nodes, []);
  }

  /**
   * 获取实体类型对应的ID前缀（使用全局函数确保一致性）
   */
  private getEntityTypePrefix(entityType: EntityType): string {
    return getEntityTypePrefix(entityType);
  }
}

// 全局计数器实例
const nodeCounters = new NodeIdCounters();

/**
 * 生成语义化节点ID
 * @deprecated 请使用 NodeIds.generateNodeId() 替代
 * @param canvasId Canvas ID
 * @param nodeType 节点类型
 * @returns 语义化ID，如: text-1, code-2, mermaid-3
 */
export function generateSemanticNodeId(canvasId: string, nodeType: NodeType): string {
  const prefix = getNodeTypePrefix(nodeType);
  const counter = nodeCounters.getNext(canvasId, nodeType);
  return `${prefix}-${counter}`;
}

/**
 * 生成语义化连接ID
 * @deprecated 请使用 NodeIds.generateConnectionId() 替代
 * @param canvasId Canvas ID
 * @returns 语义化连接ID，如: connection-1, connection-2
 */
export function generateSemanticConnectionId(canvasId: string): string {
  const counter = nodeCounters.getNext(canvasId, 'connection');
  return `connection-${counter}`;
}

/**
 * 验证是否为语义化节点ID
 * @param id 待验证的ID
 * @returns 是否为有效的语义化节点ID
 */
export function isSemanticNodeId(id: string): boolean {
  // 匹配格式: 字母开头-数字
  const pattern = /^[a-z][\w]*-\d+$/;
  return pattern.test(id);
}

/**
 * 验证是否为语义化连接ID
 * @param id 待验证的ID
 * @returns 是否为有效的语义化连接ID
 */
export function isSemanticConnectionId(id: string): boolean {
  // 匹配格式: connection-数字
  const pattern = /^connection-\d+$/;
  return pattern.test(id);
}

/**
 * 验证是否为语义化实体ID（节点或连接）
 * @deprecated 请使用 NodeIds.validateId() 替代
 * @param id 待验证的ID
 * @returns 是否为有效的语义化实体ID
 */
export function isSemanticEntityId(id: string): boolean {
  return isSemanticNodeId(id) || isSemanticConnectionId(id);
}

/**
 * 从语义化ID提取节点类型和编号
 * @deprecated 请使用 NodeIds.parseId() 替代
 * @param id 语义化ID
 * @returns 节点类型和编号，或null（如果ID无效）
 */
export function parseSemanticNodeId(id: string): { type: string; number: number } | null {
  const match = id.match(/^([a-z][\w]*)-(\d+)$/);
  if (!match) return null;
  
  const [, type, numberStr] = match;
  const number = parseInt(numberStr, 10);
  
  return { type, number: isNaN(number) ? 0 : number };
}

/**
 * 获取节点类型对应的ID前缀
 */
export function getNodeTypePrefix(nodeType: NodeType): string {
  switch (nodeType) {
    case 'canvas-link':
      return 'link';
    default:
      return nodeType;
  }
}

/**
 * 获取实体类型对应的ID前缀（包括节点和连接）
 * @param entityType 实体类型
 * @returns ID前缀
 */
export function getEntityTypePrefix(entityType: EntityType): string {
  if (entityType === 'connection') {
    return 'connection';
  }
  return getNodeTypePrefix(entityType as NodeType);
}

/**
 * 重置Canvas的节点计数器（用于Canvas切换或重新加载）
 * @deprecated 请使用 NodeIds.cleanup() 替代
 * @param canvasId Canvas ID
 */
export function resetNodeCounters(canvasId: string): void {
  nodeCounters.reset(canvasId);
}

/**
 * 根据现有节点初始化计数器（用于Canvas加载时）
 * @deprecated 请使用 NodeIds.initialize() 替代
 * @param canvasId Canvas ID
 * @param nodes 现有节点列表
 */
export function initializeNodeCounters(canvasId: string, nodes: Array<{ id: string; type: NodeType }>): void {
  nodeCounters.initializeFromExistingNodes(canvasId, nodes);
}

/**
 * 语义化节点ID管理器
 */
export class SemanticNodeIdManager {
  /**
   * 生成新的语义化节点ID
   */
  static generate(canvasId: string, nodeType: NodeType): string {
    return generateSemanticNodeId(canvasId, nodeType);
  }

  /**
   * 验证语义化节点ID
   */
  static validate(id: string): boolean {
    return isSemanticNodeId(id);
  }

  /**
   * 解析语义化节点ID
   */
  static parse(id: string): { type: string; number: number } | null {
    return parseSemanticNodeId(id);
  }

  /**
   * 重置Canvas计数器
   */
  static reset(canvasId: string): void {
    resetNodeCounters(canvasId);
  }

  /**
   * 初始化Canvas计数器
   */
  static initialize(canvasId: string, nodes: Array<{ id: string; type: NodeType }>): void {
    initializeNodeCounters(canvasId, nodes);
  }
}

// 🎯 统一API接口定义
export interface NodeIdAPI {
  /**
   * 生成节点ID
   * @param canvasId Canvas ID
   * @param nodeType 节点类型
   * @returns 语义化节点ID
   */
  generateNodeId(canvasId: string | undefined, nodeType: NodeType): string;

  /**
   * 生成连接ID
   * @param canvasId Canvas ID
   * @returns 语义化连接ID
   */
  generateConnectionId(canvasId?: string): string;

  /**
   * 验证实体ID（节点或连接）
   * @param id 待验证的ID
   * @returns 是否为有效的语义化ID
   */
  validateId(id: string): boolean;

  /**
   * 解析语义化ID
   * @param id 语义化ID
   * @returns 解析结果或null
   */
  parseId(id: string): { type: string; number: number } | null;

  /**
   * 清理Canvas计数器
   * @param canvasId Canvas ID
   */
  cleanup(canvasId: string): void;

  /**
   * 初始化Canvas计数器
   * @param canvasId Canvas ID
   * @param nodes 现有节点列表
   * @param connections 现有连接列表（可选）
   */
  initialize(
    canvasId: string,
    nodes: Array<{ id: string; type: NodeType }>,
    connections?: Array<{ id: string }>
  ): void;
}

/**
 * 🎯 统一的ID管理API - 推荐使用此接口
 *
 * 使用示例:
 * ```typescript
 * // 生成节点ID
 * const nodeId = NodeIds.generateNodeId(canvasId, 'text');
 *
 * // 生成连接ID
 * const connectionId = NodeIds.generateConnectionId(canvasId);
 *
 * // 验证ID
 * const isValid = NodeIds.validateId(someId);
 *
 * // 解析ID
 * const parsed = NodeIds.parseId(nodeId);
 *
 * // 初始化计数器
 * NodeIds.initialize(canvasId, nodes, connections);
 *
 * // 清理计数器
 * NodeIds.cleanup(canvasId);
 * ```
 */
export const NodeIds: NodeIdAPI = {
  generateNodeId: (_canvasId: string | undefined, _nodeType: NodeType) =>
    buildShortEntityId(),

  generateConnectionId: (_canvasId?: string) =>
    buildShortEntityId(),

  validateId: (id: string) =>
    isSemanticEntityId(id) || isUniqueEntityId(id) || isShortEntityId(id),

  parseId: (id: string) =>
    parseSemanticNodeId(id) || parseUniqueEntityId(id) || parseShortEntityId(id),

  cleanup: (canvasId: string) =>
    resetNodeCounters(canvasId),

  initialize: (
    canvasId: string,
    nodes: Array<{ id: string; type: NodeType }>,
    connections: Array<{ id: string }> = []
  ) => {
    nodeCounters.initializeFromExistingEntities(canvasId, nodes, connections);
  }
};

// 🎯 导出默认方法（兼容性保持）
/**
 * @deprecated 请使用 NodeIds 统一接口
 */
const nodeIdUtils = {
  generate: generateSemanticNodeId,
  validate: isSemanticNodeId,
  parse: parseSemanticNodeId,
  reset: resetNodeCounters,
  initialize: initializeNodeCounters,
  getPrefix: getNodeTypePrefix
};

export default nodeIdUtils;
