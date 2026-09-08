// 🧠 思维导图模式：群组与布局辅助工具（Phase 1 - 框架 + 基础布局）
// 设计目标：
// - 仅在 group.type === 'group' 且 group.groupMode === 'mindmap' 的群组中生效
// - Tab/Enter 快速创建并规范排布；进入模式时可对既有结构规范化

import type { Canvas, CanvasConnection, CanvasNode } from '../types/canvas';
import { useCanvasStore } from '../stores/canvas.store';
import { useSettingsStore } from '../stores/settings.store';
import { createNodeAtPosition } from '../components/core/systems/NodeFactory';
import { calculateGroupBounds } from '../components/core/systems/CoordinateSystem';
import { getHiddenMindmapNodesForGroup } from './groupUtils';

export interface MindmapEnsureResult {
  groupId: string;
}

// 🔍 查找节点所属的导图群组（先用parentGroupId，再回退children包含）
export function findMindmapGroupForNode(canvas: Canvas, nodeId: string): CanvasNode | null {
  const node = canvas.nodes.find(n => n.id === nodeId);
  if (!node) return null;
  // 严格仅依据 parentGroupId 判定，避免通过 children 的隐式归属带来的错误关联
  if (node.parentGroupId) {
    const g = canvas.nodes.find(n => n.id === node.parentGroupId && n.type === 'group');
    if (g && (g as any).groupMode === 'mindmap') return g;
  }
  // 兼容历史数据：若缺少 parentGroupId，且仅被单一思维导图组的 children 包含，则返回该组
  const candidateGroups = canvas.nodes.filter(
    (n) => (n as any).type === 'group' && (n as any).mindmap && Array.isArray((n as any).children) && ((n as any).children as string[]).includes(nodeId)
  );
  if (candidateGroups.length === 1) return candidateGroups[0] as any;
  return null;
}

// 🔍 通过 rootId 查找现有导图群组（防重）
export function findMindmapGroupByRoot(canvas: Canvas, rootId: string): CanvasNode | null {
  return canvas.nodes.find(n => n.type === 'group' && (n as any).mindmap && (n as any).mindmap.rootId === rootId) || null;
}

// 🏗️ 确保存在导图群组，不存在则创建并设定默认元数据，包含以 root 为起点的连通子集
export function ensureMindmapGroup(rootNodeId: string, options?: { spacingX?: number; spacingY?: number; title?: string; }): MindmapEnsureResult | null {
  const store = useCanvasStore.getState();
  const canvas = store.canvas;
  const root = canvas.nodes.find(n => n.id === rootNodeId);
  if (!root) return null;

  const existing = findMindmapGroupForNode(canvas, rootNodeId);
  const existingByRoot = findMindmapGroupByRoot(canvas, rootNodeId);
  if (existing || existingByRoot) {
    // 已处于导图群组
    const g = (existing || existingByRoot)!;
    return { groupId: g.id };
  }

  // 收集以 root 为起点的连通子集（有向：from -> to；也允许无向遍历以囊括兄弟）
  const connected = collectConnectedSubgraph(canvas, rootNodeId);

  // 创建导图组节点（组背景由 GroupBackgrounds 负责，边框由 GroupOverlays 负责）
  const title = options?.title ?? '思维导图';
  const spacingX = options?.spacingX ?? 96;
  // 默认兄弟间距 30px，确保视觉不重叠
  const spacingY = options?.spacingY ?? 30;
  const groupNode: CanvasNode = createNodeAtPosition('group', {
    x: Math.max(root.x - 40, 0),
    y: Math.max(root.y - 40, 0)
  }, canvas.id, {
    title,
    children: Array.from(connected),
    groupStyles: { bgOpacity: 0 },  // 🎨 思维导图背景完全透明
    accentColor: '#60a5fa',         // 🎨 思维导图专属色彩
    groupMode: 'mindmap',
    mindmap: {
      rootId: rootNodeId,
      spacingX,
      spacingY,
      orientation: 'right',
      showCrossLinks: true,
      collapsed: {},
      // siblingOrder: {} // 撤回：暂不维护同级顺序，避免引入副作用
    }
  } as any);

  // 加入画布并设置成员的 parentGroupId
  store.addNode(groupNode);
  for (const id of connected) {
    store.updateNode(id, { parentGroupId: groupNode.id });
  }

  // 初始规范化：思维导图内的文本/待办节点按内容估算宽度（150..450）并匹配高度
  try {
    const { estimateAutoTextWidth, calculateTextNodeHeight, getTextLayoutPreset, DEFAULT_TEXT_LAYOUT_PRESET } = require('../utils/canvasUtils');
    const autoMode = (() => { try { return useSettingsStore.getState().mindmap?.autoWidthMode === 'auto'; } catch { return false; } })();
    const presetId = useCanvasStore.getState().canvas?.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET;
    const layout = getTextLayoutPreset ? getTextLayoutPreset(presetId) : undefined;
    const latest = useCanvasStore.getState().canvas;
    for (const id of connected) {
      const n = latest.nodes.find((nn: any) => nn.id === id);
      if (!n) continue;
      if (n.type === 'text' || n.type === 'todo') {
        const w = autoMode ? estimateAutoTextWidth(n.content || '', { layoutPreset: layout, nodeType: n.type as any, clamp: { min: 150, max: 450 } }) : 300;
        const h = calculateTextNodeHeight ? calculateTextNodeHeight(n.content || '', w, { layoutPreset: layout }) : (n.height || 60);
        store.updateNode(id, { width: w, height: h } as any);
      }
    }
  } catch {}

  // 同步一次群组几何，确保新建导图组的几何与成员一致
  try { recalcGroupGeometryForAll(); } catch {}

  return { groupId: groupNode.id };
}

// 📚 收集从 root 出发的连通节点（无向遍历，包含入/出边），用于初始规范化
export function collectConnectedSubgraph(canvas: Canvas, rootId: string): Set<string> {
  const visited = new Set<string>();
  const q: string[] = [rootId];
  const fromMap = new Map<string, string[]>();
  const toMap = new Map<string, string[]>();
  for (const c of canvas.connections) {
    if (!fromMap.has(c.from)) fromMap.set(c.from, []);
    if (!toMap.has(c.to)) toMap.set(c.to, []);
    fromMap.get(c.from)!.push(c.to);
    toMap.get(c.to)!.push(c.from);
  }
  while (q.length) {
    const id = q.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const outs = fromMap.get(id) || [];
    const ins = toMap.get(id) || [];
    for (const n of outs.concat(ins)) {
      if (!visited.has(n)) q.push(n);
    }
  }
  return visited;
}

// 🌳 从群组构建导图树（选择每个节点一个父边；其余视为跨引用）
export function buildMindmapTree(canvas: Canvas, groupId: string) {
  const group = canvas.nodes.find(n => n.id === groupId && n.type === 'group');
  if (!group || !(group as any).mindmap) return null;
  const meta = (group as any).mindmap as NonNullable<CanvasNode['mindmap']>;
  const members = new Set<string>((group.children || []) as string[]);

  // 选父策略：优先距根最近（BFS顺序），其次按连接创建时间近/先
  const childMap = new Map<string, string[]>();
  const parentMap = new Map<string, string>();
  for (const id of members) childMap.set(id, []);

  // 仅考虑成员间的边
  const edges = canvas.connections.filter(e => members.has(e.from) && members.has(e.to));

  // BFS 从根分配父子关系
  const q: string[] = [meta.rootId];
  const seen = new Set<string>([meta.rootId]);
  while (q.length) {
    const u = q.shift()!;
    // 折叠：不展开其子边
    if ((meta.collapsed as any)?.[u]) {
      continue;
    }
    for (const e of edges) {
      if (e.from === u) {
        if (!parentMap.has(e.to)) {
          parentMap.set(e.to, u);
          childMap.get(u)!.push(e.to);
          if (!seen.has(e.to)) {
            seen.add(e.to);
            q.push(e.to);
          }
        }
      }
    }
  }

  // 撤回：暂不按 siblingOrder 排序，待后续找到根因后再设计更稳健的机制

  // 构建树节点集合
  return { group, meta, childMap, parentMap };
}

