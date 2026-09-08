/**
 * 🛠️ 群组相关通用工具函数
 *
 * 提供群组操作的通用工具函数，避免在组件中重复实现
 * 包含深度计算、边界检测、数据过滤等常用功能
 */

import type { Canvas, CanvasNode } from '../../types/canvas';

// 🎨 Morandi palette for groups (low saturation, soft tones)
// Order matters; used for rotating accent colors on creation
export const MORANDI_GROUP_PALETTE: string[] = [
  '#8DA8B8', // soft slate blue
  '#7FAFA2', // sea salt green
  '#9DBA7A', // olive sage
  '#C5A77F', // sand gold
  '#C4907D', // terracotta rose
  '#A493C7', // soft violet
  '#7FA4C8', // steel blue
  '#78B7C4', // sea mist
  '#96B99D', // sage green
  '#C7A37F', // camel tan
  '#B88598', // dusty rose
  '#89A7B2', // muted tide blue
];

export function getRotatingGroupColorByIndex(index: number): string {
  if (!MORANDI_GROUP_PALETTE.length) return '#B7B7A4';
  const i = Math.max(0, Math.floor(index)) % MORANDI_GROUP_PALETTE.length;
  return MORANDI_GROUP_PALETTE[i];
}

/**
 * 获取数组中对象的最大深度值
 * 兼容原GroupBackgrounds中的overlaysMaxDepth函数
 *
 * @param items - 包含depth属性的对象数组
 * @returns 最大深度值
 */
export function getMaxDepth(items: Array<{ depth: number }>): number {
  if (!items || items.length === 0) return 0;
  return Math.max(...items.map(item => item.depth));
}

/**
 * 计算群组层级的外扩距离
 * 根据群组深度和最大深度计算外扩距离，用于分层显示
 *
 * @param currentDepth - 当前群组深度
 * @param maxDepth - 最大群组深度
 * @param baseExtension - 基础外扩距离，默认8px
 * @param stepExtension - 每层递增距离，默认6px
 * @returns 外扩距离
 */
export function calculateLayerExtension(
  currentDepth: number,
  maxDepth: number,
  baseExtension: number = 8,
  stepExtension: number = 6
): number {
  return baseExtension + (maxDepth - currentDepth) * stepExtension;
}

/**
 * 检查节点是否为群组节点
 *
 * @param node - 待检查的节点
 * @returns 是否为群组节点
 */
export function isGroupNode(node: CanvasNode): boolean {
  return node.type === 'group';
}

/**
 * 检查群组是否为思维导图模式
 *
 * @param node - 群组节点
 * @returns 是否为思维导图群组
 */
export function isMindmapGroup(node: CanvasNode): boolean {
  if (!isGroupNode(node)) return false;
  return node.groupMode === 'mindmap' && !!node.mindmap;
}

/**
 * 从节点数组中过滤出群组节点
 *
 * @param nodes - 节点数组
 * @returns 群组节点数组
 */
export function filterGroupNodes(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.filter(isGroupNode);
}

/**
 * 从节点数组中过滤出非群组节点（叶子节点）
 *
 * @param nodes - 节点数组
 * @returns 非群组节点数组
 */
export function filterLeafNodes(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.filter(node => !isGroupNode(node));
}

/**
 * 根据ID集合过滤节点
 *
 * @param nodes - 节点数组
 * @param ids - ID集合
 * @returns 过滤后的节点数组
 */
export function filterNodesByIds(nodes: CanvasNode[], ids: Set<string> | string[]): CanvasNode[] {
  const idSet = ids instanceof Set ? ids : new Set(ids);
  return nodes.filter(node => idSet.has(node.id));
}

/**
 * 创建节点ID到节点的映射表
 * 用于快速查找节点，避免O(n)的查找复杂度
 *
 * @param nodes - 节点数组
 * @returns 节点映射表
 */
export function createNodeIndex(nodes: CanvasNode[]): Map<string, CanvasNode> {
  return new Map(nodes.map(node => [node.id, node]));
}

/**
 * 创建群组ID到群组的映射表
 *
 * @param nodes - 节点数组
 * @returns 群组映射表
 */
export function createGroupIndex(nodes: CanvasNode[]): Map<string, CanvasNode> {
  const groups = filterGroupNodes(nodes);
  return new Map(groups.map(group => [group.id, group]));
}

/**
 * 安全的数组访问
 * 确保数组存在且不为空
 *
 * @param arr - 可能为undefined的数组
 * @param defaultValue - 默认值
 * @returns 安全的数组
 */
export function safeArray<T>(arr: T[] | undefined, defaultValue: T[] = []): T[] {
  return arr || defaultValue;
}

/**
 * 安全的字符串数组访问
 * 专门用于children字段等字符串数组
 *
 * @param arr - 可能为undefined的字符串数组
 * @returns 安全的字符串数组
 */
export function safeStringArray(arr: string[] | undefined): string[] {
  return safeArray(arr, []);
}

