/**
 * 🎯 画布坐标转换系统
 * 
 * 这个模块提供纯函数的坐标转换和碰撞检测功能，从InfiniteCanvas.tsx中提取
 * 所有函数都是纯函数，没有副作用，便于测试和复用
 */

import type { CanvasNode, TemporaryGroup, GroupBounds } from '../../../../types/canvas';

// ==================== 类型定义 ====================

/**
 * 画布边界信息
 */
export interface CanvasBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * 变换状态（缩放、平移）
 */
export interface TransformState {
  scale: number;
  positionX: number;
  positionY: number;
}

/**
 * 坐标位置
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * 容器边界信息
 */
export interface ContainerBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

// ==================== 核心函数 ====================

/**
 * 计算画布的实际边界
 * 
 * 基于所有节点的位置和尺寸计算画布的最小包围矩形，
 * 并添加padding以确保有足够的空间进行拖拽操作
 * 
 * @param nodes - 画布节点数组
 * @param padding - 边界填充距离，默认2000
 * @returns 画布边界信息
 */
export function calculateCanvasBounds(
  nodes: CanvasNode[], 
  padding: number = 2000
): CanvasBounds {
  // 🛡️ 安全检查：如果没有节点，返回默认边界
  if (!nodes || nodes.length === 0) {
    return {
      minX: -5000,
      minY: -5000,
      maxX: 5000,
      maxY: 5000,
      width: 10000,
      height: 10000
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // 🎯 遍历所有节点，计算最小包围矩形
  nodes.forEach(node => {
    const nodeMinX = node.x;
    const nodeMinY = node.y;
    const nodeMaxX = node.x + node.width;
    const nodeMaxY = node.y + node.height;

    minX = Math.min(minX, nodeMinX);
    minY = Math.min(minY, nodeMinY);
    maxX = Math.max(maxX, nodeMaxX);
    maxY = Math.max(maxY, nodeMaxY);
  });

  // 🎯 添加边距以确保有足够的空间拖拽
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

/**
 * 屏幕坐标转换为画布坐标（纯几何变换）
 * 
 * 🎯 行业标准的坐标转换：只进行纯几何变换，不涉及任何内容边界
 * 遵循数学变换的基本原理：先减去容器偏移，再应用逆缩放变换
 * 
 * @param screenX - 屏幕X坐标
 * @param screenY - 屏幕Y坐标
 * @param containerBounds - 容器边界信息
 * @param transform - 变换状态
 * @returns 画布坐标位置
 */
export function screenToCanvasCore(
  screenX: number,
  screenY: number,
  containerBounds: ContainerBounds,
  transform: TransformState
): Position {
  // 🎯 第一步：转换为容器相对坐标
  const relativeX = screenX - containerBounds.left;
  const relativeY = screenY - containerBounds.top;

  // 🎯 第二步：应用反向变换（缩放和平移）
  // 这就是完整且正确的坐标转换公式！
  const canvasX = (relativeX - transform.positionX) / transform.scale;
  const canvasY = (relativeY - transform.positionY) / transform.scale;

  return { x: canvasX, y: canvasY };
}

/**
 * 画布坐标转换为屏幕坐标（反向几何变换）
 * 
 * 将画布坐标系下的坐标转换为屏幕坐标
 * 这是screenToCanvasCore的完全反向操作
 * 
 * @param canvasX - 画布X坐标
 * @param canvasY - 画布Y坐标
 * @param containerBounds - 容器边界信息
 * @param transform - 变换状态
 * @returns 屏幕坐标位置
 */
export function canvasToScreenCore(
  canvasX: number,
  canvasY: number,
  containerBounds: ContainerBounds,
  transform: TransformState
): Position {
  // 🎯 第一步：应用正向变换（缩放和平移）
  const relativeX = canvasX * transform.scale + transform.positionX;
  const relativeY = canvasY * transform.scale + transform.positionY;

  // 🎯 第二步：转换为屏幕坐标
  const screenX = relativeX + containerBounds.left;
  const screenY = relativeY + containerBounds.top;

  return { x: screenX, y: screenY };
}

/**
 * 检查选择框与节点的碰撞检测
 * 
 * 使用相交模式：节点矩形与选择框有任何重叠就算选中
 * 这是框选功能的核心算法
 * 
 * @param startX - 选择框开始X坐标
 * @param startY - 选择框开始Y坐标
 * @param endX - 选择框结束X坐标
 * @param endY - 选择框结束Y坐标
 * @param nodes - 要检测的节点数组
 * @returns 选中的节点ID集合
 */
export function getNodesInSelectionBox(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  nodes: CanvasNode[]
): Set<string> {
  // 🎯 标准化选择框坐标（处理反向拖拽）
  const minX = Math.min(startX, endX);
  const minY = Math.min(startY, endY);
  const maxX = Math.max(startX, endX);
  const maxY = Math.max(startY, endY);

  const selectedNodes = new Set<string>();

  // 🎯 遍历所有节点进行碰撞检测
  nodes.forEach(node => {
    // 📦 计算节点边界
    const nodeLeft = node.x;
    const nodeTop = node.y;
    const nodeRight = node.x + node.width;
    const nodeBottom = node.y + node.height;

    // 🎯 相交检测：使用分离轴定理的否定形式
    // 如果两个矩形不相交，则它们在X或Y轴上分离
    const isIntersecting = !(
      nodeRight < minX ||   // 节点在选择框左边
      nodeLeft > maxX ||    // 节点在选择框右边
      nodeBottom < minY ||  // 节点在选择框上边
      nodeTop > maxY        // 节点在选择框下边
    );

    if (isIntersecting) {
      selectedNodes.add(node.id);
    }
  });

  return selectedNodes;
}

/**
 * 网格对齐功能
 * 
 * 将给定的坐标对齐到最近的网格点上，用于精确定位和布局
 * 
 * @param x - X坐标
 * @param y - Y坐标
 * @param gridSize - 网格大小，默认为20px
 * @returns 对齐后的坐标位置
 */
export function snapToGrid(
  x: number,
  y: number,
  gridSize: number = 20
): Position {
  // 🎯 对齐到最近的网格点
  const snappedX = Math.round(x / gridSize) * gridSize;
  const snappedY = Math.round(y / gridSize) * gridSize;

  return { x: snappedX, y: snappedY };
}

// ==================== 辅助函数 ====================

/**
 * 验证变换状态的有效性
 * 
 * @param transform - 变换状态
 * @returns 是否有效
 */
export function isValidTransform(transform: any): transform is TransformState {
  return (
    transform &&
    typeof transform.scale === 'number' &&
    typeof transform.positionX === 'number' &&
    typeof transform.positionY === 'number' &&
    transform.scale > 0
  );
}

/**
 * 验证容器边界的有效性
 * 
 * @param bounds - 容器边界
 * @returns 是否有效
 */
export function isValidContainerBounds(bounds: any): bounds is ContainerBounds {
  return (
    bounds &&
    typeof bounds.left === 'number' &&
    typeof bounds.top === 'number' &&
    typeof bounds.width === 'number' &&
    typeof bounds.height === 'number'
  );
}

/**
 * 创建默认的变换状态
 * 
 * @returns 默认变换状态
 */
export function createDefaultTransform(): TransformState {
  return {
    scale: 1,
    positionX: 0,
    positionY: 0
  };
}

/**
 * 创建默认的容器边界
 * 
 * @returns 默认容器边界
 */
export function createDefaultContainerBounds(): ContainerBounds {
  return {
    left: 0,
    top: 0,
    width: 1200,
    height: 800
  };
}

// ==================== 导出所有功能 ====================

const CoordinateSystem = {
  // 核心函数
  calculateCanvasBounds,
  screenToCanvasCore,
  canvasToScreenCore,
  getNodesInSelectionBox,
  snapToGrid,
  
  // 辅助函数
  isValidTransform,
  isValidContainerBounds,
  createDefaultTransform,
  createDefaultContainerBounds
};

export default CoordinateSystem;

/**
 * 🎯 使用示例：
 * 
 * ```typescript
 * import { 
 *   calculateCanvasBounds,
 *   screenToCanvasCore,
 *   getNodesInSelectionBox,
 *   snapToGrid
 * } from './CoordinateSystem';
 * 
 * // 计算画布边界
 * const bounds = calculateCanvasBounds(nodes);
 * 
 * // 坐标转换
 * const canvasPos = screenToCanvasCore(
 *   mouseX, mouseY, 
 *   containerBounds, 
 *   transform, 
 *   bounds
 * );
 * 
 * // 框选检测
 * const selected = getNodesInSelectionBox(
 *   startX, startY, endX, endY, 
 *   visibleNodes
 * );
 * 
 * // 网格对齐
 * const alignedPos = snapToGrid(dragX, dragY, 25);
 * 
 * // 群组边界计算
 * const groupBounds = calculateGroupBounds(selectedNodes);
 * 
 * // 群组坐标转换
 * const updatedGroup = transformGroupPosition(group, { x: 10, y: 20 });
 * ```
 */

// ==================== 群组功能扩展 ====================

/**
 * 🎯 计算群组边界
 * 
 * 基于一组节点计算统一的群组边界框，复用现有的calculateCanvasBounds逻辑
 * 专用于群组拖拽功能，提供精确的边界信息
 * 
 * @param nodes - 群组内的节点数组
 * @returns 群组边界信息
 */
export function calculateGroupBounds(nodes: CanvasNode[]): GroupBounds {
  // 🛡️ 安全检查：如果没有节点，返回默认边界
  if (!nodes || nodes.length === 0) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0
    };
  }

  // 🎯 复用现有calculateCanvasBounds逻辑，padding设为0以获得精确边界
  const bounds = calculateCanvasBounds(nodes, 0);
  
  return {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.width,
    height: bounds.height,
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY
  };
}

/**
 * 🎯 群组位置变换
 * 
 * 应用位置偏移到群组，更新群组的边界和锚点信息
 * 纯函数实现，返回新的群组对象而不修改原对象
 * 
 * @param group - 原始群组对象
 * @param delta - 位置偏移量
 * @returns 更新后的群组对象
 */
export function transformGroupPosition(
  group: TemporaryGroup,
  delta: Position
): TemporaryGroup {
  // 🛡️ 安全检查
  if (!group || !delta) {
    return group;
  }

  // 🎯 计算新的边界
  const newBounds: GroupBounds = {
    x: group.bounds.x + delta.x,
    y: group.bounds.y + delta.y,
    width: group.bounds.width,
    height: group.bounds.height,
    minX: group.bounds.minX + delta.x,
    minY: group.bounds.minY + delta.y,
    maxX: group.bounds.maxX + delta.x,
    maxY: group.bounds.maxY + delta.y
  };

  // 🎯 计算新的锚点位置
  const newPivot: Position = {
    x: group.pivot.x + delta.x,
    y: group.pivot.y + delta.y
  };

  // 🎯 累积拖拽偏移量
  const newDragOffset: Position = {
    x: group.dragOffset.x + delta.x,
    y: group.dragOffset.y + delta.y
  };

  // 🎯 返回新的群组对象（纯函数，无副作用）
  return {
    ...group,
    bounds: newBounds,
    pivot: newPivot,
    dragOffset: newDragOffset
  };
}

/**
 * 🎯 检查点是否在群组边界内
 * 
 * 用于群组拖拽的点击检测，判断鼠标点击是否在群组边界框内
 * 
 * @param point - 检测点坐标
 * @param group - 群组对象
 * @returns 是否在边界内
 */
export function isPointInGroupBounds(point: Position, group: TemporaryGroup): boolean {
  if (!point || !group || !group.bounds) {
    return false;
  }

  const { bounds } = group;
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/**
 * 🎯 计算群组的中心点
 * 
 * 基于群组边界计算几何中心点，用于群组操作的锚点定位
 * 
 * @param group - 群组对象
 * @returns 中心点坐标
 */
export function getGroupCenter(group: TemporaryGroup): Position {
  if (!group || !group.bounds) {
    return { x: 0, y: 0 };
  }

  const { bounds } = group;
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  };
}

/**
 * 🎯 重置群组拖拽偏移
 * 
 * 将群组的拖拽偏移重置为零，用于拖拽结束后的状态清理
 * 
 * @param group - 原始群组对象
 * @returns 重置偏移后的群组对象
 */
export function resetGroupDragOffset(group: TemporaryGroup): TemporaryGroup {
  if (!group) {
    return group;
  }

  return {
    ...group,
    dragOffset: { x: 0, y: 0 },
    isDragging: false
  };
}