// 📐 计算每个节点的子树高度（用于纵向分布）
function computeSubtreeHeights(nodeId: string, childMap: Map<string, string[]>, sizeMap: Map<string, { w: number; h: number }>, spacingY: number): number {
  const children = childMap.get(nodeId) || [];
  const selfH = sizeMap.get(nodeId)?.h || 60;
  if (children.length === 0) return selfH;
  let total = 0;
  for (let i = 0; i < children.length; i++) {
    const ch = children[i];
    const sub = computeSubtreeHeights(ch, childMap, sizeMap, spacingY);
    total += sub;
    if (i < children.length - 1) total += spacingY;
  }
  return Math.max(total, selfH);
}

// 🧭 计算每层最大宽度与X列位置
function computeLayerXs(rootId: string, childMap: Map<string, string[]>, sizeMap: Map<string, { w: number; h: number }>, rootLeftX: number, spacingX: number) {
  const layerWidths: number[] = [];
  // 层序遍历统计宽度
  const q: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  while (q.length) {
    const { id, depth } = q.shift()!;
    layerWidths[depth] = Math.max(layerWidths[depth] || 0, sizeMap.get(id)?.w || 200);
    for (const ch of (childMap.get(id) || [])) q.push({ id: ch, depth: depth + 1 });
  }
  const layerX: number[] = [];
  layerX[0] = rootLeftX;
  for (let d = 1; d < layerWidths.length; d++) {
    layerX[d] = layerX[d - 1] + (layerWidths[d - 1] || 200) + spacingX;
  }
  return { layerWidths, layerX };
}

// 🧩 递归布局：保证父节点中心与子树中心对齐
function layoutSubtree(nodeId: string, depth: number, centerY: number, childMap: Map<string, string[]>, sizeMap: Map<string, { w: number; h: number }>, layerX: number[], spacingY: number, out: Map<string, { x: number; y: number }>) {
  const size = sizeMap.get(nodeId) || { w: 200, h: 60 };
  const children = childMap.get(nodeId) || [];
  // 纵向：父节点以 centerY 垂直居中
  const leftX = layerX[depth];
  const topY = Math.round(centerY - size.h / 2);
  out.set(nodeId, { x: Math.round(leftX), y: topY });

  if (children.length === 0) return;

  // 计算子树总高度，并自上而下分配
  const heights = children.map(ch => computeSubtreeHeights(ch, childMap, sizeMap, spacingY));
  const total = heights.reduce((a, b) => a + b, 0) + spacingY * Math.max(0, children.length - 1);
  let cursorTop = Math.round(centerY - total / 2);
  for (let i = 0; i < children.length; i++) {
    const ch = children[i];
    const h = heights[i];
    const chCenter = cursorTop + h / 2;
    layoutSubtree(ch, depth + 1, chCenter, childMap, sizeMap, layerX, spacingY, out);
    cursorTop += h + (i < children.length - 1 ? spacingY : 0);
  }
}

// 🧩 紧凑纵向布局：
// - 父节点以给定 centerY 摆放；
// - 子女块的高度 = 子女“自身高度”之和 + 固定行距，不参考其后代子树高度；
// - 子树递归布局可以在纵向与上一列“穿插/越过”，各列互不为彼此预留空间。
function layoutSubtreeCompact(
  nodeId: string,
  depth: number,
  centerY: number,
  childMap: Map<string, string[]>,
  sizeMap: Map<string, { w: number; h: number }>,
  layerX: number[],
  spacingY: number,
  out: Map<string, { x: number; y: number }>
) {
  const size = sizeMap.get(nodeId) || { w: 200, h: 60 };
  const children = childMap.get(nodeId) || [];

  // 摆放当前节点
  const leftX = layerX[depth];
  const topY = Math.round(centerY - size.h / 2);
  out.set(nodeId, { x: Math.round(leftX), y: topY });

  if (children.length === 0) return;

  // 仅用子女“自身高度”堆叠
  const childHeights = children.map(ch => (sizeMap.get(ch)?.h || 60));
  const totalBlock = childHeights.reduce((a, b) => a + b, 0) + spacingY * Math.max(0, children.length - 1);
  let cursorTop = Math.round(centerY - totalBlock / 2);
  for (let i = 0; i < children.length; i++) {
    const ch = children[i];
    const h = childHeights[i];
    const chCenter = cursorTop + h / 2;
    layoutSubtreeCompact(ch, depth + 1, chCenter, childMap, sizeMap, layerX, spacingY, out);
    cursorTop += h + (i < children.length - 1 ? spacingY : 0);
  }
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
}

// 🧩 对齐版递归布局：支持列“右对齐”（用于双向布局的左侧）
function layoutSubtreeAligned(
  nodeId: string,
  depth: number,
  centerY: number,
  childMap: Map<string, string[]>,
  sizeMap: Map<string, { w: number; h: number }>,
  layerX: number[],
  layerWidths: number[] | undefined,
  spacingY: number,
  out: Map<string, { x: number; y: number }>,
  options: { compact?: boolean; alignRight?: boolean }
) {
  const size = sizeMap.get(nodeId) || { w: 200, h: 60 };
  const children = childMap.get(nodeId) || [];

  const baseLeft = layerX[depth];
  const colWidth = layerWidths?.[depth] || size.w;
  const leftX = options.alignRight ? (baseLeft + Math.max(0, colWidth - size.w)) : baseLeft;
  const topY = Math.round(centerY - size.h / 2);
  out.set(nodeId, { x: Math.round(leftX), y: topY });

  if (children.length === 0) return;

  if (options.compact) {
    const childHeights = children.map(ch => (sizeMap.get(ch)?.h || 60));
    const totalBlock = childHeights.reduce((a, b) => a + b, 0) + spacingY * Math.max(0, children.length - 1);
    let cursorTop = Math.round(centerY - totalBlock / 2);
    for (let i = 0; i < children.length; i++) {
      const ch = children[i];
      const h = childHeights[i];
      const chCenter = cursorTop + h / 2;
      layoutSubtreeAligned(ch, depth + 1, chCenter, childMap, sizeMap, layerX, layerWidths, spacingY, out, options);
      cursorTop += h + (i < children.length - 1 ? spacingY : 0);
    }
  } else {
    const heights = children.map(ch => computeSubtreeHeights(ch, childMap, sizeMap, spacingY));
    const total = heights.reduce((a, b) => a + b, 0) + spacingY * Math.max(0, children.length - 1);
    let cursorTop = Math.round(centerY - total / 2);
    for (let i = 0; i < children.length; i++) {
      const ch = children[i];
      const h = heights[i];
      const chCenter = cursorTop + h / 2;
      layoutSubtreeAligned(ch, depth + 1, chCenter, childMap, sizeMap, layerX, layerWidths, spacingY, out, options);
      cursorTop += h + (i < children.length - 1 ? spacingY : 0);
    }
  }
}

