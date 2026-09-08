import React, { useState, useCallback, useEffect, useMemo } from 'react';
import type { Canvas, CanvasNode } from '../../../../types/canvas';
import type { NodeStyles } from './NodeStylePanel';
import './color-selector.css';
import { getMindmapPalette } from '@/lib/mindmap-palettes';
import { useTheme } from 'next-themes';

// Mermaid主题配置 - 基于调研结果的5种主题
export interface MermaidTheme {
  id: string;
  name: string;
  description: string;
  icon: string;
  config: {
    theme: 'default' | 'dark' | 'forest' | 'neutral' | 'base';
    look?: 'neo' | 'handDrawn' | 'classical';
    themeVariables?: Record<string, string>;
  };
}

// 预设主题列表 - 基于开源社区最佳实践重新设计
const MERMAID_THEMES: MermaidTheme[] = [
  {
    id: 'professional',
    name: 'Professional',
    description: 'Business reports, technical docs, demos',
    icon: '💼',
    config: {
      theme: 'base',
      look: 'neo',
      themeVariables: {
        primaryColor: '#0066cc',
        primaryTextColor: '#1a1a1a',
        primaryBorderColor: '#cccccc',
        lineColor: '#333333',
        secondaryColor: '#f5f7fa',
        tertiaryColor: '#ffffff',
        background: '#ffffff',
        mainBkg: '#e6f2ff',
        secondaryBkgColor: '#f0f8ff',
        nodeBkg: '#ffffff',
        nodeBorder: '#0066cc',
        clusterBkg: '#f5f7fa',
        clusterBorder: '#cccccc',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '14px'
      }
    }
  },
  {
    id: 'minimal',
    name: 'Minimal Modern',
    description: 'Modern design, minimalist UI',
    icon: '⚡',
    config: {
      theme: 'base',
      look: 'neo',
      themeVariables: {
        primaryColor: '#2d3748',
        primaryTextColor: '#2d3748',
        primaryBorderColor: '#e2e8f0',
        lineColor: '#718096',
        secondaryColor: '#f7fafc',
        tertiaryColor: '#ffffff',
        background: '#ffffff',
        mainBkg: '#f7fafc',
        nodeBkg: '#ffffff',
        nodeBorder: '#e2e8f0',
        clusterBkg: '#edf2f7',
        fontFamily: '"Inter", system-ui, sans-serif',
        fontSize: '13px'
      }
    }
  },
  {
    id: 'sunset',
    name: 'Warm Sunset',
    description: 'Creative/design, marketing, warm tone',
    icon: '🌅',
    config: {
      theme: 'base',
      look: 'neo',
      themeVariables: {
        primaryColor: '#ff5722',
        primaryTextColor: '#bf360c',
        primaryBorderColor: '#ffccbc',
        lineColor: '#ff7043',
        secondaryColor: '#fff3e0',
        tertiaryColor: '#ffffff',
        background: '#ffffff',
        mainBkg: '#ffe0cc',
        nodeBkg: '#ffffff',
        nodeBorder: '#ff8a65',
        clusterBkg: '#fff3e0',
        fontFamily: '"Roboto", system-ui, sans-serif',
        fontSize: '14px'
      }
    }
  },
  {
    id: 'dark',
    name: 'Professional Dark',
    description: 'Dev docs, code, dark UI',
    icon: '🌙',
    config: {
      theme: 'base',
      look: 'neo',
      themeVariables: {
        primaryColor: '#64b5f6',
        primaryTextColor: '#e3f2fd',
        primaryBorderColor: '#37474f',
        lineColor: '#90a4ae',
        secondaryColor: '#263238',
        tertiaryColor: '#1a1a1a',
        background: '#121212',
        mainBkg: '#1e1e1e',
        nodeBkg: '#2d2d2d',
        nodeBorder: '#64b5f6',
        clusterBkg: '#263238',
        clusterBorder: '#37474f',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '13px'
      }
    }
  },
  {
    id: 'forest',
    name: '自然绿调',
    description: '环保主题、自然科学、清新展示',
    icon: '🌲',
    config: {
      theme: 'base',
      look: 'neo',
      themeVariables: {
        primaryColor: '#388e3c',
        primaryTextColor: '#1b5e20',
        primaryBorderColor: '#c8e6c9',
        lineColor: '#2e7d32',
        secondaryColor: '#e8f5e8',
        tertiaryColor: '#ffffff',
        background: '#ffffff',
        mainBkg: '#f1f8e9',
        nodeBkg: '#ffffff',
        nodeBorder: '#66bb6a',
        clusterBkg: '#e8f5e8',
        fontFamily: '"Nunito", system-ui, sans-serif',
        fontSize: '14px'
      }
    }
  },
  // Open-source palettes for mindmap
  { id: 'cb-set3', name: 'CB Set3', description: 'ColorBrewer Set3 (12)', icon: '🎨', config: { theme: 'base', look: 'neo', themeVariables: {} } },
  { id: 'cb-paired', name: 'CB Paired', description: 'ColorBrewer Paired (12)', icon: '🎨', config: { theme: 'base', look: 'neo', themeVariables: {} } },
  { id: 'd3-category10', name: 'D3 Cat10+', description: 'D3 Category10 (11)', icon: '📈', config: { theme: 'base', look: 'neo', themeVariables: {} } },
  { id: 'echarts-macarons', name: 'Macarons', description: 'ECharts Macarons (11)', icon: '🍬', config: { theme: 'base', look: 'neo', themeVariables: {} } }
];

