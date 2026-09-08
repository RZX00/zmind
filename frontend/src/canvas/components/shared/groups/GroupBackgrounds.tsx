import React, { useMemo, useCallback } from 'react';
import type { Canvas } from '../../../../types/canvas';
import { hexToRgba } from '../../../utils/colorUtils';
import { groupDataProcessor, getMaxDepth } from '../../../services/GroupDataProcessor';
import { MOTION_MS, MOTION_EASE } from '../../../constants/motion';
import { GROUP_DRAG_THRESHOLD } from './constants';

interface GroupBackgroundsProps {
  canvas: Canvas;
  onSelectGroup?: (groupId: string | null) => void;
  onGroupDragStart?: (e: React.MouseEvent, groupId: string) => void;
  // When a group label is being edited, lock that group's drag interactions
  lockedGroupId?: string | null;
}

// 下层：组背景（接收空白区域交互：选中与拖拽）
const GroupBackgrounds: React.FC<GroupBackgroundsProps> = ({ canvas, onSelectGroup, onGroupDragStart, lockedGroupId = null }) => {
  // 🎯 使用统一的群组数据处理服务
  const processedGroups = useMemo(() => {
    return groupDataProcessor.processCanvas(canvas);
  }, [canvas]);

  // 🎯 计算最大深度用于分层外扩
  const maxDepth = useMemo(() => getMaxDepth(processedGroups), [processedGroups]);

  const handleBackgroundMouseDown = useCallback((e: React.MouseEvent, groupId: string) => {
    // If any group label is being edited, disable drag/select on all group backgrounds
    if (lockedGroupId) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onSelectGroup?.(groupId);

    // 启动拖拽（移动超过阈值再触发），否则仅作为选中
    let started = false;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      if (started) return;
      const dx = Math.abs(ev.clientX - startX);
      const dy = Math.abs(ev.clientY - startY);
      if (Math.sqrt(dx * dx + dy * dy) >= GROUP_DRAG_THRESHOLD) {
        started = true;
        onGroupDragStart?.(e, groupId);
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
    };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }, [onSelectGroup, onGroupDragStart, lockedGroupId]);

  return (
    <>
      {processedGroups.map(group => {
        const base = 8;
        const step = 6;
        const ext = base + (maxDepth - group.depth) * step;
        const bounds = group.bounds;
        const isMindmap = group.isMindmap;
        return (
          <div
            key={group.id}
            className="absolute"
            style={{
              left: bounds.x - ext,
              top: bounds.y - ext,
              width: bounds.width + ext * 2,
              height: bounds.height + ext * 2,
              background: hexToRgba(group.color, group.opacity),
              borderRadius: 'var(--radius-sm)',
              zIndex: 0,
              // 保持与普通群组一致：允许左键拖拽移动群组
              pointerEvents: 'auto',
              transition: isMindmap ? `left ${MOTION_MS}ms ${MOTION_EASE}, top ${MOTION_MS}ms ${MOTION_EASE}, width ${MOTION_MS}ms ${MOTION_EASE}, height ${MOTION_MS}ms ${MOTION_EASE}` : undefined,
              willChange: isMindmap ? 'left, top, width, height' : undefined
            }}
            onMouseDown={(e) => handleBackgroundMouseDown(e, group.id)}
          />
        );
      })}
    </>
  );
};

export default GroupBackgrounds;