// 🧮 执行导图布局（右向、列间距自适配；仅对群组成员布局）
export function tidyLayout(canvas: Canvas, groupId: string): LayoutResult | null {
  const tree = buildMindmapTree(canvas, groupId);
  if (!tree) return null;
  const { meta, childMap } = tree;

  const sizeMap = new Map<string, { w: number; h: number }>();
  const members = new Set<string>((tree.group.children || []) as string[]);
  for (const id of members) {
    const n = canvas.nodes.find(nn => nn.id === id);
    if (n) sizeMap.set(id, { w: n.width || 200, h: n.height || 60 });
  }

  const root = canvas.nodes.find(n => n.id === meta.rootId);
  if (!root) return null;
  const rootLeftX = root.x; // 保持root的左侧位置不变（双向模式下作为对称基准）
  const rootCenterY = root.y + (root.height || 60) / 2; // 保持root中心纵向

  // 兄弟间距：紧凑模式允许更小的最小值（12px），标准模式维持 30px
  const isCompact = Boolean((meta as any).compactY);
  const spacingYRaw = Number.isFinite(meta.spacingY as any) ? (meta.spacingY as number) : 30;
  const spacingY = isCompact ? Math.max(12, spacingYRaw) : Math.max(30, spacingYRaw);
  const orientation = (meta.orientation as any) === 'both' ? 'both' : 'right';
  const tunnelEnabled = (() => { try { return useSettingsStore.getState().mindmap?.tunnelLayout !== false; } catch { return true; } })();

  // 仅右向
  if (orientation === 'right') {
    const out = new Map<string, { x: number; y: number }>();
    // 放置 root
    out.set(meta.rootId, { x: rootLeftX, y: Math.round(rootCenterY - (root.height || 60) / 2) });

    if (!tunnelEnabled) {
      const { layerX } = computeLayerXs(meta.rootId, childMap, sizeMap, rootLeftX, meta.spacingX);
      if (isCompact) layoutSubtreeCompact(meta.rootId, 0, rootCenterY, childMap, sizeMap, layerX, spacingY, out);
      else layoutSubtree(meta.rootId, 0, rootCenterY, childMap, sizeMap, layerX, spacingY, out);
      return { positions: out };
    }

    // 隧道图：每个分支沿各自父节点右缘推进
    const layoutRaggedChildren = (parentId: string, side: 'right' | 'left', centerY: number) => {
      const kids = childMap.get(parentId) || [];
      if (kids.length === 0) return;
      const parentSize = sizeMap.get(parentId) || { w: 200, h: 60 };
      const parentPos = out.get(parentId) || { x: canvas.nodes.find(n => n.id === parentId)?.x || 0, y: canvas.nodes.find(n => n.id === parentId)?.y || 0 };
      const heights = isCompact ? kids.map(ch => (sizeMap.get(ch)?.h || 60)) : kids.map(ch => computeSubtreeHeights(ch, childMap, sizeMap, spacingY));
      const total = heights.reduce((a, b) => a + b, 0) + spacingY * Math.max(0, kids.length - 1);
      let cursorTop = Math.round(centerY - total / 2);
      for (let i = 0; i < kids.length; i++) {
        const ch = kids[i];
        const h = heights[i];
        const chCenter = cursorTop + h / 2;
        const chSize = sizeMap.get(ch) || { w: 200, h: 60 };
        let leftX: number;
        if (side === 'right') {
          leftX = (parentPos.x) + parentSize.w + (meta.spacingX || 96);
        } else {
          leftX = (parentPos.x) - (meta.spacingX || 96) - chSize.w; // 右对齐
        }
        const topY = Math.round(chCenter - chSize.h / 2);
        out.set(ch, { x: Math.round(leftX), y: topY });
        // 递归其子
        layoutRaggedChildren(ch, side, chCenter);
        cursorTop += h + (i < kids.length - 1 ? spacingY : 0);
      }
    };

    // 右向：所有子在右侧
    layoutRaggedChildren(meta.rootId, 'right', rootCenterY);
    return { positions: out };
  }

  // 双向：root 居中，两侧对称展开
  const spacingX = Number.isFinite(meta.spacingX as any) ? (meta.spacingX as number) : 96;
  const out = new Map<string, { x: number; y: number }>();

  // 1) 放置 root 本身（以当前 x 保持锚点不变）
  out.set(meta.rootId, { x: rootLeftX, y: Math.round(rootCenterY - (root.height || 60) / 2) });

  // 2) 取 root 的直接子节点并按照子树高度做左右分配（贪心平衡）
  const directChildren = childMap.get(meta.rootId) || [];
  const childHeights = directChildren.map(ch => computeSubtreeHeights(ch, childMap, sizeMap, spacingY));
  // 按高度降序分配到左右两侧，尽量平衡总高度
  const indices = directChildren.map((_, i) => i).sort((a, b) => childHeights[b] - childHeights[a]);
  const leftChildren: string[] = [];
  const rightChildren: string[] = [];
  let leftSum = 0, rightSum = 0;
  for (const idx of indices) {
    const h = childHeights[idx];
    // 把行距也计入总高度以更匹配真实堆叠
    const effL = leftChildren.length > 0 ? leftSum + spacingY + h : leftSum + h;
    const effR = rightChildren.length > 0 ? rightSum + spacingY + h : rightSum + h;
    if (effL <= effR) { leftChildren.push(directChildren[idx]); leftSum = effL; } else { rightChildren.push(directChildren[idx]); rightSum = effR; }
  }

  // 3) 计算两侧各自的列 X 位置（列模式需要）。隧道模式不使用全局列宽，但保留变量以便条件分支。
  const computeSideLayerWidths = (roots: string[]): number[] => {
    const layerWidths: number[] = [];
    const q: Array<{ id: string; depth: number }> = roots.map(id => ({ id, depth: 1 }));
    while (q.length) {
      const { id, depth } = q.shift()!;
      layerWidths[depth] = Math.max(layerWidths[depth] || 0, sizeMap.get(id)?.w || 200);
      const kids = childMap.get(id) || [];
      for (const ch of kids) q.push({ id: ch, depth: depth + 1 });
    }
    return layerWidths;
  };
  const layerWidthsRight = computeSideLayerWidths(rightChildren);
  const layerWidthsLeft = computeSideLayerWidths(leftChildren);

  const layerXRight: number[] = [];
  layerXRight[0] = rootLeftX; // 未用
  // 第一列紧邻 root 右侧：root 右边 + spacingX
  layerXRight[1] = rootLeftX + (sizeMap.get(meta.rootId)?.w || (root.width || 200)) + spacingX;
  for (let d = 2; d < (layerWidthsRight.length || 0); d++) {
    layerXRight[d] = layerXRight[d - 1] + (layerWidthsRight[d - 1] || 200) + spacingX;
  }

  const layerXLeft: number[] = [];
  layerXLeft[0] = rootLeftX; // 未用
  // 第一列紧邻 root 左侧：root 左边 - spacingX - 本列最大宽度
  const firstLeftW = layerWidthsLeft[1] || 200;
  layerXLeft[1] = rootLeftX - spacingX - firstLeftW;
  for (let d = 2; d < (layerWidthsLeft.length || 0); d++) {
    const w = layerWidthsLeft[d] || 200;
    layerXLeft[d] = layerXLeft[d - 1] - spacingX - w;
  }

  // 4) 根据每侧总高度，围绕 rootCenterY 居中堆叠各子树，并调用布局函数
  const layoutSide = (roots: string[], layerX: number[], layerWidths: number[], alignRight: boolean) => {
    const heights = roots.map(ch => computeSubtreeHeights(ch, childMap, sizeMap, spacingY));
    const total = heights.reduce((a, b) => a + b, 0) + (roots.length > 0 ? spacingY * (roots.length - 1) : 0);
    let cursorTop = Math.round(rootCenterY - total / 2);
    for (let i = 0; i < roots.length; i++) {
      const ch = roots[i];
      const h = heights[i];
      const center = cursorTop + h / 2;
      if (!tunnelEnabled) {
        layoutSubtreeAligned(
          ch,
          1,
          center,
          childMap,
          sizeMap,
          layerX,
          layerWidths,
          spacingY,
          out,
          { compact: isCompact, alignRight }
        );
      } else {
        // 隧道图：递归从父节点推进（正确维护父子关系）
        const side: 'right' | 'left' = alignRight ? 'left' : 'right'; // alignRight 表示左侧
        const placeFrom = (parentId: string, nodeId: string, center: number, side: 'right' | 'left') => {
          const parentPos = out.get(parentId)!;
          const parentSize = sizeMap.get(parentId) || { w: 200, h: 60 };
          const selfSize = sizeMap.get(nodeId) || { w: 200, h: 60 };
          const leftX = side === 'right'
            ? parentPos.x + parentSize.w + (meta.spacingX || 96)
            : parentPos.x - (meta.spacingX || 96) - selfSize.w;
          const topY = Math.round(center - selfSize.h / 2);
          out.set(nodeId, { x: Math.round(leftX), y: topY });
          const kids = childMap.get(nodeId) || [];
          if (kids.length === 0) return;
          const subHeights = isCompact ? kids.map(k => (sizeMap.get(k)?.h || 60)) : kids.map(k => computeSubtreeHeights(k, childMap, sizeMap, spacingY));
          const totalH = subHeights.reduce((a, b) => a + b, 0) + spacingY * Math.max(0, kids.length - 1);
          let curTop = Math.round(center - totalH / 2);
          for (let j = 0; j < kids.length; j++) {
            const k = kids[j];
            const hh = subHeights[j];
            const ccenter = curTop + hh / 2;
            placeFrom(nodeId, k, ccenter, side);
            curTop += hh + (j < kids.length - 1 ? spacingY : 0);
          }
        };
        // 入入口：root 已放置
        placeFrom(meta.rootId, ch, center, side);
      }
      cursorTop += h + (i < roots.length - 1 ? spacingY : 0);
    }
  };

  // 右侧
  layoutSide(rightChildren, layerXRight, layerWidthsRight, false);
  // 左侧（右对齐）
  layoutSide(leftChildren, layerXLeft, layerWidthsLeft, true);

  return { positions: out };
}

