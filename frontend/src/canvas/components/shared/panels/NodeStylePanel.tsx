import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { Settings } from 'lucide-react';
import MermaidStylePanel from './MermaidStylePanel';
import TextStylePanel from './TextStylePanel';
import TableStylePanel from './TableStylePanel';
import AlignmentPanel from './AlignmentPanel';
import type { Canvas, CanvasNode, NodeShapeDecoration } from '../../../../types/canvas';
import { AlignmentType } from '../../../types/node-alignment';
import {useTranslations} from 'next-intl';
import { CanvasIcon } from '../icons/CanvasIcon';

// 文本样式接口
export interface TextStyles {
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  accentColor?: string;
  opacity?: number;
}

// 节点样式接口
export interface NodeStyles {
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
  padding?: number;
  opacity?: number;
  // 文本样式
  textStyles?: TextStyles;
  // 形状装饰
  shapeDecoration?: NodeShapeDecoration;
  // 表格特定样式
  tableStyles?: {
    borderStyle?: 'solid' | 'dashed' | 'dotted';
    borderWidth?: number;
    borderColor?: string;
    showGrid?: boolean;
    alternateRows?: boolean;
    headerBackground?: string;
    headerBold?: boolean;
    topBorder?: number;
    headerBorder?: number;
    bottomBorder?: number;
    evenRowBackground?: string;
    oddRowBackground?: string;
  };
}

// 支持的节点类型
type SupportedNodeType = 'text-like' | 'mermaid' | 'svg' | 'table' | 'column' | 'media';

interface MediaOpacityPanelProps {
  selectedNodes: CanvasNode[];
  onStyleChange: (nodeId: string, styles: NodeStyles) => void;
}

const MediaOpacityPanel: React.FC<MediaOpacityPanelProps> = ({
  selectedNodes,
  onStyleChange
}) => {
  const mediaNodes = useMemo(() => selectedNodes.filter((n) => n.type === 'media'), [selectedNodes]);
  const [opacity, setOpacity] = useState(1);
  const [hasMixed, setHasMixed] = useState(false);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    if (mediaNodes.length === 0) {
      setOpacity(1);
      setHasMixed(false);
      return;
    }
    const values = mediaNodes.map((n) => (typeof (n as any).opacity === 'number' ? (n as any).opacity : 1));
    const unique = Array.from(new Set(values.map((v) => Math.round(v * 100) / 100)));
    if (unique.length > 1) {
      setOpacity(1);
      setHasMixed(true);
    } else {
      setOpacity(unique[0] ?? 1);
      setHasMixed(false);
    }
  }, [mediaNodes]);

  const applyOpacity = useCallback(
    (value: number) => {
      const clamped = Math.max(0, Math.min(1, value));
      setOpacity(clamped);
      setHasMixed(false);
      mediaNodes.forEach((node) => {
        onStyleChange(node.id, { opacity: clamped });
      });
    },
    [mediaNodes, onStyleChange]
  );

  if (mediaNodes.length === 0) {
    return (
      <div className="w-9 h-9 rounded-lg flex items-center justify-center opacity-50">
        <Settings size={16} className="text-gray-400 dark:text-zinc-500" />
      </div>
    );
  }

  const sliderSize = 24;
  const displayOpacity = hasMixed ? 1 : opacity;

  return (
    <div className="flex flex-col items-center justify-center h-64 relative">
      <div
        className="relative w-6 h-48 bg-gradient-to-t from-black/20 via-gray-300 to-white dark:from-white/15 dark:via-zinc-600 dark:to-black border border-gray-300 dark:border-zinc-700/60 rounded-full overflow-hidden cursor-pointer"
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const y = e.clientY - rect.top;
          const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
          applyOpacity(ratio);
        }}
      >
        {Array.from({ length: 5 }).map((_, idx) => (
          <div
            key={idx}
            className="absolute left-1/2 -translate-x-1/2 w-3 h-px bg-gray-400/60"
            style={{ bottom: `${idx * 25}%` }}
          />
        ))}

        <div
          className="absolute left-1/2 -translate-x-1/2 bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-600 rounded-full shadow cursor-grab"
          style={{
            width: `${sliderSize}px`,
            height: `${sliderSize}px`,
            bottom: `${Math.round((displayOpacity ?? 0) * 100)}%`,
            marginBottom: `-${sliderSize / 2}px`
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            isDraggingRef.current = true;
            const track = e.currentTarget.parentElement as HTMLDivElement;
            const handleMove = (ev: MouseEvent) => {
              if (!isDraggingRef.current) return;
              const rect = track.getBoundingClientRect();
              const y = ev.clientY - rect.top;
              const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
              applyOpacity(ratio);
            };
            const handleUp = () => {
              isDraggingRef.current = false;
              window.removeEventListener('mousemove', handleMove);
              window.removeEventListener('mouseup', handleUp);
            };
            window.addEventListener('mousemove', handleMove);
            window.addEventListener('mouseup', handleUp);
          }}
        />
      </div>

      <button
        className="mt-2 w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md text-gray-600 dark:text-zinc-300 relative"
        title={hasMixed ? '透明度（当前为混合状态）' : `透明度: ${Math.round((displayOpacity ?? 1) * 100)}%`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16">
          <path fill="currentColor" d="M0 0h3.2v3.2H0z"></path>
          <path fill="currentColor" d="M0 6.4h3.2v3.2H0z"></path>
          <path fill="currentColor" d="M0 12.801h3.2v3.2H0z"></path>
          <path fill="currentColor" fillOpacity="0.8" d="M3.2 3.199h3.2v3.2H3.2z"></path>
          <path fill="currentColor" fillOpacity="0.8" d="M3.2 9.6h3.2v3.2H3.2z"></path>
          <path fill="currentColor" fillOpacity="0.6" d="M6.4 0h3.2v3.2H6.4z"></path>
          <path fill="currentColor" fillOpacity="0.2" d="M12.8 0H16v3.2h-3.2z"></path>
          <path fill="currentColor" fillOpacity="0.6" d="M6.4 6.4h3.2v3.2H6.4z"></path>
          <path fill="currentColor" fillOpacity="0.2" d="M12.8 6.4H16v3.2h-3.2z"></path>
          <path fill="currentColor" fillOpacity="0.6" d="M6.4 12.801h3.2v3.2H6.4z"></path>
          <path fill="currentColor" fillOpacity="0.2" d="M12.8 12.801H16v3.2h-3.2z"></path>
          <path fill="currentColor" fillOpacity="0.4" d="M9.6 3.199h3.2v3.2H9.6zM9.6 9.6h3.2v3.2H9.6z"></path>
        </svg>
        {hasMixed ? (
          <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full border border-gray-400 dark:border-zinc-500 bg-gradient-to-r from-transparent via-gray-400 to-gray-600" />
        ) : displayOpacity < 1 ? (
          <div className="absolute -bottom-1 -right-1 text-xs text-gray-400 dark:text-zinc-500 bg-white dark:bg-zinc-900 rounded px-1 text-[10px] leading-tight">
            {Math.round((displayOpacity ?? 1) * 100)}
          </div>
        ) : null}
      </button>
    </div>
  );
};