// Mermaid图表类型检测
const detectMermaidType = (content: string): string => {
  const trimmed = content.trim().toLowerCase();
  
  if (trimmed.startsWith('graph') || trimmed.startsWith('flowchart')) {
    return '流程图';
  }
  if (trimmed.startsWith('sequencediagram') || trimmed.includes('participant')) {
    return '序列图';
  }
  if (trimmed.startsWith('classDiagram')) {
    return '类图';
  }
  if (trimmed.startsWith('stateDiagram')) {
    return '状态图';
  }
  if (trimmed.startsWith('gantt')) {
    return '甘特图';
  }
  if (trimmed.startsWith('pie')) {
    return '饼图';
  }
  if (trimmed.startsWith('gitgraph')) {
    return 'Git图';
  }
  
  return '未知类型';
};

interface MermaidStylePanelProps {
  selectedNodes: CanvasNode[];
  onStyleChange: (nodeId: string, styles: NodeStyles) => void;
}

const MermaidStylePanel: React.FC<MermaidStylePanelProps> = ({
  selectedNodes,
  onStyleChange
}) => {
  const { resolvedTheme } = useTheme();
  const [selectedTheme, setSelectedTheme] = useState<string | 'mixed'>('professional');
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);
  const [hasThemeMixed, setHasThemeMixed] = useState(false);

  // 获取当前主题配置
  const currentTheme = MERMAID_THEMES.find(theme => theme.id === selectedTheme) || MERMAID_THEMES[0];
  
  // 🎯 批量主题状态检测（优先使用 id，其次配置）
  useEffect(() => {
    const mermaidNodes = selectedNodes.filter(node => 
      node.type === 'code' && (node as any).codeType === 'mermaid'
    );
    if (mermaidNodes.length === 0) return;

    const resolveThemeId = (node: CanvasNode): string => {
      const byId = (node as any).mermaidThemeId || (node as any).mermaidTheme?.id;
      if (byId) return String(byId);
      const byConfig = (node as any).mermaidTheme;
      const matched = MERMAID_THEMES.find(t => JSON.stringify(t.config) === JSON.stringify(byConfig));
      return matched?.id || 'professional';
    };

    const allThemeIds = mermaidNodes.map(resolveThemeId);
    const unique = [...new Set(allThemeIds)];
    if (unique.length > 1) {
      setSelectedTheme('mixed');
      setHasThemeMixed(true);
    } else {
      setSelectedTheme(unique[0]);
      setHasThemeMixed(false);
    }
  }, [selectedNodes]);

  // 处理主题切换 - 清除混合状态
  const handleThemeChange = useCallback((themeId: string) => {
    const theme = MERMAID_THEMES.find(t => t.id === themeId);
    if (!theme) return;

    setSelectedTheme(themeId);
    setHasThemeMixed(false); // 清除混合状态
    setShowThemeDropdown(false);

    // 应用主题到所有选中的Mermaid节点
    selectedNodes.forEach(node => {
      if (node.type === 'code' && (node as any).codeType === 'mermaid') {
        onStyleChange(node.id, {
          mermaidThemeId: theme.id,
          mermaidTheme: theme.config
        } as any);
      }
    });
  }, [selectedNodes, onStyleChange]);

  // 分析选中的Mermaid节点
  const mermaidNodes = selectedNodes.filter(node => 
    node.type === 'code' && (node as any).codeType === 'mermaid'
  );

  // "色彩滚动"风格的主题选择（统一所有主题；使用渐变预览，不用彩条）
  const renderThemeScroller = useMemo(() => {
    const isDark = resolvedTheme === 'dark';
    const categoricalIds = ['cb-set3','cb-paired','d3-category10','echarts-macarons'];
    const items = MERMAID_THEMES.map(theme => {
      const id = theme.id;
      const isCategorical = categoricalIds.includes(id);
      let previewBackground = '' as string;
      if (isCategorical) {
        // 开源分类调色板：渐变（首色→末色）
        const colors = getMindmapPalette(id, isDark);
        const c1 = colors[0];
        const c2 = colors[colors.length - 1] || colors[0];
        previewBackground = `linear-gradient(90deg, ${c1} 0%, ${c2} 100%)`;
      } else {
        // 纯色主题：使用主色作为纯色块
        const v = theme.config?.themeVariables || {} as any;
        const c1 = v.primaryColor || '#3b82f6';
        previewBackground = c1;
      }
      const name = theme.name || id;
      return (
        <button
          key={id}
          className="item-color"
          style={{ ['--color' as any]: 'transparent' } as React.CSSProperties}
          data-color={name}
          onClick={() => handleThemeChange(id)}
          title={name}
        >
          <div className="w-[28px] h-[28px] rounded-sm" style={{ background: previewBackground }} />
        </button>
      );
    });
    return (
      <div className="accent-color-list accent-color-list--tight" title="主题">
        <div className="container-items">
          {items}
        </div>
      </div>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme]);

  return (
    <>
      {/* 统一的“色彩滚动”样式主题选择 */}

      {/* 统一的“色彩滚动”样式主题选择（全部主题） */}
      {renderThemeScroller}
    </>
  );
};

export default MermaidStylePanel;