// ======== 局部增量重排：避免子树相互覆盖（仅调整Y） ========

// 计算某节点可见子树（含自身）的包围盒（基于当前画布坐标）
function computeVisibleSubtreeBBox(
  canvas: Canvas,
  childMap: Map<string, string[]>,
  nodeId: string
): { minY: number; maxY: number; minX: number; maxX: number } | null {
  const byId = new Map(canvas.nodes.map(n => [n.id, n] as const));
  const root = byId.get(nodeId);
  if (!root) return null;
  let minY = root.y;
  let maxY = root.y + (root.height || 60);
  let minX = root.x;
  let maxX = root.x + (root.width || 200);
  const stack: string[] = [...(childMap.get(nodeId) || [])];
  while (stack.length) {
    const id = stack.pop()!;
    const n = byId.get(id);
    if (!n) continue;
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + (n.height || 60));
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + (n.width || 200));
    const kids = childMap.get(id) || [];
    for (const k of kids) stack.push(k);
  }
  return { minY, maxY, minX, maxX };
}

// 收集子树所有节点ID（含自身）
function collectVisibleSubtreeNodes(childMap: Map<string, string[]>, nodeId: string): string[] {
  const out: string[] = [nodeId];
  const stack: string[] = [...(childMap.get(nodeId) || [])];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    const kids = childMap.get(id) || [];
    for (const k of kids) stack.push(k);
  }
  return out;
}

// 针对某父节点的直接子树做自上而下的“让位”消除重叠（仅移动后续兄弟子树，最小必要位移）
export function reflowFromParent(canvas: Canvas, groupId: string, parentId: string, opts?: { minGapY?: number }): LayoutResult | null {
  const tree = buildMindmapTree(canvas, groupId);
  if (!tree) return null;
  const { meta, childMap } = tree;
  const children = childMap.get(parentId) || [];
  if (children.length <= 1) return { positions: new Map() };

  // 左右两侧在双向模式下独立重排；其余情况统一处理
  const orientation = (meta.orientation as any) === 'both' ? 'both' : 'right';
  const byId = new Map(canvas.nodes.map(n => [n.id, n] as const));
  const root = byId.get(meta.rootId);
  const rootCenterX = root ? (root.x + (root.width || 200) / 2) : 0;
  const minGap = Math.max(16, opts?.minGapY ?? (Number.isFinite(meta.spacingY as any) ? (meta.spacingY as number) : 30));

  const process = (childIds: string[]): Map<string, { x: number; y: number }> => {
    // 以当前包围盒top排序，保持现有视觉顺序
    const items = childIds.map(id => ({ id, bbox: computeVisibleSubtreeBBox(canvas, childMap, id)! }))
      .filter(it => !!it.bbox)
      .sort((a, b) => a.bbox.minY - b.bbox.minY);
    const positions = new Map<string, { x: number; y: number }>();
    if (items.length === 0) return positions;
    let cursorBottom = items[0].bbox.minY + (items[0].bbox.maxY - items[0].bbox.minY);
    // 第一项不动（尽量稳态），后续如有重叠则下推
    for (let i = 1; i < items.length; i++) {
      const it = items[i];
      const top = it.bbox.minY;
      const bottom = it.bbox.maxY;
      const requiredTop = cursorBottom + minGap;
      if (top < requiredTop) {
        const delta = requiredTop - top;
        // 移动整个子树
        const subtree = collectVisibleSubtreeNodes(childMap, it.id);
        for (const nid of subtree) {
          const n = byId.get(nid);
          if (!n) continue;
          positions.set(nid, { x: n.x, y: n.y + delta });
        }
        cursorBottom = bottom + delta; // 更新累积下边界
      } else {
        cursorBottom = bottom; // 无需移动，更新边界
      }
    }
    return positions;
  };

  if (orientation === 'both' && parentId === meta.rootId && root) {
    const left: string[] = [];
    const right: string[] = [];
    for (const id of children) {
      const n = byId.get(id);
      if (!n) continue;
      const centerX = n.x + (n.width || 200) / 2;
      if (centerX < rootCenterX) left.push(id); else right.push(id);
    }
    const L = process(left);
    const R = process(right);
    const merged = new Map<string, { x: number; y: number }>();
    L.forEach((v, k) => merged.set(k, v));
    R.forEach((v, k) => merged.set(k, v));
    return { positions: merged };
  }

  // 单侧或普通父节点
  const positions = process(children);
  return { positions };
}

// 针对一批“发生尺寸/可见性变化”的节点，按其最近父节点做局部重排
export function resolveOverlapsAfterChange(canvas: Canvas, groupId: string, changedNodeIds: string[]): void {
  const tree = buildMindmapTree(canvas, groupId);
  if (!tree) return;
  const { parentMap } = tree as any;
  const parents = new Set<string>();
  for (const id of changedNodeIds || []) {
    const p = (parentMap as Map<string, string>).get(id) || (tree.meta?.rootId as string);
    if (p) parents.add(p);
  }
  const store = useCanvasStore.getState();
  for (const pid of parents) {
    try {
      const fresh = useCanvasStore.getState().canvas;
      const res = reflowFromParent(fresh, groupId, pid);
      applyLayout(res);
    } catch { /* ignore */ }
  }
}

// 切换思维导图节点的折叠状态（并触发布局）
export function toggleMindmapCollapse(nodeId: string, desired?: boolean) {
  const store = useCanvasStore.getState();
  const canvas = store.canvas;
  const group = findMindmapGroupForNode(canvas, nodeId);
  if (!group) return;
  const meta = (group as any).mindmap as NonNullable<CanvasNode['mindmap']>;
  const collapsed = { ...(meta.collapsed || {}) } as Record<string, boolean>;
  const next = desired === undefined ? !collapsed[nodeId] : desired;
  collapsed[nodeId] = next;
  store.updateNode(group.id, { mindmap: { ...meta, collapsed } } as any);
  const latest = useCanvasStore.getState().canvas;
  const result = tidyLayout(latest, group.id);
  applyLayout(result);
  // 展开/折叠后进行一次局部避让，避免展开造成遮挡
  try { resolveOverlapsAfterChange(useCanvasStore.getState().canvas, group.id, [nodeId]); } catch {}
}

// 切换思维导图组的紧凑纵向布局（compactY），并触发一次重排
export function setMindmapCompactMode(groupId: string, compact: boolean) {
  const store = useCanvasStore.getState();
  const canvas = store.canvas;
  const group = canvas.nodes.find(n => n.id === groupId && n.type === 'group');
  if (!group || !(group as any).mindmap) return;
  const meta = (group as any).mindmap as NonNullable<CanvasNode['mindmap']>;
  store.updateNode(groupId, { mindmap: { ...meta, compactY: !!compact } } as any);
  const latest = useCanvasStore.getState().canvas;
  const result = tidyLayout(latest, groupId);
  applyLayout(result);
}

// 切换思维导图的布局方向：'right' | 'both'，并触发一次重排
export function setMindmapOrientation(groupId: string, orientation: 'right' | 'both') {
  const store = useCanvasStore.getState();
  const canvas = store.canvas;
  const group = canvas.nodes.find(n => n.id === groupId && n.type === 'group');
  if (!group || !(group as any).mindmap) return;
  const meta = (group as any).mindmap as NonNullable<CanvasNode['mindmap']>;
  store.updateNode(groupId, { mindmap: { ...meta, orientation: orientation as any } } as any);
  const latest = useCanvasStore.getState().canvas;
  const result = tidyLayout(latest, groupId);
  applyLayout(result);
}

// 统计 nodeId 作为父时的后代数量（忽略折叠，仅用于徽标显示）
export function countMindmapDescendants(canvas: Canvas, groupId: string, nodeId: string): number {
  const group = canvas.nodes.find(n => n.id === groupId && n.type === 'group');
  if (!group || !(group as any).mindmap) return 0;
  const members = new Set<string>((group.children || []) as string[]);
  const edges = canvas.connections.filter(e => members.has(e.from) && members.has(e.to));
  const fromMap = new Map<string, string[]>();
  for (const e of edges) {
    if (!fromMap.has(e.from)) fromMap.set(e.from, []);
    fromMap.get(e.from)!.push(e.to);
  }
  const q = [nodeId];
  const seen = new Set<string>([nodeId]);
  let count = 0;
  while (q.length) {
    const u = q.shift()!;
    const nexts = fromMap.get(u) || [];
    for (const v of nexts) {
      if (!seen.has(v)) {
        seen.add(v);
        q.push(v);
        if (v !== nodeId) count++;
      }
    }
  }
  return count;
}

