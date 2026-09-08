// 🔗 Canvas Link 节点组件
// 简洁的画布链接器 - 输入画布名称，选择新建或已有画布

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {useTranslations} from 'next-intl';
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Canvas, CanvasNode, FontStyle, NodeStyles } from '../../../../types/canvas';
import { DEFAULT_NODE_SIZES } from '../../../../types/canvas';

type CanvasLinkNodeType = CanvasNode & { type: 'canvas-link' };

interface CanvasLinkNodeProps {
  node: CanvasLinkNodeType;
  editing?: boolean;
  fontStyle?: FontStyle;
  nodeStyles?: NodeStyles;
  onContentChange?: (nodeId: string, content: string) => void;
  onEditToggle?: (nodeId: string, editing: boolean) => void;
  onTitleChange?: (nodeId: string, title: string) => void;
  onNavigate?: (targetCanvasId: string, canvasName?: string) => void;
  onRefreshThumbnail?: (nodeId: string) => void;
  onCreateCanvas?: (name: string) => Promise<string>;
  onGetAvailableCanvases?: () => Promise<Array<{id: string, title: string, lastUpdated: number}>>;
  onSizeChange?: (nodeId: string, size: { width: number; height: number }) => void;
}

export const CanvasLinkNode: React.FC<CanvasLinkNodeProps> = ({
  node,
  editing = false,
  fontStyle,
  nodeStyles,
  onContentChange,
  onEditToggle,
  onTitleChange,
  onNavigate,
  onRefreshThumbnail,
  onCreateCanvas,
  onGetAvailableCanvases,
  onSizeChange
}) => {
  const t = useTranslations();
  const [canvasName, setCanvasName] = useState(node.title || '');
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  // 简化后的CanvasLinkNode只负责显示，编辑通过弹窗处理


  // 简化的取消编辑
  const handleCancel = useCallback(() => {
    setCanvasName(node.title || '');
    onEditToggle?.(node.id, false);
  }, [node.id, node.title, onEditToggle]);

  // 🎯 处理导航 - 双击跳转
  const handleNavigate = useCallback(async (event: React.MouseEvent) => {
    if (editing) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    try {
      const targetId = node.targetCanvasId || node.content; // 兼容旧数据
      
      if (targetId?.trim()) {
        onNavigate?.(targetId);
      } else {
        toast.error('This canvas link is broken. Please delete and recreate it.');
      }
    } catch (error) {
      console.error('Canvas navigation failed:', error);
      toast.error('Canvas navigation failed. Please try again.');
    }
  }, [editing, node.targetCanvasId, node.content, onNavigate]);

  // 🎯 处理右键菜单 - 右键重新选择链接目标
  const handleContextMenu = useCallback(async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    try {
      if (!onGetAvailableCanvases || !onTitleChange) {
        return;
      }
      
      // 触发画布选择界面
      onEditToggle?.(node.id, true);
    } catch (error) {
      console.error('重新选择画布目标失败:', error);
    }
  }, [node.id, onEditToggle, onGetAvailableCanvases, onTitleChange]);

  // ⌨️ 键盘事件处理 - 简化版
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      handleCancel();
    }
  }, [handleCancel]);

  // 🎯 同步外部数据变化
  useEffect(() => {
    setCanvasName(node.title || '');
  }, [node.title]);

  // 首次创建后自动优化一次（之后不会持续干预用户手动调整）
  const didAutoOptimizeRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (!onSizeChange) return;
    if (!node.title) return;
    const def = DEFAULT_NODE_SIZES?.['canvas-link'] || { width: 280, height: 180 };
    const isDefaultSize = Math.abs((node.width || 0) - def.width) < 2 && Math.abs((node.height || 0) - def.height) < 2;
    if (!isDefaultSize) return;
    if (didAutoOptimizeRef.current[node.id]) return;
    const titleEl = titleRef.current;
    const box = containerRef.current;
    const statEl = statusRef.current;
    if (!titleEl || !box) return;
    const raf = requestAnimationFrame(() => {
      try {
        const neededW = Math.ceil(titleEl.scrollWidth);
        const PADDING_X = 24; // 左右最小边距
        const ICON_ROOM = 24; // 右上角图标占位
        const requiredW = neededW + PADDING_X * 2 + ICON_ROOM;
        const currentW = Math.ceil(node.width || box.clientWidth);
        const MAX_W = 800;
        const MIN_W = 200;
        const targetW = Math.max(MIN_W, Math.min(requiredW, MAX_W));

        const titleH = Math.ceil(titleEl.getBoundingClientRect().height || 0);
        const statusH = Math.ceil(statEl?.getBoundingClientRect().height || 12);
        const PADDING_Y = 16; // 上下最小边距
        const requiredH = Math.max(48, titleH + statusH + PADDING_Y * 2);
        const currentH = Math.ceil(node.height || box.clientHeight);
        const MAX_H = 160;
        const targetH = Math.max(48, Math.min(requiredH, MAX_H));

        if (Math.abs(targetW - currentW) > 2 || Math.abs(targetH - currentH) > 2) {
          onSizeChange(node.id, { width: targetW, height: targetH });
        }
        didAutoOptimizeRef.current[node.id] = true;
      } catch {}
    });
    return () => cancelAnimationFrame(raf);
  }, [node.id, node.title, node.width, node.height, onSizeChange]);


  const linkStyles = nodeStyles?.linkStyles || {};

  // 🎨 计算连接状态
  const getConnectionStatus = () => {
    const hasValidTargetId = node.targetCanvasId?.trim();
    const hasValidContent = node.content?.trim();
    const isToBeCreated = node.content && !node.targetCanvasId; // content present but no targetCanvasId means pending creation
    
    if (isToBeCreated) {
      return {
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-500',
        label: 'To be created'
      };
    } else if (hasValidTargetId || hasValidContent) {
      return {
        color: 'text-green-600',
        bgColor: 'bg-green-500',
        label: 'Connected'
      };
    } else {
      return {
        color: 'text-red-500',
        bgColor: 'bg-red-500',
        label: 'Not Connected'
      };
    }
  };

  // 适配深色模式的状态样式
  const statusRaw = getConnectionStatus();
  const status = {
    label: statusRaw.label,
    textClass:
      statusRaw.label === 'Connected'
        ? 'text-green-600 dark:text-green-400'
        : statusRaw.label === 'To be created'
          ? 'text-yellow-600 dark:text-yellow-300'
          : 'text-red-500 dark:text-red-400',
    dotClass:
      statusRaw.label === 'Connected'
        ? 'bg-green-500 dark:bg-green-400'
        : statusRaw.label === 'To be created'
          ? 'bg-yellow-500 dark:bg-yellow-300'
          : 'bg-red-500 dark:bg-red-400',
  };

  return (
    <div 
      className="w-full h-full relative overflow-hidden cursor-pointer group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDoubleClick={handleNavigate}
      onContextMenu={handleContextMenu}
    >
      {/* 🎯 重新布局：左对齐标题 + 右侧状态胶囊，与画布左上角指示器同款样式 */}
      <div
        className="w-full h-full relative flex flex-col justify-center transition-all duration-200 px-4 py-3"
        ref={containerRef}
      >
        {/* 顶部行：左侧链路信息，右侧状态指示 */}
        <div className="flex items-start gap-3 w-full">
          <Link2 className="w-4 h-4 mt-1 text-blue-600 dark:text-blue-300" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <h1
              ref={titleRef}
              className="text-[18px] leading-snug font-semibold text-gray-900 dark:text-gray-50 line-clamp-2 break-words underline decoration-2 underline-offset-4 decoration-blue-500 dark:decoration-blue-300 group-hover:text-blue-600 dark:group-hover:text-blue-300"
              style={{
                fontFamily: fontStyle?.fontFamily,
                fontWeight: fontStyle?.weight || 700,
                fontSize: fontStyle?.size ? `${fontStyle.size}px` : undefined,
                textAlign: 'left'
              }}
              title={node.title || t('canvas.untitled')}
            >
              {node.title || t('canvas.untitled')}
            </h1>
          </div>
        </div>

        {/* 🔗 右侧竖条状态指示（方角竖条，垂直居中，无文字） */}
        <div className="absolute top-1/2 -translate-y-1/2 right-3" ref={statusRef}>
          <div className="flex items-center" title={status.label} aria-label={status.label}>
            <span className={`h-8 w-[4px] ${status.dotClass} rounded-none`} />
          </div>
        </div>
      </div>
    </div>
  );
};

// 默认导出
export default CanvasLinkNode;
