import type { Canvas, CanvasNode, NodeType } from '../../../../types/canvas';
import { updateNode, autoResizeTextNodeHeight } from '../../../utils/canvasUtils';

// 📐 列布局引擎：按 children 顺序栈式布局（x/width 固定，y 逐项累加）
export function applyColumnLayout(srcCanvas: Canvas, columnId: string): Canvas {
  const column = srcCanvas.nodes.find((n) => n.id === columnId);
  if (!column || column.type !== 'column') return srcCanvas;
  const paddingX = 16;
  const paddingY = 16;
  const headerHeight = 60;
  const itemSpacing = 8;
  const contentX = column.x + paddingX;
  const contentWidth = Math.max(80, column.width - paddingX * 2);
  let cursorY = column.y + headerHeight + paddingY;

  const now = Date.now();
  const childIds = (column.children || []).slice();
  const updatedNodes = srcCanvas.nodes.map((node) => {
    const idx = childIds.indexOf(node.id);
    if (idx !== -1) {
      const h = Math.max(node.height || 0, 1);
      const newNode = updateNode(node, { x: contentX, y: cursorY, width: contentWidth });
      cursorY += h + itemSpacing;
      return newNode;
    }
    return node;
  });
  // 计算列应有的最小高度（与 NodeContainer 逻辑对齐）
  const childNodes = childIds
    .filter(Boolean)
    .map((id) => updatedNodes.find((n) => n.id === id))
    .filter((n): n is CanvasNode => !!n);
  const childCount = childNodes.length;
  const emptyStateHeight = 64;
  const contentHeight = childCount > 0
    ? childNodes.reduce((sum, c) => sum + Math.max((c.height || 0), 1), 0) + (childCount - 1) * itemSpacing
    : emptyStateHeight;
  const minHeight = headerHeight + paddingY * 2 + contentHeight;
  const desiredHeight = (column as any).isCollapsed
    ? headerHeight
    : Math.max(minHeight, headerHeight);

  const nodesWithColumn = updatedNodes.map((n) =>
    n.id === column.id ? ({ ...n, height: desiredHeight, updatedAt: now } as CanvasNode) : n
  );

  return { ...srcCanvas, nodes: nodesWithColumn, updatedAt: now };
}

// 🧮 计算插入索引（基于“横线在子项正下方”的直觉）
// 规则：
// - 候选位置为每个子项的“底部”之后（即 index = i+1）
// - 指针 Y 与各子项底部比较，落入该子项底部附近则返回 i+1
// - 若小于第一个底部，返回 1；若大于最后一个底部，返回 children.length
export function computeInsertionIndex(column: CanvasNode, children: CanvasNode[], pointerY: number): number {
  if (!children || children.length === 0) return 0; // 空列：插入到开头（首个槽位）

  let lastBottom = -Infinity;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;
    const h = Math.max(child.height || 0, 1);
    const bottom = child.y + h; // 子项底部
    if (i === 0 && pointerY <= bottom) {
      return 1;
    }
    if (pointerY <= bottom && pointerY >= lastBottom) {
      return i + 1;
    }
    lastBottom = bottom;
  }
  return children.length;
}

// 🎯 收集栏内子项尺寸自适应（复用现有逻辑）
// - 文本/待办：按内容与当前列宽自动计算所需高度
// - Canvas Link：使用固定估算高度区间（与上下文菜单保持一致）
// - 媒体图片：按原始宽高比在新列宽下换算高度
// 说明：仅调整高度；宽度由 applyColumnLayout 统一设置为列内容宽度
export function adjustNodeSizeForColumn(
  srcCanvas: Canvas,
  nodeId: string,
  prevNode?: CanvasNode | null,
): Canvas {
  const idx = srcCanvas.nodes.findIndex((n) => n.id === nodeId);
  if (idx === -1) return srcCanvas;

  const node = srcCanvas.nodes[idx];
  const now = Date.now();

  let newHeight: number | null = null;

  if (node.type === 'text' || node.type === 'todo') {
    const content = node.content || '';
    const width = Math.max(1, node.width);
    try {
      newHeight = autoResizeTextNodeHeight(content, width);
    } catch {
      // ignore measure errors
      newHeight = null;
    }
  } else if (node.type === 'canvas-link') {
    // 与上下文菜单估算保持一致
    const PADDING_Y = 16;
    const TITLE_H = 32;
    const STATUS_H = 18;
    const MIN_H = 48;
    const MAX_H = 160;
    const requiredH = Math.max(MIN_H, TITLE_H + STATUS_H + PADDING_Y * 2);
    newHeight = Math.max(MIN_H, Math.min(requiredH, MAX_H));
  } else if (node.type === 'media') {
    const n: any = node as any;
    if (n.mediaType === 'image') {
      const base = prevNode || node;
      const baseW = Math.max(1, base.width);
      const baseH = Math.max(1, base.height);
      const aspect = baseH / baseW;
      const width = Math.max(1, node.width);
      newHeight = Math.max(1, Math.round(width * aspect));
    }
  }

  if (newHeight !== null && newHeight !== node.height) {
    const updated = updateNode(node, { height: newHeight });
    const nodes = srcCanvas.nodes.slice();
    nodes[idx] = { ...updated, updatedAt: now } as CanvasNode;
    return { ...srcCanvas, nodes, updatedAt: now };
  }

  return srcCanvas;
}