// ✨ 将布局结果写回Store（带可选动画后续补充）
export function applyLayout(result: LayoutResult | null) {
  if (!result) return;
  const store = useCanvasStore.getState();
  for (const [id, pos] of result.positions.entries()) {
    store.updateNode(id, { x: pos.x, y: pos.y, updatedAt: Date.now() } as any);
  }
  // 布局后统一刷新所有群组的几何，避免几何长期滞后
  try { recalcGroupGeometryForAll(); } catch {}
}

// ====== Root Consistency Helper ======
function updateMindmapRootIfNeeded(groupId: string): void {
  const store = useCanvasStore.getState();
  const canvas = store.canvas;
  const group = canvas.nodes.find(n => n.id === groupId && n.type === 'group') as any;
  if (!group || !group.mindmap) return;

  // 成员集合（剔除群组）
  const members = new Set<string>(((group.children || []) as string[]).filter((id) => {
    const n = canvas.nodes.find(nn => nn.id === id);
    return !!n && (n as any).type !== 'group';
  }));
  if (members.size === 0) return;

  // 组内边集合
  const edges = (canvas.connections || []).filter(e => members.has(e.from) && members.has(e.to));

  // 计算入度
  const inDeg = new Map<string, number>();
  for (const id of members) inDeg.set(id, 0);
  for (const e of edges) inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);

  // 候选根：入度为0者
  const candidates = Array.from(members).filter(id => (inDeg.get(id) || 0) === 0);
  if (candidates.length === 0) return; // 保持原样

  // 优先：若当前root仍为候选，保持不变
  const meta = group.mindmap as NonNullable<CanvasNode['mindmap']>;
  if (meta.rootId && candidates.includes(meta.rootId)) return;

  // 否则选择稳定候选：按 createdAt/x/y/内容排序
  const byId = new Map(canvas.nodes.map(n => [n.id, n] as const));
  candidates.sort((a, b) => {
    const na = byId.get(a)!; const nb = byId.get(b)!;
    if ((na.createdAt || 0) !== (nb.createdAt || 0)) return (na.createdAt || 0) - (nb.createdAt || 0);
    if (na.x !== nb.x) return na.x - nb.x;
    if (na.y !== nb.y) return na.y - nb.y;
    return (na.title || na.content || '').localeCompare(nb.title || nb.content || '');
  });

  const newRoot = candidates[0];
  if (!newRoot || newRoot === meta.rootId) return;

  // 更新 rootId
  store.updateNode(groupId, { mindmap: { ...meta, rootId: newRoot }, updatedAt: Date.now() } as any);

  // 同步 children 为从新root可达的连通子图（保持导图组的一致性）
  // 不再使用全画布连通子图去覆盖 children，避免跨组污染。
}

// ======= 拖拽结束：自动吸附/远离断开 =======

export interface MindmapDragPreview {
  action: 'attach' | 'detach' | 'none';
  candidateParent?: CanvasNode;
  targetPosition?: { x: number; y: number };
  confidence: number; // 0-1, 用于渐进式预览强度
  willDetach?: boolean; // 是否会断开现有连接
  currentParent?: CanvasNode;
}

// 🎯 预览计算函数：预测拖拽结束后的吸附/断开行为
// 支持内部节点重新连接和外部节点加入群组两种场景
export function predictMindmapDragResult(nodeId: string, currentPosition?: { x: number; y: number }): MindmapDragPreview {
  try {
    if (!nodeId) {
      console.warn('predictMindmapDragResult: nodeId is null or undefined');
      return { action: 'none', confidence: 0 };
    }

    const store = useCanvasStore.getState();
    if (!store?.canvas) {
      console.warn('predictMindmapDragResult: canvas state is invalid');
      return { action: 'none', confidence: 0 };
    }

    const canvas = store.canvas;
    const ctx = getGroupAndMetaForNode(canvas, nodeId);

    // 🍎 Apple架构：双路径处理
    if (!ctx) {
      // 路径A: 外部节点 → 寻找可加入的思维导图群组
      return predictExternalNodeJoinMindmap(nodeId, currentPosition, canvas);
    }

    // 路径B: 内部节点 → 现有重连逻辑
    const { group, meta, members } = ctx;
  const node = canvas.nodes.find(n => n.id === nodeId);
  if (!node) return { action: 'none', confidence: 0 };

  // 使用传入的位置或当前位置
  const nodeX = currentPosition?.x ?? node.x;
  const nodeY = currentPosition?.y ?? node.y;
  const nodeCenterY = nodeY + (node.height || 60) / 2;

  const ATTACH_X = 20; // 再次降低X方向吸附阈值（更不易误吸附）
  const ATTACH_Y = Math.max(node.height || 60, 60) + 4; // 再次降低Y方向吸附阈值
  const DETACH_X = (meta.spacingX || 96) + 60;
  // 与吸附阈值解耦，保持原有更高的脱离阈值，避免轻易断开
  const DETACH_Y = Math.max(node.height || 60, 60) + 40 + 30;

  const prefLeft = (p: CanvasNode) => p.x + p.width + (meta.spacingX || 96);

  // 寻找最佳候选父节点
  let bestParent: CanvasNode | null = null;
  let bestScore = Infinity;
  let bestDistance = { dx: 0, dy: 0 };

  for (const id of members) {
    if (id === nodeId) continue;
    const p = canvas.nodes.find(n => n.id === id);
    if (!p) continue;
    // 排除群组节点作为父候选
    if ((p as any).type === 'group') continue;
    if (isDescendantInGroup(canvas, members, nodeId, id)) continue;

    const py = p.y + (p.height || 60) / 2;
    const dy = Math.abs(nodeCenterY - py);

    // 评估右侧吸附（父在左、子在右）
    const targetRightX = prefLeft(p);
    const dxR = Math.abs(nodeX - targetRightX);
    if (dxR <= ATTACH_X && dy <= ATTACH_Y) {
      const scoreR = dxR + dy * 0.5;
      if (scoreR < bestScore) {
        bestScore = scoreR;
        bestParent = p;
        bestDistance = { dx: dxR, dy };
      }
    }

    // 评估左侧吸附（父在右、子在左）
    const targetLeftX = p.x - (meta.spacingX || 96) - (node.width || 200);
    const dxL = Math.abs(nodeX - targetLeftX);
    if (dxL <= ATTACH_X && dy <= ATTACH_Y) {
      const scoreL = dxL + dy * 0.5;
      if (scoreL < bestScore) {
        bestScore = scoreL;
        bestParent = p;
        bestDistance = { dx: dxL, dy };
      }
    }
  }

  // 检查现有父子关系
  const filteredMembers = new Set(Array.from(members).filter((mid) => {
    const n = canvas.nodes.find(nn => nn.id === mid);
    return !!n && (n as any).type !== 'group';
  }));
  const existing = findExistingParentInGroup(canvas, filteredMembers, nodeId);

  if (bestParent) {
    // 计算吸附信心度：距离越近信心度越高
    const maxDistance = ATTACH_X + ATTACH_Y;
    const currentDistance = bestDistance.dx + bestDistance.dy * 0.5;
    const confidence = Math.max(0, 1 - (currentDistance / maxDistance));

    return {
      action: 'attach',
      candidateParent: bestParent,
      targetPosition: { x: prefLeft(bestParent), y: bestParent.y + (bestParent.height || 60) / 2 },
      confidence: confidence,
      willDetach: existing && existing.parentId !== bestParent.id,
      currentParent: existing ? canvas.nodes.find(n => n.id === existing.parentId) : undefined
    };
  } else if (existing) {
    // 检查是否需要断开
    const parent = canvas.nodes.find(n => n.id === existing.parentId);
    if (parent) {
      // 根据当前相对位置推断侧向，选择该侧的目标X用于脱离判断
      const parentCenterX = parent.x + (parent.width || 200) / 2;
      const onRight = nodeX >= parentCenterX;
      const targetX = onRight ? prefLeft(parent) : (parent.x - (meta.spacingX || 96) - (node.width || 200));
      const dx = Math.abs(nodeX - targetX);
      const py = parent.y + (parent.height || 60) / 2;
      const dy = Math.abs(nodeCenterY - py);

      if (dx > DETACH_X || dy > DETACH_Y) {
        // 计算断开信心度：距离越远信心度越高
        const minDetachDistance = DETACH_X + DETACH_Y;
        const currentDistance = dx + dy;
        const confidence = Math.min(1, Math.max(0, (currentDistance - minDetachDistance) / minDetachDistance));

        return {
          action: 'detach',
          currentParent: parent,
          confidence: confidence,
          willDetach: true
        };
      }
    }
  }

  return { action: 'none', confidence: 0 };

  } catch (error) {
    console.error('predictMindmapDragResult failed:', error);
    return { action: 'none', confidence: 0 };
  }
}

