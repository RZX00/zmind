// 📚 历史记录下拉菜单组件
// 显示最近的画布历史记录，支持快速切换

import React, { useRef, useEffect } from 'react';
import {useFormatter, useTranslations} from 'next-intl';

export interface HistoryItem {
  id: string;
  title?: string;
  previewText?: string;
  timestamp: number;
}

interface HistoryDropdownProps {
  items: HistoryItem[];
  onItemClick: (itemId: string) => void;
  onClose: () => void;
  maxItems?: number;
}

const HistoryDropdown: React.FC<HistoryDropdownProps> = ({
  items,
  onItemClick,
  onClose,
  maxItems = 20
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const format = useFormatter();
  const t = useTranslations();

  // 处理外部点击关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // 处理ESC键关闭
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 格式化时间显示
  const formatTimestamp = (timestamp: number): string => {
    const now = Date.now();
    const diffMs = now - timestamp;
    const secs = Math.floor(diffMs / 1000);
    const mins = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (secs < 60) return format.relativeTime(-Math.max(1, secs), { unit: 'second' });
    if (mins < 60) return format.relativeTime(-mins, { unit: 'minute' });
    if (hours < 24) return format.relativeTime(-hours, { unit: 'hour' });
    if (days < 7) return format.relativeTime(-days, { unit: 'day' });
    return format.dateTime(new Date(timestamp), {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 截断预览文本
  const truncatePreview = (text: string, maxLength: number = 50): string => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  };

  // 显示的历史记录项（按时间倒序，最多显示maxItems个）
  const displayItems = items
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxItems);

  if (displayItems.length === 0) {
    return (
      <div
        ref={dropdownRef}
        className="
          absolute top-full right-0 mt-1 z-50
          min-w-[280px] max-w-[400px]
          bg-card/95 rounded-[var(--canvas-panel-radius)] shadow-lg border border-border/60 backdrop-blur-sm
          py-2
        "
      >
        <div className="px-4 py-3 text-center text-muted-foreground text-sm">
          {t('history.empty')}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={dropdownRef}
      className="
        absolute top-full right-0 mt-1 z-50
        min-w-[280px] max-w-[400px]
        bg-card/95 rounded-[var(--canvas-panel-radius)] shadow-lg border border-border/60 backdrop-blur-sm
        py-2 max-h-[400px] overflow-y-auto
      "
    >
      {/* 标题 */}
      <div className="px-4 py-2 border-b border-border/60">
        <h3 className="text-sm font-medium text-foreground">
          {t('history.title')}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t('history.recentCount', {count: displayItems.length})}
        </p>
      </div>

      {/* 历史记录列表 */}
      <div className="py-1">
        {displayItems.map((item, index) => (
          <button
            key={item.id}
            onClick={() => onItemClick(item.id)}
            className="
              w-full px-4 py-3 text-left
              hover:bg-muted/40 focus:bg-muted/40
              transition-colors duration-150
              focus:outline-none
              border-b border-border/40 last:border-b-0
            "
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                {/* 标题 */}
                <div className="font-medium text-foreground truncate mb-1">
                  {item.title || t('canvas.untitled')}
                </div>
                
                {/* 预览文本 */}
                {item.previewText && (
                  <div className="text-xs text-muted-foreground truncate mb-1">
                    {truncatePreview(item.previewText)}
                  </div>
                )}
                
                {/* 时间戳 */}
                <div className="text-xs text-muted-foreground">
                  {formatTimestamp(item.timestamp)}
                </div>
              </div>

              {/* 序号标记 */}
              <div className="
                flex-shrink-0 w-6 h-6 
                bg-muted/60 text-muted-foreground 
                rounded-full flex items-center justify-center
                text-xs font-medium
              ">
                {index + 1}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* 底部提示 */}
      {items.length > maxItems && (
        <div className="px-4 py-2 border-t border-border/60">
          <p className="text-xs text-muted-foreground text-center">
            {t('history.showing', {max: maxItems, count: items.length})}
          </p>
        </div>
      )}
    </div>
  );
};

export default HistoryDropdown;