/**
 * 检查两个节点数组是否包含相同的节点ID
 * 用于判断群组成员是否发生变化
 *
 * @param nodes1 - 第一个节点数组
 * @param nodes2 - 第二个节点数组
 * @returns 是否包含相同的节点ID
 */
export function hasSameNodeIds(nodes1: CanvasNode[], nodes2: CanvasNode[]): boolean {
  if (nodes1.length !== nodes2.length) return false;

  const ids1 = new Set(nodes1.map(n => n.id));
  const ids2 = new Set(nodes2.map(n => n.id));

  if (ids1.size !== ids2.size) return false;

  for (const id of ids1) {
    if (!ids2.has(id)) return false;
  }

  return true;
}

/**
 * 获取群组的默认颜色
 * 根据群组类型返回不同的默认颜色
 *
 * @param isMindmap - 是否为思维导图群组
 * @returns 默认颜色
 */
export function getDefaultGroupColor(_isMindmap: boolean): string {
  // 使用莫兰迪色板的首个颜色作为默认值（无强制区分思维导图/普通）
  return getRotatingGroupColorByIndex(0);
}

/**
 * 计算指定思维导图群组在当前折叠状态下需要隐藏的节点ID集合。
 * 规则：对 mindmap.collapsed=true 的节点，隐藏该节点的所有后代（不隐藏自身）。
 * 返回 Set<string>，仅包含群组成员中的节点ID。
 */
export function getHiddenMindmapNodesForGroup(canvas: Canvas, groupId: string): Set<string> {
  const hidden = new Set<string>();
  if (!canvas || !Array.isArray(canvas.nodes)) return hidden;

  const group = canvas.nodes.find(n => n.id === groupId && (n as any).type === 'group') as CanvasNode | undefined;
  if (!group || !(group as any).mindmap) return hidden;

  const members = new Set<string>(safeStringArray((group as any).children));
  if (members.size === 0) return hidden;

  // 构建成员内的 from->to 映射
  const edges = (canvas.connections || []).filter(e => members.has(e.from) && members.has(e.to));
  const fromMap = new Map<string, string[]>();
  for (const e of edges) {
    if (!fromMap.has(e.from)) fromMap.set(e.from, []);
    fromMap.get(e.from)!.push(e.to);
  }

  const collapsed: Record<string, boolean> = (((group as any).mindmap?.collapsed) || {}) as any;
  const roots = Object.keys(collapsed).filter(id => collapsed[id]);
  for (const rid of roots) {
    // BFS 从折叠根的子节点开始（不包含自身）
    const q = [...(fromMap.get(rid) || [])];
    const seen = new Set<string>();
    while (q.length) {
      const u = q.shift()!;
      if (seen.has(u)) continue;
      seen.add(u);
      if (members.has(u)) hidden.add(u);
      const nexts = fromMap.get(u) || [];
      for (const v of nexts) {
        if (!seen.has(v)) q.push(v);
      }
    }
  }

  return hidden;
}

/**
 * 计算群组成员数量（递归计算）
 * 包含直接成员和嵌套群组中的成员
 *
 * @param groupNode - 群组节点
 * @param nodeIndex - 节点索引
 * @param groupIndex - 群组索引
 * @returns 成员总数
 */
export function calculateGroupMemberCount(
  groupNode: CanvasNode,
  nodeIndex: Map<string, CanvasNode>,
  groupIndex: Map<string, CanvasNode>
): number {
  if (!isGroupNode(groupNode)) return 0;

  let count = 0;
  const children = safeStringArray(groupNode.children);
  const stack = [...children];

  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    const childGroup = groupIndex.get(nodeId);

    if (childGroup) {
      // 如果是子群组，展开其子节点
      const grandChildren = safeStringArray(childGroup.children);
      stack.push(...grandChildren);
    } else {
      // 如果是普通节点，计数
      const node = nodeIndex.get(nodeId);
      if (node && !isGroupNode(node)) {
        count++;
      }
    }
  }

  return count;
}

/**
 * 验证群组数据的完整性
 * 检查群组是否有有效的子节点
 *
 * @param groupNode - 群组节点
 * @param nodeIndex - 节点索引
 * @returns 是否有效
 */
export function validateGroupIntegrity(
  groupNode: CanvasNode,
  nodeIndex: Map<string, CanvasNode>
): boolean {
  if (!isGroupNode(groupNode)) return false;

  const children = safeStringArray(groupNode.children);
  if (children.length === 0) return false;

  // 检查是否至少有一个有效的子节点
  return children.some(childId => nodeIndex.has(childId));
}

/**
 * 清理群组的无效子节点引用
 * 移除不存在的节点ID
 *
 * @param groupNode - 群组节点
 * @param nodeIndex - 节点索引
 * @returns 清理后的子节点ID数组
 */
export function cleanGroupChildren(
  groupNode: CanvasNode,
  nodeIndex: Map<string, CanvasNode>
): string[] {
  if (!isGroupNode(groupNode)) return [];

  const children = safeStringArray(groupNode.children);
  return children.filter(childId => nodeIndex.has(childId));
}