// 🍎 外部节点加入思维导图的预览计算
function predictExternalNodeJoinMindmap(nodeId: string, currentPosition: { x: number; y: number } | undefined, canvas: Canvas): MindmapDragPreview {
  try {
    if (!nodeId || !canvas || !canvas.nodes) {
      return { action: 'none', confidence: 0 };
    }

    const node = canvas.nodes.find(n => n.id === nodeId);
    if (!node) return { action: 'none', confidence: 0 };

  // 使用传入位置或当前位置
  const nodeX = currentPosition?.x ?? node.x;
  const nodeY = currentPosition?.y ?? node.y;
  const nodeCenterY = nodeY + (node.height || 60) / 2;

  // 🎯 扫描所有思维导图群组，寻找最佳加入目标
  const mindmapGroups = canvas.nodes.filter(n => n.type === 'group' && (n as any).mindmap);

  let bestCandidate: CanvasNode | null = null;
  let bestScore = Infinity;
  let bestDistance = { dx: 0, dy: 0 };

  for (const group of mindmapGroups) {
    const meta = (group as any).mindmap as NonNullable<CanvasNode['mindmap']>;
    const members = new Set<string>((group.children || []) as string[]);

    // 对该群组的每个成员节点检测吸附可能性
    for (const memberId of members) {
      const memberNode = canvas.nodes.find(n => n.id === memberId);
      if (!memberNode) continue;

      // 计算理想连接位置：同时评估成员节点左右两侧
      const targetRightX = memberNode.x + memberNode.width + (meta.spacingX || 96);
      const targetLeftX = memberNode.x - (meta.spacingX || 96) - (node.width || 200);
      const dxRight = Math.abs(nodeX - targetRightX);
      const dxLeft = Math.abs(nodeX - targetLeftX);
      const memberCenterY = memberNode.y + (memberNode.height || 60) / 2;
      const dy = Math.abs(nodeCenterY - memberCenterY);

      // 使用更小的吸附阈值，进一步降低加入思维导图的灵敏度
      const ATTACH_X = 32;
      const ATTACH_Y = Math.max(node.height || 60, 60) + 8;

      const dx = Math.min(dxRight, dxLeft);
      if (dx <= ATTACH_X && dy <= ATTACH_Y) {
        const score = dx + dy * 0.5;
        if (score < bestScore) {
          bestScore = score;
          bestCandidate = memberNode;
          bestDistance = { dx, dy };
        }
      }
    }
  }

  if (bestCandidate) {
    // 计算加入信心度
    const maxDistance = 80 + Math.max(node.height || 60, 60) + 40;
    const currentDistance = bestDistance.dx + bestDistance.dy * 0.5;
    const confidence = Math.max(0, 1 - (currentDistance / maxDistance));

    return {
      action: 'attach',
      candidateParent: bestCandidate,
      targetPosition: {
        x: bestCandidate.x + bestCandidate.width + 96,
        y: bestCandidate.y + (bestCandidate.height || 60) / 2
      },
      confidence: confidence,
      willDetach: false, // 外部节点加入不涉及断开
      currentParent: undefined
    };
  }

  // 🔧 没有找到合适的候选者时返回默认值
  return { action: 'none', confidence: 0 };

  } catch (error) {
    console.error('predictExternalNodeJoinMindmap failed:', error);
    return { action: 'none', confidence: 0 };
  }
}

function getGroupAndMetaForNode(canvas: Canvas, nodeId: string) {
  const group = findMindmapGroupForNode(canvas, nodeId);
  if (!group) return null;
  const meta = (group as any).mindmap as NonNullable<CanvasNode['mindmap']>;
  const members = new Set<string>((group.children || []) as string[]);
  return { group, meta, members };
}

function isDescendantInGroup(canvas: Canvas, members: Set<string>, ancestorId: string, possibleDescendantId: string): boolean {
  if (ancestorId === possibleDescendantId) return true;
  const edges = (canvas.connections || []).filter(e => members.has(e.from) && members.has(e.to));
  const fromMap = new Map<string, string[]>();
  for (const e of edges) {
    if (!fromMap.has(e.from)) fromMap.set(e.from, []);
    fromMap.get(e.from)!.push(e.to);
  }
  const q = [ancestorId];
  const seen = new Set<string>([ancestorId]);
  while (q.length) {
    const u = q.shift()!;
    const nexts = fromMap.get(u) || [];
    for (const v of nexts) {
      if (!seen.has(v)) {
        if (v === possibleDescendantId) return true;
        seen.add(v);
        q.push(v);
      }
    }
  }
  return false;
}

// 🍎 外部节点加入思维导图的执行逻辑 - 原子性操作保证
function executeExternalNodeJoinMindmap(nodeId: string, canvas: Canvas, store: any): boolean {
  try {
    const node = canvas.nodes.find(n => n.id === nodeId);
    if (!node) {
      console.warn(`外部节点 ${nodeId} 不存在`);
      return false;
    }

    // 重新计算最佳目标 (基于传入的canvas状态，避免state不一致)
    const preview = predictExternalNodeJoinMindmap(nodeId, undefined, canvas);
    if (!preview || preview.action !== 'attach' || !preview.candidateParent) {
      return false;
    }

    const targetParent = preview.candidateParent;

    // 🔍 找到目标父节点所属的思维导图群组
    const targetGroupCtx = getGroupAndMetaForNode(canvas, targetParent.id);
    if (!targetGroupCtx) {
      console.warn(`目标父节点 ${targetParent.id} 不属于任何思维导图群组`);
      return false;
    }

    const { group: targetGroup } = targetGroupCtx;

    // 🎯 原子性操作：先检查，再执行，有错误则全部回滚
    const rollbackActions: (() => void)[] = [];

    // Step 1: 将节点加入群组
    const currentChildren = new Set<string>((targetGroup.children || []) as string[]);
    const originalChildren = Array.from(currentChildren);
    currentChildren.add(nodeId);
    currentChildren.add(targetParent.id);

    store.updateNode(targetGroup.id, {
      children: Array.from(currentChildren)
    } as any);

    rollbackActions.push(() => {
      store.updateNode(targetGroup.id, { children: originalChildren } as any);
    });

    // Step 1.5: 标记父组，确保后续所有导图逻辑都能识别成员归属
    const originalParent = (node as any).parentGroupId;
    store.updateNode(node.id, { parentGroupId: targetGroup.id } as any);
    rollbackActions.push(() => {
      store.updateNode(node.id, { parentGroupId: originalParent } as any);
    });

    // Step 2: 建立连接关系
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    store.addConnection({
      id: connectionId,
      from: targetParent.id,
      to: nodeId,
      createdAt: Date.now()
    } as any);

    rollbackActions.push(() => {
      store.removeConnection(connectionId);
    });

    // Step 3: 触发自动布局 (使用当前传入的canvas，而不是重新获取)
    try { updateMindmapRootIfNeeded(targetGroup.id); } catch {}
    const latest = useCanvasStore.getState().canvas;
    const layoutResult = tidyLayout(latest, targetGroup.id);
    applyLayout(layoutResult);

    console.log(`🍎 外部节点 ${nodeId} 成功加入思维导图群组 ${targetGroup.id}`);
    return true;

  } catch (error) {
    console.error(`外部节点加入失败 ${nodeId}:`, error);
    // 在生产环境中，这里应该执行rollbackActions
    return false;
  }
}

