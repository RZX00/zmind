import React, { useState, useCallback, useEffect } from 'react';
import type { CanvasNode } from '../../../../types/canvas';
import type { NodeStyles } from './NodeStylePanel';
import { CanvasIcon } from '../icons/CanvasIcon';
import type { CanvasIconName } from '../../../constants/canvasIcons';

// 表格样式接口
export interface TableStyles {
  theme?: 'booktabs' | 'nature' | 'ieee';
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
}

// 🎓 学术级表格主题 - 只保留3个核心样式
const TABLE_THEMES: Array<{
  id: string;
  name: string;
  icon: CanvasIconName;
  description: string;
  styles: TableStyles & Record<string, unknown>;
}> = [
  {
    id: 'booktabs',
    name: '学术标准',
    icon: 'tableMinimal' as const,
    description: 'Booktabs三线表，Nature/Science期刊标准',
    styles: {
      borderStyle: 'solid' as const,
      borderWidth: 1,
      borderColor: '#000000',
      showGrid: false,
      alternateRows: false,
      headerBackground: 'transparent',
      headerBold: true,
      topBorder: 2,        // 顶线加粗
      headerBorder: 1,     // 表头分隔线
      bottomBorder: 2,     // 底线加粗
      fontFamily: 'Arial, Helvetica, sans-serif',
      cellPadding: 8,
      textColor: '#000000',
      headerTextColor: '#000000'
    }
  },
  {
    id: 'nature',
    name: 'Nature期刊',
    icon: 'tableStriped' as const,
    description: '顶级期刊样式，极简专业',
    styles: {
      borderStyle: 'solid' as const,
      borderWidth: 1,
      borderColor: '#333333',
      showGrid: false,
      alternateRows: true,
      headerBackground: 'transparent',
      evenRowBackground: '#ffffff',
      oddRowBackground: '#fafafa',
      headerBold: true,
      topBorder: 1.5,
      headerBorder: 0.5,
      bottomBorder: 1.5,
      fontFamily: 'Helvetica, Arial, sans-serif',
      fontSize: 11,
      cellPadding: 6,
      textColor: '#333333',
      headerTextColor: '#000000'
    }
  },
  {
    id: 'ieee',
    name: 'IEEE标准',
    icon: 'tableGrid' as const,
    description: '工程技术期刊，IEEE会议格式',
    styles: {
      borderStyle: 'solid' as const,
      borderWidth: 1,
      borderColor: '#000000',
      showGrid: true,
      alternateRows: false,
      headerBackground: '#f8f8f8',
      headerBold: true,
      topBorder: 1.5,
      headerBorder: 1,
      bottomBorder: 1.5,
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: 10,
      cellPadding: 4,
      textAlign: 'center' as const,
      textColor: '#000000',
      headerTextColor: '#000000'
    }
  }
];

// 学术期刊常用颜色预设
const PRESET_COLORS = [
  '#ffffff', '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', 
  '#64748b', '#475569', '#334155', '#1e293b', '#000000',
  '#fef2f2', '#fee2e2', '#f87171', '#ef4444',
  '#f0fdf4', '#dcfce7', '#4ade80', '#22c55e'
];

interface TableStylePanelProps {
  selectedNodes: CanvasNode[];
  onStyleChange: (nodeId: string, styles: NodeStyles) => void;
}

