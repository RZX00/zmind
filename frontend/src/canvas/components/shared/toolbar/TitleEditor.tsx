// 🏷️ 画布标题编辑器组件
// 支持双击编辑、自动保存、失焦保存功能

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { DEFAULT_CANVAS_TITLE } from '@/canvas/constants';
import {useTranslations} from 'next-intl';

interface TitleEditorProps {
  title: string;
  onTitleChange: (title: string) => void;
  onTitleClick?: () => void; // 新增：单击标题的回调
  placeholder?: string;
  maxLength?: number;
  className?: string;
}

const TitleEditor: React.FC<TitleEditorProps> = ({
  title,
  onTitleChange,
  onTitleClick,
  placeholder = DEFAULT_CANVAS_TITLE,
  maxLength = 50,
  className = ''
}) => {
  const t = useTranslations();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const [wasDoubleClick, setWasDoubleClick] = useState(false);
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 显示的标题（为空时显示占位符）
  const safeTitle = typeof title === 'string' ? title : t('canvas.untitled');
  const displayTitle = safeTitle.trim() || placeholder;

  // 进入编辑模式
  const enterEditMode = useCallback(() => {
    setIsEditing(true);
    setEditValue(safeTitle);
    // 延迟聚焦，确保DOM已更新
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 0);
  }, [safeTitle]);

  // 退出编辑模式并保存
  const exitEditMode = useCallback((save: boolean = true) => {
    if (!isEditing) return;
    
    setIsEditing(false);
    
    if (save) {
      const trimmedValue = editValue.trim();
      if (trimmedValue !== title) {
        onTitleChange(trimmedValue);
      }
    } else {
      // 取消编辑，恢复原值
      setEditValue(title);
    }
  }, [isEditing, editValue, title, onTitleChange]);

  // 处理单击事件（区分单击和双击）
  const handleClick = useCallback((e: React.MouseEvent) => {
    // 如果已经在编辑模式，不处理点击
    if (isEditing) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // 清除之前的定时器
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    
    // 设置单击延迟，如果300ms内没有双击，则触发单击事件
    clickTimerRef.current = setTimeout(() => {
      if (!wasDoubleClick) {
        onTitleClick?.();
      }
      setWasDoubleClick(false);
    }, 300);
  }, [isEditing, onTitleClick, wasDoubleClick]);

  // 处理双击事件
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setWasDoubleClick(true);
    
    // 清除单击定时器
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    
    enterEditMode();
  }, [enterEditMode]);

  // 处理输入变化
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value.length <= maxLength) {
      setEditValue(value);
    }
  }, [maxLength]);

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      exitEditMode(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      exitEditMode(false);
    }
  }, [exitEditMode]);

  // 处理失焦事件
  const handleBlur = useCallback(() => {
    // 避免双击时立即失焦
    if (wasDoubleClick) {
      setWasDoubleClick(false);
      return;
    }
    exitEditMode(true);
  }, [exitEditMode, wasDoubleClick]);

  // 监听外部点击，退出编辑模式
  useEffect(() => {
    if (!isEditing) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(event.target as Node)) {
        exitEditMode(true);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEditing, exitEditMode]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  // 同步外部title变化
  useEffect(() => {
    if (!isEditing) {
      setEditValue(title);
    }
  }, [title, isEditing]);

  if (isEditing) {
    return (
      <div className={`flex items-center ${className}`}>
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className="
            px-3 py-1.5 text-lg font-medium text-gray-800 dark:text-zinc-100
            bg-white dark:bg-zinc-900 border-2 border-blue-500 dark:border-blue-400 rounded-lg
            font-serif
            outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900
            min-w-0 flex-1 text-center
            transition-all duration-200
          "
          placeholder={placeholder}
          maxLength={maxLength}
          spellCheck={false}
        />
        
        {/* 字符计数提示 */}
        {maxLength && editValue.length > maxLength * 0.8 && (
          <span className="
            ml-2 text-xs text-gray-500 dark:text-zinc-400
            flex-shrink-0
          ">
            {editValue.length}/{maxLength}
          </span>
        )}
      </div>
    );
  }

  return (
    <div 
      className={`
        flex items-center justify-center cursor-pointer
        ${className}
      `}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={t('canvas.titleEditor.hint', { default: 'Click to open file manager, double‑click to edit title' })}
    >
      <h1 className="
        px-3 py-1.5 text-lg font-medium text-gray-800 dark:text-zinc-100
        hover:bg-accent/40 rounded-lg
        transition-colors duration-200
        truncate max-w-full
        select-none
        font-serif
      ">
        {displayTitle}
      </h1>
    </div>
  );
};

export default TitleEditor;
