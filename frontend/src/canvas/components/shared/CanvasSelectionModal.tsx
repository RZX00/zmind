// 🎯 Canvas 选择弹窗组件
// 画布内优雅的画布选择界面，支持快速点击选择

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {useTranslations} from 'next-intl';
import { X, Search } from 'lucide-react';

export interface CanvasOption {
  id: string;
  title: string;
  lastUpdated: number;
  thumbnailUrl?: string;
}

export interface CanvasSelectionResult {
  id: string;
  title: string;
  thumbnailUrl?: string;
  isNewCanvas: boolean;
}

interface CanvasSelectionModalProps {
  isVisible: boolean;
  availableCanvases: CanvasOption[];
  onSelect: (result: CanvasSelectionResult) => void;
  onCancel: () => void;
  onCreateCanvas?: (name: string) => Promise<string>;
  loading?: boolean;
  currentNodeTitle?: string; // 当前节点的标题，用于初始化输入框
}

export const CanvasSelectionModal: React.FC<CanvasSelectionModalProps> = ({
  isVisible,
  availableCanvases,
  onSelect,
  onCancel,
  onCreateCanvas,
  loading = false,
  currentNodeTitle = ''
}) => {
  const t = useTranslations();
  const [inputValue, setInputValue] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionListRef = useRef<HTMLDivElement>(null);

  // 🧠 智能匹配逻辑：根据输入状态显示不同内容
  const displayCanvases = useMemo(() => {
    if (!inputValue.trim()) {
      // 空输入时显示所有画布，按最近使用时间排序
      return availableCanvases
        .sort((a, b) => b.lastUpdated - a.lastUpdated); // 显示所有画布，不限制数量
    }
    
    // 有输入时进行模糊搜索
    const searchTerm = inputValue.toLowerCase().trim();
    
    return availableCanvases
      .filter(canvas => {
        const title = typeof canvas.title === 'string' ? canvas.title : String(canvas.title || '');
        return title.toLowerCase().includes(searchTerm);
      })
      .sort((a, b) => {
        // 精确匹配优先，然后按最近使用时间排序
        const aTitle = String(a.title || '').toLowerCase();
        const bTitle = String(b.title || '').toLowerCase();
        const exactMatchA = aTitle === searchTerm;
        const exactMatchB = bTitle === searchTerm;
        
        if (exactMatchA && !exactMatchB) return -1;
        if (!exactMatchA && exactMatchB) return 1;
        return b.lastUpdated - a.lastUpdated;
      }); // 显示所有匹配的画布
  }, [inputValue, availableCanvases]);

  // 🎯 判断当前操作类型
  const actionType = useMemo(() => {
    if (!inputValue.trim()) return 'none';
    
    const exactMatch = displayCanvases.find(canvas => 
      String(canvas.title || '').toLowerCase() === inputValue.toLowerCase().trim()
    );
    
    return exactMatch ? 'link' : 'create';
  }, [inputValue, displayCanvases]);

  // 🎨 动态按钮文案
  const buttonText = useMemo(() => {
    if (!inputValue.trim()) return 'Enter a canvas name';
    
    return actionType === 'link' 
      ? `Link to "${inputValue.trim()}"` 
      : `Create "${inputValue.trim()}"`;
  }, [inputValue, actionType]);

  // 🎯 统一处理确认操作
  const handleConfirm = useCallback(async () => {
    if (!inputValue.trim()) return;
    
    const trimmedInput = inputValue.trim();
    
    try {
      if (actionType === 'link') {
        // 链接到现有画布
        const targetCanvas = displayCanvases.find(canvas => 
          String(canvas.title || '').toLowerCase() === trimmedInput.toLowerCase()
        );
        
        if (targetCanvas) {
          onSelect({
            id: targetCanvas.id,
            title: targetCanvas.title,
            thumbnailUrl: targetCanvas.thumbnailUrl,
            isNewCanvas: false
          });
        }
      } else if (actionType === 'create' && onCreateCanvas) {
        // 创建新画布
        const newCanvasId = await onCreateCanvas(trimmedInput);
        onSelect({
          id: newCanvasId,
          title: trimmedInput,
          isNewCanvas: true
        });
      }
    } catch (error) {
      console.error('操作失败:', error);
    }
  }, [inputValue, actionType, displayCanvases, onSelect, onCreateCanvas]);

  // 🖱️ 处理建议项点击
  const handleSuggestionClick = useCallback((canvas: CanvasOption) => {
    onSelect({
      id: canvas.id,
      title: canvas.title,
      thumbnailUrl: canvas.thumbnailUrl,
      isNewCanvas: false
    });
  }, [onSelect]);

  // ⌨️ 键盘事件处理
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      onCancel();
    } else if (event.key === 'Enter') {
      if (displayCanvases.length > 0 && selectedIndex >= 0) {
        // 选择当前高亮的建议
        const selectedCanvas = displayCanvases[selectedIndex];
        if (selectedCanvas) {
          handleSuggestionClick(selectedCanvas);
        }
      } else {
        // 执行确认操作
        handleConfirm();
      }
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // 方向键导航建议列表
      if (displayCanvases.length > 0) {
        event.preventDefault();
        const maxIndex = displayCanvases.length - 1;
        
        if (event.key === 'ArrowDown') {
          setSelectedIndex(prev => Math.min(prev + 1, maxIndex));
        } else {
          setSelectedIndex(prev => Math.max(prev - 1, 0));
        }
      }
    }
  }, [displayCanvases, selectedIndex, handleSuggestionClick, handleConfirm, onCancel]);

  // 🎯 初始化和焦点管理
  useEffect(() => {
    if (isVisible) {
      // 初始化输入框值
      setInputValue(currentNodeTitle || '');
      // 聚焦到输入框
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select(); // 全选文本便于编辑
      }, 100);
    }
  }, [isVisible, currentNodeTitle]);

  // 🧹 清理状态
  useEffect(() => {
    if (!isVisible) {
      setInputValue('');
      setSelectedIndex(0);
    }
  }, [isVisible]);

  // 🎯 重置选中索引当建议列表变化时
  useEffect(() => {
    setSelectedIndex(0);
  }, [displayCanvases.length]);

  // 📜 自动滚动到选中的建议项
  useEffect(() => {
    if (suggestionListRef.current && displayCanvases.length > 0 && selectedIndex >= 0) {
      const selectedElement = suggestionListRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        });
      }
    }
  }, [selectedIndex, displayCanvases.length]);

  if (!isVisible) return null;

  return (
    <div 
      className="fixed inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      style={{ zIndex: 9999 }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      {/* 🎯 适中的弹窗：比原来小但能容纳更多内容 */}
      <div 
        ref={modalRef}
        className="bg-card rounded-[var(--canvas-panel-radius)] shadow-xl border border-border/60 w-full max-w-lg flex flex-col text-foreground"
        style={{ 
          height: '500px' // 增加高度以容纳更多画布条目
        }}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        {/* 🎯 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-border/60 flex-shrink-0">
          <h2 className="text-lg font-semibold text-foreground">
            {t('canvas.selection.title', { default: 'Select or Create Canvas' })}
          </h2>
          <button
            onClick={onCancel}
            className="p-1.5 hover:bg-muted/60 rounded-full transition-colors"
          >
            <X size={18} className="text-muted-foreground" />
          </button>
        </div>

        {/* 🎯 内容区域 */}
        <div className="flex-1 p-4 flex flex-col overflow-hidden">
          
          {/* 🎯 统一输入框 */}
          <div className="relative mb-3 flex-shrink-0">
            <Search size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-border/60 rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-transparent text-sm text-foreground bg-background placeholder:text-muted-foreground"
              placeholder={t('canvas.selection.placeholder', { default: 'Enter canvas name...' })}	
            />
          </div>

          {/* 🎯 画布列表 - 空输入时显示所有，有输入时显示匹配项 */}
          {displayCanvases.length > 0 && (
            <div ref={suggestionListRef} className="flex-1 overflow-y-auto mb-3">
              <div className="space-y-1">
                {/* 🎯 显示提示标题 */}
                {!inputValue.trim() && (
                  <div className="text-xs text-muted-foreground mb-2 px-1">
                    {t('canvas.selection.recent', {default: 'Recently used canvases'})}
                  </div>
                )}
                {displayCanvases.map((canvas, index) => (
                  <button
                    key={canvas.id}
                    onClick={() => handleSuggestionClick(canvas)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full p-2.5 rounded-lg text-left text-sm ${
                      selectedIndex === index
                        ? 'bg-accent/60' 
                        : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate text-foreground">
                        {String(canvas.title || t('canvas.untitled'))}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                        {!inputValue.trim() ? t('canvas.selection.clickToLink', {default: 'Click to link'}) : t('canvas.selection.exists', {default: 'Exists'})}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 🎯 动态确认按钮 */}
          <div className="flex-shrink-0">
            <button
              onClick={handleConfirm}
              disabled={!inputValue.trim() || loading}
              className={`w-full py-2.5 px-4 rounded-lg font-medium text-sm transition-colors ${
                !inputValue.trim()
                  ? 'bg-muted text-muted-foreground cursor-not-allowed'
                  : actionType === 'link'
                  ? 'bg-foreground text-background hover:bg-foreground/90'
                  : 'bg-brand-600 hover:bg-brand-700 text-white'
              }`}
            >
              {loading ? t('common.processing', {default: 'Processing...'}) : buttonText}
            </button>
          </div>
        </div>

        {/* 🎯 底部提示 */}
        <div className="px-4 py-2 border-t border-border/60 bg-muted/30 flex-shrink-0">
          <div className="text-xs text-muted-foreground text-center">
            {displayCanvases.length > 0 && (
              <span>{t('canvas.selection.hintArrows', {default: '↑↓ to select'})} • </span>
            )}
            <span>{t('canvas.selection.hintConfirm', {default: 'Enter to confirm • ESC to cancel'})}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CanvasSelectionModal;