const TableStylePanel: React.FC<TableStylePanelProps> = ({
  selectedNodes,
  onStyleChange
}) => {
  // 获取表格节点
  const tableNodes = selectedNodes.filter(node => node.type === 'table');
  
  // 样式状态 - 支持混合状态，默认Nature风格
  const [selectedTheme, setSelectedTheme] = useState<string | 'mixed'>('nature');
  const [borderColor, setBorderColor] = useState('#e5e7eb');
  const [headerBgColor, setHeaderBgColor] = useState('#f9fafb');
  const [alternateRowBgColor, setAlternateRowBgColor] = useState('#f9fafb');
  const [hasThemeMixed, setHasThemeMixed] = useState(false);
  
  // 🎯 批量表格样式状态检测
  useEffect(() => {
    if (tableNodes.length === 0) return;
    
    // 收集所有节点的主题ID
    const allThemeIds: string[] = [];
    tableNodes.forEach(node => {
      const nodeTableStyles = (node as any).tableStyles;
      // 优先读取显式 theme 字段；否则回退到样式匹配
      const themeId = nodeTableStyles?.theme || TABLE_THEMES.find(theme => 
        theme.styles.topBorder === nodeTableStyles?.topBorder &&
        theme.styles.showGrid === nodeTableStyles?.showGrid
      )?.id || 'nature';
      allThemeIds.push(themeId);
    });
    
    // 检测主题是否混合
    const uniqueThemeIds = [...new Set(allThemeIds)];
    if (uniqueThemeIds.length > 1) {
      setSelectedTheme('mixed');
      setHasThemeMixed(true);
    } else {
      setSelectedTheme(uniqueThemeIds[0]);
      setHasThemeMixed(false);
    }
  }, [tableNodes]);

  // 应用样式到表格节点
  const applyStyles = useCallback((styles: Partial<TableStyles>) => {
    tableNodes.forEach(node => {
      const current = ((node as any).tableStyles) || {};
      onStyleChange(node.id, {
        tableStyles: {
          ...current,
          ...styles
        }
      });
    });
  }, [tableNodes, onStyleChange]);

  // 应用主题
  const applyTheme = useCallback((themeId: string) => {
    const theme = TABLE_THEMES.find(t => t.id === themeId);
    if (!theme) return;

    setSelectedTheme(themeId);
    applyStyles({
      ...theme.styles,
      theme: theme.id as TableStyles['theme']
    });
    
    // 同步状态
    setBorderColor(theme.styles.borderColor || '#e5e7eb');
    setHeaderBgColor(theme.styles.headerBackground || '#f9fafb');
    setAlternateRowBgColor(theme.styles.oddRowBackground || '#f9fafb');
  }, [applyStyles]);

  // 处理边框颜色变更
  const handleBorderColorChange = useCallback((color: string) => {
    setBorderColor(color);
    applyStyles({ borderColor: color });
  }, [applyStyles]);

  // 处理表头背景颜色变更
  const handleHeaderBgColorChange = useCallback((color: string) => {
    setHeaderBgColor(color);
    applyStyles({ headerBackground: color });
  }, [applyStyles]);

  // 处理交替行背景颜色变更
  const handleAlternateRowBgColorChange = useCallback((color: string) => {
    setAlternateRowBgColor(color);
    applyStyles({ oddRowBackground: color });
  }, [applyStyles]);

  // 分析表格内容
  const analyzeTableContent = useCallback((content: string) => {
    const lines = content.split('\n').filter(line => line.trim());
    const dataRows = lines.filter(line => !line.includes('---')); // 排除分割行
    return {
      totalRows: dataRows.length,
      hasHeader: dataRows.length > 0 && lines.some(line => line.includes('---')),
      columns: dataRows[0] ? dataRows[0].split('|').length - 2 : 0 // 减去前后的空字符串
    };
  }, []);

  return (
    <>
      {/* 学术级表格主题选择 - 3个精选样式 */}
      {TABLE_THEMES.map((theme) => (
        <button
          key={theme.id}
          onClick={() => applyTheme(theme.id)}
          className={`w-10 h-10 rounded-lg transition-all duration-200 flex items-center justify-center ${
            selectedTheme === theme.id
              ? 'bg-blue-100/80 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
              : hasThemeMixed
                ? 'text-gray-400 bg-gray-50 dark:text-zinc-500 dark:bg-zinc-800/40'
                : 'text-gray-600 dark:text-zinc-300 hover:bg-accent/60'
          }`}
          title={
            hasThemeMixed
              ? `${theme.name} (当前混合状态)`
              : theme.description
          }
        >
          <CanvasIcon name={theme.icon} />
        </button>
      ))}
    </>
  );
};

export default TableStylePanel;