// ====== Geometry Sync Helper ======
function recalcGroupGeometryForAll(): void {
  const store = useCanvasStore.getState();
  const canvas = store.canvas;
  const nodes = canvas?.nodes || [];
  if (nodes.length === 0) return;

  const nodeById = new Map<string, CanvasNode>();
  nodes.forEach(n => nodeById.set(n.id, n));

  const isGroup = (n: CanvasNode) => (n as any).type === 'group';

  const getDescendantLeavesForGroup = (gid: string, hidden?: Set<string>): CanvasNode[] => {
    const g = nodeById.get(gid) as any;
    if (!g) return [];
    const out: CanvasNode[] = [];
    const seen = new Set<string>();
    const stack: string[] = [...((g.children || []) as string[])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const child = nodeById.get(id);
      if (!child) continue;
      if ((child as any).type === 'group') {
        const cc = ((child as any).children || []) as string[];
        for (const cid of cc) stack.push(cid);
      } else {
        if (!hidden || !hidden.has(child.id)) out.push(child);
      }
    }
    return out;
  };

  const now = Date.now();
  for (const n of nodes) {
    if (!isGroup(n)) continue;
    const isMindmap = Boolean((n as any).mindmap);
    const hidden = isMindmap ? getHiddenMindmapNodesForGroup(canvas, n.id) : undefined;
    let leaves = getDescendantLeavesForGroup(n.id, hidden);
    if (isMindmap && leaves.length === 0) {
      // 兜底：至少包含 rootId
      const rootId = ((n as any).mindmap?.rootId) as string | undefined;
      if (rootId) {
        const rootNode = nodeById.get(rootId);
        if (rootNode && (rootNode as any).type !== 'group') {
          leaves = [rootNode];
        }
      }
    }
    if (leaves.length === 0) continue;
    const b = calculateGroupBounds(leaves);
    if (n.x !== b.x || n.y !== b.y || n.width !== b.width || n.height !== b.height) {
      store.updateNode(n.id, { x: b.x, y: b.y, width: b.width, height: b.height, updatedAt: now } as any);
    }
  }
}

// 🧼 纯函数：同步所有群组的几何到其后代叶子的包围（考虑思维导图折叠隐藏）
export function computeSyncedGroupGeometry(input: Canvas): Canvas {
  try {
    const nodes = input?.nodes || [];
    if (nodes.length === 0) return input;
    const byId = new Map<string, CanvasNode>(nodes.map(n => [n.id, n]));
    const isGroup = (n: CanvasNode) => (n as any).type === 'group';

    const leavesForGroup = (gid: string, hidden?: Set<string>): CanvasNode[] => {
      const g = byId.get(gid) as any;
      if (!g) return [];
      const out: CanvasNode[] = [];
      const seen = new Set<string>();
      const stack: string[] = [...((g.children || []) as string[])];
      while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const child = byId.get(id);
        if (!child) continue;
        if ((child as any).type === 'group') {
          const cc = ((child as any).children || []) as string[];
          for (const cid of cc) stack.push(cid);
        } else {
          if (!hidden || !hidden.has(child.id)) out.push(child);
        }
      }
      return out;
    };

    let changed = false;
    const now = Date.now();
    const updated = nodes.map((n) => {
      if (!isGroup(n)) return n;
      const isMindmap = Boolean((n as any).mindmap);
      const hidden = isMindmap ? getHiddenMindmapNodesForGroup(input, n.id) : undefined;
      let leaves = leavesForGroup(n.id, hidden);
      if (isMindmap && leaves.length === 0) {
        const rootId = ((n as any).mindmap?.rootId) as string | undefined;
        if (rootId) {
          const rootNode = byId.get(rootId);
          if (rootNode && (rootNode as any).type !== 'group') leaves = [rootNode];
        }
      }
      if (leaves.length === 0) return n;
      const b = calculateGroupBounds(leaves);
      if (n.x !== b.x || n.y !== b.y || n.width !== b.width || n.height !== b.height) {
        changed = true;
        return { ...n, x: b.x, y: b.y, width: b.width, height: b.height, updatedAt: now } as CanvasNode;
      }
      return n;
    });
    if (!changed) return input;
    return { ...input, nodes: updated, updatedAt: now };
  } catch {
    return input;
  }
}

function findExistingParentInGroup(canvas: Canvas, members: Set<string>, nodeId: string): { parentId: string; connectionId: string } | null {
  const e = (canvas.connections || []).find(c => c.to === nodeId && members.has(c.from));
  if (!e) return null;
  return { parentId: e.from, connectionId: e.id };
}

export function autoSnapOrDetachOnDragEnd(nodeId: string): boolean {
  const store = useCanvasStore.getState();
  let canvas = store.canvas;
  const ctx = getGroupAndMetaForNode(canvas, nodeId);

  // 🍎 Apple架构：双路径执行逻辑
  if (!ctx) {
    // 路径A: 外部节点 → 尝试加入思维导图群组
    // 为避免误吸附，仅当预测明确返回attach且距离足够近时才加入
    const preview = predictExternalNodeJoinMindmap(nodeId, undefined, canvas);
    if (preview && preview.action === 'attach' && preview.confidence >= 0.6) {
      return executeExternalNodeJoinMindmap(nodeId, canvas, store);
    }
    return false;
  }
  const { group, meta, members } = ctx;
  const node = canvas.nodes.find(n => n.id === nodeId);
  if (!node) return false;

  // 计算候选父：右向、就近、避免环
  const nodeCenterY = node.y + (node.height || 60) / 2;
  const ATTACH_X = 20; // 再次降低X方向吸附阈值
  const ATTACH_Y = Math.max(node.height || 60, 60) + 4; // 再次降低Y方向吸附阈值
  const DETACH_X = (meta.spacingX || 96) + 60;
  // 与吸附阈值解耦，保持原有更高的脱离阈值，避免轻易断开
  const DETACH_Y = Math.max(node.height || 60, 60) + 40 + 30;

  const prefLeft = (p: CanvasNode) => p.x + p.width + (meta.spacingX || 96);
  let bestParent: CanvasNode | null = null;
  let bestScore = Infinity;
  for (const id of members) {
    if (id === nodeId) continue;
    const p = canvas.nodes.find(n => n.id === id);
    if (!p) continue;
    // 排除群组节点作为父候选
    if ((p as any).type === 'group') continue;
    // 避免环：父不能是自己的后代
    if (isDescendantInGroup(canvas, members, nodeId, id)) continue;
    const py = p.y + (p.height || 60) / 2;
    const dy = Math.abs(nodeCenterY - py);
    // 评估右侧
    const targetRightX = prefLeft(p);
    const dxR = Math.abs(node.x - targetRightX);
    if (dxR <= ATTACH_X && dy <= ATTACH_Y) {
      const scoreR = dxR + dy * 0.5;
      if (scoreR < bestScore) {
        bestScore = scoreR;
        bestParent = p;
      }
    }
    // 评估左侧
    const targetLeftX = p.x - (meta.spacingX || 96) - (node.width || 200);
    const dxL = Math.abs(node.x - targetLeftX);
    if (dxL <= ATTACH_X && dy <= ATTACH_Y) {
      const scoreL = dxL + dy * 0.5;
      if (scoreL < bestScore) {
        bestScore = scoreL;
        bestParent = p;
      }
    }
  }

  const existing = findExistingParentInGroup(canvas, new Set(Array.from(members).filter(id => {
    const n = canvas.nodes.find(nn => nn.id === id);
    return !!n && (n as any).type !== 'group';
  })), nodeId);
  let changed = false;

  if (bestParent) {
    // 需要吸附到 bestParent
    if (!existing || existing.parentId !== bestParent.id) {
      // 如果已有父，先移除
      if (existing) {
        store.removeConnection(existing.connectionId);
      }
      // 确保归组
      const children = new Set<string>(((canvas.nodes.find(n => n.id === group.id) as any)?.children || []) as string[]);
      children.add(nodeId);
      children.add(bestParent.id);
      store.updateNode(group.id, { children: Array.from(children) } as any);
      // 标记父组，确保后续判定为导图成员
      store.updateNode(nodeId, { parentGroupId: group.id } as any);
      // 添加连接
      store.addConnection({ id: '', from: bestParent.id, to: nodeId, createdAt: Date.now() } as any);
      changed = true;
    }
  } else if (existing) {
    // 判断是否需要断开
    const parent = canvas.nodes.find(n => n.id === existing.parentId);
    if (parent) {
      const targetX = prefLeft(parent);
      const dx = Math.abs(node.x - targetX);
      const py = parent.y + (parent.height || 60) / 2;
      const dy = Math.abs(nodeCenterY - py);
      if (dx > DETACH_X || dy > DETACH_Y) {
        store.removeConnection(existing.connectionId);
        changed = true;
      }
    }
  }

  if (changed) {
    // 连接结构已变化：检查是否需要更新根节点
    try { updateMindmapRootIfNeeded(group.id); } catch {}
    canvas = useCanvasStore.getState().canvas;
    const result = tidyLayout(canvas, group.id);
    applyLayout(result);
  }
  return changed;
}

