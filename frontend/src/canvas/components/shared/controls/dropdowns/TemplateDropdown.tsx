// 📋 增强模板选择器组件
// 支持预览、加载状态、搜索筛选和性能统计

import React, { useRef, useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import { Search, Eye, Clock, TrendingUp, Loader2, Star } from 'lucide-react';

export interface TemplateItem {
  id: string;
  title: string;
  description?: string;
  category?: string;
  thumbnail?: string;
  previewImage?: string;
  nodeCount?: number;
  popularity?: number;
  createdAt?: number;
  updatedAt?: number;
}

// Mock template data function
const getTemplateData = (templateId: string) => ({
  id: templateId,
  title: 'Template',
  description: 'Template description',
  data: null
});

interface TemplateDropdownProps {
  items: TemplateItem[];
  onItemClick: (templateId: string) => void;
  onClose: () => void;
  maxItems?: number;
  showPreview?: boolean;
  enableSearch?: boolean;
}

const TemplateDropdown: React.FC<TemplateDropdownProps> = ({
  items,
  onItemClick,
  onClose,
  maxItems = 10,
  showPreview = true,
  enableSearch = true
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);

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

  // 搜索过滤
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    
    const query = searchQuery.toLowerCase();
    return items.filter(item => 
      item.title.toLowerCase().includes(query) ||
      (item.description && item.description.toLowerCase().includes(query)) ||
      (item.category && item.category.toLowerCase().includes(query))
    );
  }, [items, searchQuery]);

  // 按分类分组模板
  const groupedTemplates = filteredItems.reduce((acc, item) => {
    const category = item.category || '其他';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(item);
    return acc;
  }, {} as Record<string, TemplateItem[]>);

  // 显示的模板项
  const displayItems = filteredItems.slice(0, maxItems);

  // 模板预览处理
  const handleTemplatePreview = async (templateId: string) => {
    if (!showPreview) return;
    
    setSelectedTemplate(templateId);
    try {
      const templateData = getTemplateData(templateId);
      setPreviewData(templateData);
    } catch (error) {
      console.error('加载模板预览失败:', error);
    }
  };

  // 模板加载处理
  const handleTemplateSelect = async (templateId: string) => {
    setLoadingTemplate(templateId);
    try {
      await new Promise(resolve => setTimeout(resolve, 500)); // 模拟加载延迟
      onItemClick(templateId);
    } catch (error) {
      console.error('加载模板失败:', error);
    } finally {
      setLoadingTemplate(null);
    }
  };

  if (displayItems.length === 0) {
    return (
      <div
        ref={dropdownRef}
        className="
          absolute top-full right-0 mt-1 z-50
          min-w-[320px] max-w-[450px]
          bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-gray-200 dark:border-zinc-700
          py-2
        "
      >
        <div className="px-4 py-3 text-center text-gray-500 dark:text-zinc-400 text-sm">
          暂无可用模板
        </div>
      </div>
    );
  }

  return (
    <div
      ref={dropdownRef}
      className="
        absolute top-full right-0 mt-1 z-50
        min-w-[400px] max-w-[600px]
        bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-gray-200 dark:border-zinc-700
        max-h-[500px] overflow-hidden flex flex-col
      "
    >
      {/* 标题和搜索 */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-800 dark:text-zinc-100 flex items-center gap-2">
            <Star className="w-4 h-4 text-yellow-500" />
            官方模板库
          </h3>
          <div className="text-xs text-gray-500 dark:text-zinc-400">
            {filteredItems.length} 个模板
          </div>
        </div>
        
        {enableSearch && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-zinc-500" />
            <input
              type="text"
              placeholder="搜索模板..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        )}
      </div>

      {/* 模板列表 */}
      <div className="flex-1 overflow-y-auto">
        {Object.keys(groupedTemplates).length > 1 ? (
          // 有多个分类时，按分类显示
          Object.entries(groupedTemplates).map(([category, templates]) => (
            <div key={category}>
              {/* 分类标题 */}
              <div className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-zinc-300 bg-gray-50 dark:bg-zinc-800/70 border-b border-gray-100 dark:border-zinc-700">
                {category}
              </div>
              
              {/* 该分类下的模板 */}
              {templates.map((item) => (
                <EnhancedTemplateItem
                  key={item.id}
                  item={item}
                  isSelected={selectedTemplate === item.id}
                  isLoading={loadingTemplate === item.id}
                  onPreview={() => handleTemplatePreview(item.id)}
                  onClick={() => handleTemplateSelect(item.id)}
                  showPreview={showPreview}
                />
              ))}
            </div>
          ))
        ) : (
          // 只有一个分类时，直接显示模板
          displayItems.map((item) => (
            <EnhancedTemplateItem
              key={item.id}
              item={item}
              isSelected={selectedTemplate === item.id}
              isLoading={loadingTemplate === item.id}
              onPreview={() => handleTemplatePreview(item.id)}
              onClick={() => handleTemplateSelect(item.id)}
              showPreview={showPreview}
            />
          ))
        )}
      </div>

      {/* 预览面板 */}
      {showPreview && selectedTemplate && previewData && (
        <div className="border-t border-gray-100 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/60 p-3">
          <div className="text-xs font-medium text-gray-700 dark:text-zinc-200 mb-2 flex items-center gap-2">
            <Eye className="w-3 h-3" />
            模板预览
          </div>
          <div className="text-xs text-gray-600 dark:text-zinc-300 space-y-1">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-3 h-3" />
              <span>{previewData.nodes?.length || 0} 个节点</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3" />
              <span>预计加载时间: {Math.ceil((previewData.nodes?.length || 0) / 10)} 秒</span>
            </div>
          </div>
        </div>
      )}

      {/* 底部统计 */}
      <div className="px-4 py-2 border-t border-gray-100 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/60">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-zinc-400">
          <span>
            显示 {Math.min(displayItems.length, maxItems)} / {items.length} 个模板
          </span>
          {searchQuery && (
            <span className="text-blue-600 dark:text-blue-300">
              找到 {filteredItems.length} 个结果
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// 增强模板项组件
interface EnhancedTemplateItemProps {
  item: TemplateItem;
  isSelected?: boolean;
  isLoading?: boolean;
  showPreview?: boolean;
  onPreview?: () => void;
  onClick: () => void;
}

const EnhancedTemplateItem: React.FC<EnhancedTemplateItemProps> = ({ 
  item, 
  isSelected = false,
  isLoading = false,
  showPreview = false,
  onPreview,
  onClick 
}) => {
  // 计算模板复杂度
  const getComplexityLevel = () => {
    const descLength = item.description?.length || 0;
    if (descLength > 300) return { level: '复杂', color: 'text-red-600 dark:text-red-200', bg: 'bg-red-50 dark:bg-red-900/25' };
    if (descLength > 150) return { level: '中等', color: 'text-yellow-600 dark:text-yellow-200', bg: 'bg-yellow-50 dark:bg-yellow-900/25' };
    return { level: '简单', color: 'text-green-600 dark:text-green-200', bg: 'bg-green-50 dark:bg-green-900/25' };
  };
  
  const complexity = getComplexityLevel();
  return (
    <div className={`
      relative group
      border-b border-gray-100 dark:border-zinc-700 last:border-b-0
      ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-accent/40'}
      ${isLoading ? 'opacity-60' : ''}
    `}>
      <button
        onClick={onClick}
        disabled={isLoading}
        className="
          w-full px-4 py-3 text-left
          transition-colors duration-150
          focus:outline-none
          disabled:cursor-not-allowed
        "
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* 模板标题 */}
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium text-gray-800 dark:text-zinc-100 truncate">
                {item.title}
              </h4>
              {isLoading && (
                <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
              )}
            </div>
            
            {/* 模板描述 */}
            {item.description && (
              <p className="text-xs text-gray-600 dark:text-zinc-300 line-clamp-2 mb-2">
                {item.description}
              </p>
            )}
            
            {/* 模板元信息 */}
            <div className="flex items-center gap-3 text-xs">
              <span className={`px-2 py-0.5 rounded-full ${complexity.bg} ${complexity.color}`}>
                {complexity.level}
              </span>
              {item.category && (
                <span className="text-gray-500 dark:text-zinc-400">
                  {item.category}
                </span>
              )}
            </div>
          </div>

          {/* 操作按钮区域 */}
          <div className="flex-shrink-0 flex items-center gap-2">
            {/* 预览按钮 */}
            {showPreview && onPreview && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview();
                }}
                className="
                  p-1.5 rounded text-gray-400 dark:text-zinc-500 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/25
                  transition-colors opacity-0 group-hover:opacity-100
                "
                title="预览模板"
              >
                <Eye className="w-3 h-3" />
              </button>
            )}
            
            {/* 模板缩略图或标记 */}
            {item.thumbnail ? (
              <div className="w-8 h-8 rounded border border-gray-200 dark:border-zinc-700 overflow-hidden">
                <Image
                  src={item.thumbnail}
                  alt={item.title}
                  width={32}
                  height={32}
                  unoptimized
                  loader={({ src }) => src}
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="
                w-8 h-8 
                bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/40 dark:to-purple-900/40
                text-blue-600 dark:text-blue-200
                rounded flex items-center justify-center
                text-xs font-medium
              ">
                模
              </div>
            )}
          </div>
        </div>
      </button>
    </div>
  );
};

export default TemplateDropdown;