interface NodeStylePanelProps {
  selectedNodes: CanvasNode[];
  onStyleChange: (nodeId: string, styles: NodeStyles) => void;
  /** 对齐操作回调 */
  onAlignment?: (nodes: CanvasNode[], type: AlignmentType) => void;
}

const NodeStylePanel: React.FC<NodeStylePanelProps> = ({
  selectedNodes,
  onStyleChange,
  onAlignment
}) => {
  const t = useTranslations();
  const [hasTextStyleSubPanel, setHasTextStyleSubPanel] = useState(false);
  const [hasAlignmentSubPanel, setHasAlignmentSubPanel] = useState(false);
  // 分析选中的节点类型
  const nodeAnalysis = useMemo(() => {
    if (selectedNodes.length === 0) {
      return { type: null, count: 0, isMultiType: false };
    }
    
    // 处理特殊节点类型映射
    const nodeTypes = selectedNodes.map(node => {
      if (node.type === 'code' && (node as any).codeType === 'mermaid') {
        return 'mermaid';
      }
      if (node.type === 'code' && (node as any).codeType === 'svg') {
        return 'svg';
      }
      // 🎯 将 text 和 todo 视为同一类型，因为它们共用相同的样式系统
      if (node.type === 'text' || node.type === 'todo') {
        return 'text-like';
      }
      return node.type;
    });
    
    const uniqueTypes = Array.from(new Set(nodeTypes));
    
    return {
      type: uniqueTypes.length === 1 ? uniqueTypes[0] as SupportedNodeType : 'mixed',
      count: selectedNodes.length,
      isMultiType: uniqueTypes.length > 1,
      types: uniqueTypes
    };
  }, [selectedNodes]);

  // 获取面板标题
  const getPanelTitle = useCallback(() => {
    const { type, count, isMultiType } = nodeAnalysis;

    if (isMultiType) {
      return t('nodeStylePanel.mixed', {count});
    }

    switch (type) {
      case 'text-like':
        return t('nodeStylePanel.text', {count});
      case 'mermaid':
        return t('nodeStylePanel.chart', {count});
      case 'svg':
        return t('nodeStylePanel.svg', {count});
      case 'table':
        return t('nodeStylePanel.table', {count});
      case 'column':
        return t('nodeStylePanel.column', {count});
      default:
        return t('nodeStylePanel.generic');
    }
  }, [nodeAnalysis, t]);

  // 获取面板图标
  const getPanelIcon = useCallback(() => {
    const { type, isMultiType } = nodeAnalysis;

    if (isMultiType) {
      return '🎨';
    }

    switch (type) {
      case 'text-like':
        return '📝';
      case 'mermaid':
        return '📊';
      case 'svg':
        return '🎨';
      case 'table':
        return '📋';
      case 'column':
        return '📂';
      default:
        return '🎨';
    }
  }, [nodeAnalysis]);

  // 渲染对应的样式面板
  const renderStylePanel = useCallback(() => {
    const { type, isMultiType } = nodeAnalysis;
    
    if (selectedNodes.length === 0) {
      return (
        <div className="w-8 h-8 rounded-md bg-gray-50/80 dark:bg-neutral-900/50 border border-gray-200/50 dark:border-zinc-700/50 flex items-center justify-center opacity-50">
          <Settings size={16} className="text-gray-400 dark:text-zinc-500" />
        </div>
      );
    }
    
    if (isMultiType) {
      return (
        <div className="w-8 h-8 rounded-md bg-gray-50/80 dark:bg-neutral-900/50 border border-gray-200/50 dark:border-zinc-700/50 flex items-center justify-center opacity-50">
          <span className="text-base">🎨</span>
        </div>
      );
    }
    
    const commonProps = {
      selectedNodes,
      onStyleChange,
    };
    
    switch (type) {
      case 'text-like':
        return <TextStylePanel {...commonProps} onSubPanelStateChange={setHasTextStyleSubPanel} />;
      case 'mermaid':
        return <MermaidStylePanel {...commonProps} />;
      case 'media':
        return <MediaOpacityPanel {...commonProps} />;
      case 'svg': {
        // 简化：仅提供 SVG 节点背景底色模式（透明 / 自适应深浅）
        const svgNodes = selectedNodes.filter(n => n.type === 'code' && (n as any).codeType === 'svg');
        // 统计当前模式
        const modes = new Set(svgNodes.map(n => (n as any).svgBgMode || 'transparent'));
        const currentMode = modes.size === 1 ? (Array.from(modes)[0] as 'transparent'|'auto') : 'mixed';

        const applyMode = (mode: 'transparent'|'auto') => {
          svgNodes.forEach(node => {
            onStyleChange(node.id, { svgBgMode: mode } as any);
          });
        };

        return (
          <div className="flex flex-col items-stretch gap-2">
            <button
              onClick={() => applyMode('transparent')}
              className={`w-16 h-10 rounded-lg border transition-all text-xs flex items-center justify-center ${currentMode === 'transparent' ? 'border-blue-500 ring-1 ring-blue-200' : 'border-gray-300 dark:border-zinc-700'}`}
              title="透明背景"
              aria-pressed={currentMode === 'transparent'}
            >
              透明
            </button>
            <button
              onClick={() => applyMode('auto')}
              className={`w-16 h-10 rounded-lg border transition-all text-xs flex items-center justify-center ${currentMode === 'auto' ? 'border-blue-500 ring-1 ring-blue-200' : 'border-gray-300 dark:border-zinc-700'}`}
              title="自适应（浅色/深色）"
              aria-pressed={currentMode === 'auto'}
            >
              自适应
            </button>
          </div>
        );
      }
      case 'table':
        return <TableStylePanel {...commonProps} />;
      case 'column':
              return (
                <div className="w-9 h-9 rounded-lg flex items-center justify-center opacity-50">
                  <CanvasIcon name="column" />
                </div>
              );
      default:
        return (
          <div className="w-9 h-9 rounded-lg flex items-center justify-center opacity-50">
            <Settings size={16} className="text-gray-400 dark:text-zinc-500" />
          </div>
        );
    }
  }, [selectedNodes, nodeAnalysis, onStyleChange]);

  // 🎯 统一的子面板互斥显示逻辑
  if (hasTextStyleSubPanel) {
    // 当TextStylePanel有子面板时，只显示TextStylePanel
    return renderStylePanel();
  }
  
  if (hasAlignmentSubPanel) {
    // 当AlignmentPanel有子面板时，只显示AlignmentPanel（包含完整的渲染逻辑）
    return (
      <>
        {/* 样式面板 */}
        {renderStylePanel()}
        
        {/* 节点对齐面板 - 多选节点时显示 */}
        {selectedNodes.length >= 2 && onAlignment && (
          <>
            {/* 分割线 */}
            <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-1 my-2" />
            
            {/* 对齐面板 */}
            <AlignmentPanel
              selectedNodes={selectedNodes}
              onAlignment={onAlignment}
              enableAnimation={true}
              animationDuration={150}
              onSubPanelStateChange={setHasAlignmentSubPanel}
            />
          </>
        )}
        
      </>
    );
  }

  // 默认显示所有主面板组件
  return (
    <>
      {/* 样式面板 */}
      {renderStylePanel()}
      
      {/* 节点对齐面板 - 多选节点时显示 */}
      {selectedNodes.length >= 2 && onAlignment && (
        <>
          {/* 分割线 */}
          <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-1 my-2" />
          
          {/* 对齐面板 */}
          <AlignmentPanel
            selectedNodes={selectedNodes}
            onAlignment={onAlignment}
            enableAnimation={true}
            animationDuration={150}
            onSubPanelStateChange={setHasAlignmentSubPanel}
          />
        </>
      )}
      
    </>
  );
};

export default NodeStylePanel;
