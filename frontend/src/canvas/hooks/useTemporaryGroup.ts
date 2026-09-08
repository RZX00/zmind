// 🎯 临时群组管理Hook

import { useState, useCallback } from 'react';
import type { Canvas, CanvasNode, TemporaryGroup, Position } from '../../types/canvas';
import { calculateGroupBounds, getGroupCenter } from '../components/core/systems/CoordinateSystem';
import { generateId, getCurrentTimestamp } from '../utils/canvasUtils';

// Hook返回接口
export interface UseTemporaryGroupReturn {
  activeGroup: TemporaryGroup | null;
  createGroup: (nodeIds: string[], nodes: CanvasNode[]) => TemporaryGroup | null;
  updateGroupPosition: (delta: Position) => void;
  updateGroupBounds: (nodes: CanvasNode[]) => void;
  commitGroupDrag: (onCommit?: (nodeUpdates: Array<{ nodeId: string, x: number, y: number }>) => void) => void;
  destroyGroup: () => void;
  setGroupDragging: (isDragging: boolean) => void;
  isGroupActive: boolean;
}

/**
 * 🎯 临时群组管理Hook
 * 
 * 提供群组的创建更新销毁等生命周期管理功能
 * 遵循React Hooks朢佳实践，使用useCallback优化性能
 * 
 * @returns 群组管理接口
 */
export const useTemporaryGroup = (): UseTemporaryGroupReturn => {
  const [activeGroup, setActiveGroup] = useState<TemporaryGroup | null>(null);

  /**
   * 🎯 创建群组
   * 
   * 
   * @param nodeIds - 节点ID数组
   * @param nodes - 节点对象数组
   */
  const createGroup = useCallback((nodeIds: string[], nodes: CanvasNode[]): TemporaryGroup | null => {
    if (!nodeIds || nodeIds.length === 0 || !nodes || nodes.length === 0) {
      console.warn('createGroup: invalid node data; cannot create group');
      return null;
    }

    const validNodes = nodes.filter(node => nodeIds.includes(node.id) && (node as any).type !== 'group');
    if (validNodes.length === 0) {
      console.warn('createGroup: 没有找到有效节点');
      return null;
    }

    try {
      // 🎯 计算群组边界
      const bounds = calculateGroupBounds(validNodes);
      
      const pivot = getGroupCenter({ 
        bounds, 
        pivot: { x: 0, y: 0 }, 
        dragOffset: { x: 0, y: 0 },
        id: '',
        nodeIds: new Set(),
        isActive: true,
        createdAt: 0,
        isDragging: false
      });

      // 🎯 创建群组对象
      const group: TemporaryGroup = {
        id: generateId(),
        nodeIds: new Set(nodeIds),
        bounds,
        pivot,
        dragOffset: { x: 0, y: 0 },
        isActive: true,
        createdAt: getCurrentTimestamp(),
        isDragging: false
      };

      setActiveGroup(group);

      return group;
    } catch (error) {
      console.error('createGroup: 群组创建失败:', error);
      return null;
    }
  }, []);

  /**
   * 🎯 更新群组位置（保留接口兼容，但简化实现）
   * 
   */
  const updateGroupPosition = useCallback((delta: Position) => {
    // no-op
  }, []);

  /**
   * 
   * @param isDragging - 是否正在拖拽
   */
  const setGroupDragging = useCallback((isDragging: boolean) => {
    setActiveGroup(prevGroup => {
      if (!prevGroup) {
        return prevGroup;
      }

      return {
        ...prevGroup,
        isDragging
      };
    });
  }, []);

  /**
   * 🎯 更新群组边界
   * 
   * 
   * @param nodes - 更新后的节点数组
   */
  const updateGroupBounds = useCallback((nodes: CanvasNode[]) => {
    setActiveGroup(prevGroup => {
      if (!prevGroup) {
        return prevGroup;
      }

      const groupNodes = nodes.filter(node => prevGroup.nodeIds.has(node.id) && (node as any).type !== 'group');
      if (groupNodes.length === 0) {
        console.warn('updateGroupBounds: no valid nodes found in group');
        return prevGroup;
      }

      try {
        // 🎯 重新计算群组边界
        const newBounds = calculateGroupBounds(groupNodes);
        
        const newPivot = getGroupCenter({ 
          ...prevGroup,
          bounds: newBounds 
        });

        const updatedGroup = {
          ...prevGroup,
          bounds: newBounds,
          pivot: newPivot
        };

        return updatedGroup;
      } catch (error) {
        console.error('updateGroupBounds: 群组边界更新失败:', error);
        return prevGroup;
      }
    });
  }, []);

  /**
   * 🎯 批处理提交群组拖拽（已简化）
   * 
   * 现在群组边界直接跟随节点位置，不再需要复杂的批处理辑
   * 
   */
  const commitGroupDrag = useCallback((onCommit?: (nodeUpdates: Array<{ nodeId: string, x: number, y: number }>) => void) => {
    setActiveGroup(prevGroup => {
      if (!prevGroup) {
        return prevGroup;
      }

      return {
        ...prevGroup,
        dragOffset: { x: 0, y: 0 },
        isDragging: false
      };
    });
  }, []);

  /**
   * 
   * 清理群组状，释放资源
   */
  const destroyGroup = useCallback(() => {
    // 清理群组
    setActiveGroup(null);
  }, []);

  const isGroupActive = activeGroup !== null;

  return {
    activeGroup,
    createGroup,
    updateGroupPosition,
    updateGroupBounds,
    commitGroupDrag,
    destroyGroup,
    setGroupDragging,
    isGroupActive
  };
};