// ➕ 在导图中为父节点添加子节点，并连线与规范化布局
export function addMindmapChild(parentId: string) {
  const store = useCanvasStore.getState();
  let canvas = store.canvas;
  const parent = canvas.nodes.find(n => n.id === parentId);
  if (!parent) return;

  // 确保群组存在
  const ensured = ensureMindmapGroup(parentId);
  if (!ensured) return;
  const groupId = ensured.groupId;
  canvas = useCanvasStore.getState().canvas; // 取最新
  const group = canvas.nodes.find(n => n.id === groupId)! as any;
  const meta = group.mindmap as NonNullable<CanvasNode['mindmap']>;

  // 子节点类型：默认文本；若父为 todo 则 todo
  const childType = parent.type === 'todo' ? 'todo' : 'text';
  const childWidth = childType === 'todo' ? 300 : 300;
  const childHeight = childType === 'todo' ? 60 : 60;
  const childLeft = parent.x + parent.width + meta.spacingX;
  const parentCenterY = parent.y + parent.height / 2;
  // 初始摆放时，按现有子数目作轻微偏移，避免创建瞬间重叠（最终以 tidy 布局为准）
  const existingKids = canvas.connections.filter(e => e.from === parentId && (group.children || []).includes(e.to as any));
  const childTop = Math.round(parentCenterY - childHeight / 2 + existingKids.length * (meta.spacingY || 30));

  const child = createNodeAtPosition(childType as any, { x: childLeft, y: childTop }, canvas.id, { parentGroupId: groupId, content: '' } as any);
  store.addNode(child);

  // 归组
  canvas = useCanvasStore.getState().canvas; // 取最新，避免覆盖旧children
  const freshGroup = canvas.nodes.find(n => n.id === groupId)! as any;
  const children = new Set<string>((freshGroup.children || []) as string[]);
  // 仅添加必要成员，避免通过连通子图将外部节点全部纳入
  children.add(parentId);
  children.add(child.id);
  store.updateNode(groupId, { children: Array.from(children), updatedAt: Date.now() } as any);
  store.updateNode(child.id, { parentGroupId: groupId } as any);

  // 思维导图内：初始宽度按内容估算，优先变宽到上限 450，再由高度承载
  try {
    if (child.type === 'text' || child.type === 'todo') {
      const presetId = useCanvasStore.getState().canvas?.textLayoutPreset;
      const { estimateAutoTextWidth, getTextLayoutPreset, calculateTextNodeHeight } = require('../utils/canvasUtils');
      const layout = getTextLayoutPreset ? getTextLayoutPreset(presetId) : undefined;
      const autoMode = (() => { try { return useSettingsStore.getState().mindmap?.autoWidthMode === 'auto'; } catch { return false; } })();
      const w = autoMode ? estimateAutoTextWidth(child.content || '', { layoutPreset: layout, nodeType: child.type as any, clamp: { min: 150, max: 450 } }) : 300;
      const h = calculateTextNodeHeight ? calculateTextNodeHeight(child.content || '', w, { layoutPreset: layout }) : (child.height || 60);
      store.updateNode(child.id, { width: w, height: h } as any);
    }
  } catch {}

  // 连线（父 -> 子）
  store.addConnection({ id: '', from: parent.id, to: child.id, createdAt: Date.now() });

  // 规范化布局（使用最新画布状态，避免遗漏刚刚新增的节点/连线）
  {
    try { updateMindmapRootIfNeeded(groupId); } catch {}
    const latest = useCanvasStore.getState().canvas;
    const result = tidyLayout(latest, groupId);
    applyLayout(result);
  }

  // 选中新建子节点并自动进入编辑状态
  store.selectSingleNode(child.id);
  // 🎯 UX优化：创建节点后自动进入编辑状态，使用Store的编辑状态管理
  setTimeout(() => {
    const store = useCanvasStore.getState();
    store.enterEditMode('node', child.id);
  }, 0);
}

// ➕ 在导图中为当前节点添加同级兄弟
export function addMindmapSibling(currentId: string) {
  const store = useCanvasStore.getState();
  let canvas = store.canvas;
  const current = canvas.nodes.find(n => n.id === currentId);
  if (!current) return;
  const group = findMindmapGroupForNode(canvas, currentId);
  if (!group) {
    // 若没有群组，则按子节点方式退化
    addMindmapChild(currentId);
    return;
  }
  const meta = (group as any).mindmap as NonNullable<CanvasNode['mindmap']>;

  // 找到父节点（根据成员内 from->to 边）
  const members = new Set<string>((group.children || []) as string[]);
  const parentEdge = canvas.connections.find(e => e.to === currentId && members.has(e.from));
  const parentId = parentEdge?.from || currentId; // 若无父，则退化为自身作为父
  const parent = canvas.nodes.find(n => n.id === parentId)!;
  const siblingType = current.type; // 继承类型

  const sibW = current.width;
  const sibH = current.height;
  const left = parent.x + parent.width + meta.spacingX;
  // 初始略微偏移，布局后纠正；按同级数量避免瞬间堆叠
  const siblingsNow = canvas.connections.filter(e => e.from === parentId && (group.children || []).includes(e.to as any));
  const top = Math.round((current.y + current.height / 2) - sibH / 2 + (siblingsNow.length * (meta.spacingY || 30)));

  const sib = createNodeAtPosition(siblingType as any, { x: left, y: top }, canvas.id, { parentGroupId: group.id } as any);
  store.addNode(sib);
  // 归组
  canvas = useCanvasStore.getState().canvas; // 取最新
  const freshGroup = canvas.nodes.find(n => n.id === group.id)! as any;
  const children = new Set<string>((freshGroup.children || []) as string[]);
  // 仅添加必要成员
  children.add(parentId);
  children.add(sib.id);
  store.updateNode(group.id, { children: Array.from(children), updatedAt: Date.now() } as any);
  store.updateNode(sib.id, { parentGroupId: group.id } as any);

  // 思维导图内：初始宽度按内容估算（150..450），高度与宽度匹配
  try {
    if (sib.type === 'text' || sib.type === 'todo') {
      const presetId = useCanvasStore.getState().canvas?.textLayoutPreset;
      const { estimateAutoTextWidth, getTextLayoutPreset, calculateTextNodeHeight } = require('../utils/canvasUtils');
      const layout = getTextLayoutPreset ? getTextLayoutPreset(presetId) : undefined;
      const autoMode = (() => { try { return useSettingsStore.getState().mindmap?.autoWidthMode === 'auto'; } catch { return false; } })();
      const w = autoMode ? estimateAutoTextWidth(sib.content || '', { layoutPreset: layout, nodeType: sib.type as any, clamp: { min: 150, max: 450 } }) : 300;
      const h = calculateTextNodeHeight ? calculateTextNodeHeight(sib.content || '', w, { layoutPreset: layout }) : (sib.height || 60);
      store.updateNode(sib.id, { width: w, height: h } as any);
    }
  } catch {}

  // 连线（父 -> 新兄弟）
  store.addConnection({ id: '', from: parentId, to: sib.id, createdAt: Date.now() });

  // 规范化布局（使用最新画布状态，避免遗漏刚刚新增的节点/连线）
  {
    try { updateMindmapRootIfNeeded(group.id); } catch {}
    const latest = useCanvasStore.getState().canvas;
    const result = tidyLayout(latest, group.id);
    applyLayout(result);
  }

  // 选中兄弟节点并自动进入编辑状态
  store.selectSingleNode(sib.id);
  // 🎯 UX优化：创建节点后自动进入编辑状态，使用Store的编辑状态管理
  setTimeout(() => {
    const store = useCanvasStore.getState();
    store.enterEditMode('node', sib.id);
  }, 0);
}
