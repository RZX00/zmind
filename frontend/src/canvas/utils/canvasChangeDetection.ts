/**
 * Canvas变更检测工具函数
 * 优化性能，避免不必要的重渲染
 */

import type { Canvas, CanvasNode } from '../../types/canvas';

/**
 * 优化的Canvas变更检测 - 数值比较替代字符串操作
 * @param currentCanvas 当前Canvas状态
 * @param newCanvas 新的Canvas状态
 * @returns 是否有变更需要更新
 */
export function hasCanvasChanged(currentCanvas: Canvas, newCanvas: Canvas): boolean {
  // 🛡️ 防御性编程：确保对象完整性
  if (!currentCanvas || !newCanvas) {
    console.log('🔍 [hasCanvasChanged] 对象不完整，返回true');
    return true;
  }
  
  // 🛡️ 防御性编程：确保必要属性存在
  if (typeof currentCanvas.updatedAt !== 'number' || typeof newCanvas.updatedAt !== 'number') {
    console.log('🔍 [hasCanvasChanged] 时间戳类型错误，返回true');
    return true;
  }
  
  // 🛡️ 防御性编程：确保节点数组存在
  if (!Array.isArray(currentCanvas.nodes) || !Array.isArray(newCanvas.nodes)) {
    console.log('🔍 [hasCanvasChanged] 节点数组不存在，返回true');
    return true;
  }
  
  // 🚫 移除时间戳快速返回逻辑 - 避免JavaScript时间精度问题导致的状态更新丢失
  // 即使时间戳相同，也要检查节点的实际变化
  // 因为Date.now()精度问题或React批处理可能导致连续操作获得相同时间戳
  // 比较时间戳 - 如果不同则Canvas已变化
  if (currentCanvas.updatedAt !== newCanvas.updatedAt) {
    return true;
  }
  
  // 快速比较节点数量
  if (currentCanvas.nodes.length !== newCanvas.nodes.length) {
    return true;
  }

  // 快速比较连接数量
  const currentConnections = currentCanvas.connections || [];
  const newConnections = newCanvas.connections || [];
  if (currentConnections.length !== newConnections.length) {
    return true;
  }

  // 🚀 优化的节点变更检测 - 预构建索引避免 O(n^2) 查找
  const newNodeMap = new Map<string, CanvasNode>();
  for (const node of newCanvas.nodes) {
    newNodeMap.set(node.id, node);
  }
  for (let i = 0; i < currentCanvas.nodes.length; i++) {
    const current = currentCanvas.nodes[i];
    const newNode = newNodeMap.get(current.id);
    if (!newNode) {
      return true; // 节点不存在
    }

    // 数值比较位置和尺寸
    if (current.x !== newNode.x ||
        current.y !== newNode.y ||
        current.width !== newNode.width ||
        current.height !== newNode.height ||
        current.content !== newNode.content ||
        current.updatedAt !== newNode.updatedAt) {
      return true;
    }
    
    // 比较特定类型字段
    if (current.type !== newNode.type ||
        current.title !== newNode.title ||
        current.locked !== newNode.locked ||
        current.isCollapsed !== newNode.isCollapsed) {
      return true;
    }
    
    // 比较收集栏子节点
    if (current.type === 'column') {
      const currentChildren = current.children || [];
      const newChildren = newNode.children || [];
      if (currentChildren.length !== newChildren.length ||
          !currentChildren.every((id, idx) => newChildren[idx] === id)) {
        return true;
      }
    }
  }
  
  // 🚀 优化的连接变更检测 - 避免排序和字符串拼接
  const newConnectionMap = new Map<string, typeof newConnections[number]>();
  for (const conn of newConnections) {
    newConnectionMap.set(conn.id, conn);
  }
  for (let i = 0; i < currentConnections.length; i++) {
    const current = currentConnections[i];
    const newConn = newConnectionMap.get(current.id);
    
    if (!newConn) return true; // 连接不存在
    
    // 数值比较连接属性
    if (current.from !== newConn.from || 
        current.to !== newConn.to || 
        current.label !== newConn.label) {
      return true;
    }
  }
  
  return false; // 无实质变更
}

/**
 * 优化的Canvas内容哈希生成 - 数值计算替代字符串拼接
 * @param canvas Canvas对象
 * @returns 数值哈希
 */
export function getCanvasHash(canvas: Canvas): number {
  let hash = canvas.updatedAt;
  
  // 节点数值哈希
  for (const node of canvas.nodes) {
    hash ^= hashString(node.id);
    hash += node.x * 31 + node.y * 37 + node.width * 41 + node.height * 43;
    hash ^= hashString(node.content);
    if (node.title) hash ^= hashString(node.title);
  }
  
  // 连接数值哈希
  const connections = canvas.connections || [];
  for (const conn of connections) {
    hash ^= hashString(conn.id);
    hash ^= hashString(conn.from);
    hash ^= hashString(conn.to);
    if (conn.label) hash ^= hashString(conn.label);
  }
  
  return hash;
}

/**
 * 简单字符串哈希函数
 * @param str 字符串
 * @returns 数值哈希
 */
function hashString(str: string): number {
  let hash = 0;
  if (str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转为32位整数
  }
  return hash;
}
