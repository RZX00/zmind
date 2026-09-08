import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Edit, Scissors } from 'lucide-react';
import type { Canvas } from '../../../../types/canvas';
import { groupDataProcessor } from '../../../services/GroupDataProcessor';
import { getMaxDepth, getDefaultGroupColor } from '../../../utils/groupUtils';
import { GROUP_DRAG_THRESHOLD } from './constants';
import { MOTION_MS, MOTION_EASE } from '../../../constants/motion';

interface GroupOverlaysProps {
  canvas: Canvas;
  containerScale: number; // currentZoom / 100
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onGroupDragStart: (e: React.MouseEvent, groupId: string) => void;
  onUngroup: (groupId: string) => void;
  onOpenContextMenu?: (e: React.MouseEvent) => void;
  renameRequestId?: string | null;
  onRenameRequestConsumed?: () => void;
  // Callback to notify parent when editing starts/ends
  onGroupLabelEditingChange?: (groupId: string | null) => void;
}

// 上层：组边框与标签（可交互）
const GroupOverlays: React.FC<GroupOverlaysProps> = ({
  canvas,
  containerScale,
  selectedGroupId,
  onSelectGroup,
  onRenameGroup,
  onGroupDragStart,
  onUngroup,
  onOpenContextMenu,
  renameRequestId,
  onRenameRequestConsumed,
  onGroupLabelEditingChange,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState<string>('');

  // 🎯 使用统一的群组数据处理服务
  const processedGroups = useMemo(() => {
    return groupDataProcessor.processCanvas(canvas);
  }, [canvas]);

  const groupData = useMemo(() => {
    const items = processedGroups.map((group) => {
      const isMindmap = group.isMindmap;
      const defaultColor = getDefaultGroupColor(isMindmap);  // 🎨 使用工具函数获取默认颜色
      const strokeColor = group.node.accentColor || defaultColor;
      return {
        group: group.node,
        rawBounds: group.bounds,
        strokeColor,
        depth: group.depth,
        isMindmap
      };
    });

    // 父浅子深：边框顺序也按深度（子在上）
    items.sort((a, b) => a.depth - b.depth);
    return items;
  }, [processedGroups]);

  const baseStroke = 2 / Math.max(containerScale, 0.01);
  const selectedStroke = 3 / Math.max(containerScale, 0.01);

  const maxDepth = useMemo(() => getMaxDepth(processedGroups), [processedGroups]);

  const handleMouseDown = useCallback((e: React.MouseEvent, groupId: string) => {
    // When any group label is being edited, disable drag/select from label hit area
    if (editingId) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onSelectGroup(groupId);
    // 潜在拖拽检测（超过阈值才启动拖拽），否则视为单击选择
    let started = false;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      if (started) return;
      const dx = Math.abs(ev.clientX - startX);
      const dy = Math.abs(ev.clientY - startY);
      if (Math.sqrt(dx*dx + dy*dy) >= GROUP_DRAG_THRESHOLD) {
        started = true;
        onGroupDragStart(e, groupId);
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
    };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }, [editingId, onSelectGroup, onGroupDragStart]);

  const beginRename = useCallback((group: any) => {
    setEditingId(group.id);
    const firstLine = ((group.content || '').split('\n')[0] || '').trim();
    setTempName(firstLine || group.title || '');
    onGroupLabelEditingChange?.(group.id);
  }, [onGroupLabelEditingChange]);

  const commitRename = useCallback(() => {
    if (editingId && tempName.trim()) {
      onRenameGroup(editingId, tempName.trim());
    }
    if (editingId) {
      onGroupLabelEditingChange?.(null);
    }
    setEditingId(null);
  }, [editingId, tempName, onRenameGroup, onGroupLabelEditingChange]);

  const cancelRename = useCallback(() => {
    if (editingId) {
      onGroupLabelEditingChange?.(null);
    }
    setEditingId(null);
  }, [editingId, onGroupLabelEditingChange]);

  // 点击画布空白处时，自动提交正在编辑的标签
  useEffect(() => {
    if (!editingId) return;
    const handler = (e: MouseEvent) => {
      // 仅当目标不在输入框内时提交
      const target = e.target as HTMLElement;
      if (target && target.tagName.toLowerCase() === 'input') return;
      // 提交并吞掉本次点击，避免同一次点击触发拖拽/选择/平移
      try {
        commitRename();
      } finally {
        try { e.preventDefault(); } catch {}
        try { (e as any).stopImmediatePropagation?.(); } catch {}
        try { e.stopPropagation(); } catch {}
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [editingId, commitRename]);

  // 外部触发重命名请求
  useEffect(() => {
    if (!renameRequestId) return;
    const target = groupData.find(g => g.group.id === renameRequestId);
    if (target) {
      setEditingId(renameRequestId);
      // Use first line as initial value to match beginRename behavior
      const initial = ((target.group.content || '').split('\n')[0] || '').trim();
      setTempName(initial);
      onGroupLabelEditingChange?.(renameRequestId);
      onRenameRequestConsumed?.();
    }
  }, [renameRequestId, groupData, onRenameRequestConsumed, onGroupLabelEditingChange]);

  return (
    <>
      {groupData.map(({ group, rawBounds, strokeColor, depth, isMindmap }) => {
        const selected = selectedGroupId === group.id;
        const borderColor = strokeColor || group.accentColor || '#10B981';
        const base = 8;
        const step = 6;
        const ext = base + (maxDepth - depth) * step;
        const bounds = {
          x: rawBounds.x - ext,
          y: rawBounds.y - ext,
          width: rawBounds.width + ext * 2,
          height: rawBounds.height + ext * 2,
        };
        // 更新：默认让覆盖层不拦截事件，避免阻挡组内节点（含列）的交互。
        // 仅在“标签/动作条”区域启用交互（pointerEvents: 'auto'）。
        const containerPointerEvents = 'none';

        return (
          <div
            key={group.id}
            className="absolute"
            style={{
              left: bounds.x,
              top: bounds.y,
              width: bounds.width,
              height: bounds.height,
              pointerEvents: containerPointerEvents as any,
              transition: isMindmap ? `left ${MOTION_MS}ms ${MOTION_EASE}, top ${MOTION_MS}ms ${MOTION_EASE}, width ${MOTION_MS}ms ${MOTION_EASE}, height ${MOTION_MS}ms ${MOTION_EASE}` : undefined,
              willChange: isMindmap ? 'left, top, width, height' : undefined
            }}
          >
            {/* 边框层（仅显示，事件穿透） */}
            <div
              className="absolute inset-0"
              style={{
                border: `${selected ? selectedStroke : baseStroke}px solid ${borderColor}`,
                borderRadius: 'var(--radius-sm)',
                // 关键：让边框层不拦截事件，避免阻挡组内节点点击
                pointerEvents: 'none',
                cursor: 'default',
                boxShadow: selected ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
                opacity: selected ? 1 : 0.5, // 未选中群组统一弱化边框
                transition: `opacity ${MOTION_MS}ms ${MOTION_EASE}`,
              }}
            />

            {/* 标签（根据深度智能定位避免重叠） */}
            <div
              className="absolute"
              style={{
                left: depth === 0 ? -4 : (4 + depth * 80), // 最外层保持原位，内层向右偏移
                top: -28,
                // 标签始终可点击用于选中/重命名/拖拽
                pointerEvents: 'auto',
              }}
              onMouseDown={(e) => handleMouseDown(e, group.id)}
              onContextMenu={onOpenContextMenu}
            >
              {editingId === group.id ? (
                <input
                  autoFocus
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') cancelRename();
                  }}
                  className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-[#8c8273] text-foreground bg-white/70 dark:bg-[#181a1b]/70"
                  style={{ minWidth: 80 }}
                  title="重命名组"
                />
              ) : (
                <div
                  className="px-2 py-1 text-sm rounded cursor-text select-none text-foreground"
                  style={{ background: 'transparent', border: 'none', boxShadow: 'none' }}
                  onDoubleClick={() => beginRename(group)}
                  title="双击重命名"
                >
                  {((group.content || '').split('\n')[0] || group.title || '')}
                </div>
              )}
            </div>
            {/* 选中组动作条（右上角，仅选中时显示；启用交互） */}
            {selected && (
              <div
                className="absolute flex items-center gap-1 px-2 py-1 text-neutral-900 dark:text-neutral-100 bg-white/90 dark:bg-neutral-900/90 rounded shadow-lg shadow-black/10 dark:shadow-black/40 border border-neutral-200 dark:border-neutral-700 backdrop-blur"
                style={{ right: -4, top: -36, pointerEvents: 'auto' }}
                onContextMenu={onOpenContextMenu}
              >
                <button
                  className="p-1.5 hover:bg-accent/60 rounded"
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                  onClick={(e) => { e.stopPropagation(); beginRename(group); }}
                  title="重命名组"
                >
                  <Edit size={14} />
                </button>
                <button
                  className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                  onClick={(e) => { e.stopPropagation(); onUngroup(group.id); }}
                  title="取消成组"
                >
                  <Scissors size={14} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};

export default GroupOverlays;
