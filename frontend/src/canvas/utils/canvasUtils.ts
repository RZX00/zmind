// 🧰 Canvas工具函数实现 - 扁平化重构版本
// 提供画布操作的核心逻辑，完全适配新的扁平化类型系统

import type {
  Canvas,
  CanvasNode,
  CanvasConnection,
  ConnectionAppearance,
  UpdateNodeOptions,
  AIContext,
  FontStyle,
  NodeTypeIcon,
} from '../../types/canvas';
import {
  DEFAULT_NODE_SIZES,
  NODE_TYPE_ICONS
} from '../../types/canvas';
import { DEFAULT_CORNER_STYLE } from '../constants/cornerStyles';
import {
  DEFAULT_TEXT_LAYOUT_PRESET,
  DEFAULT_TEXT_OPACITY_PRESET,
  getTextLayoutPreset,
  getTextOpacityPreset,
  type TextLayoutPreset,
  type TextLayoutPresetId
} from '../constants/textNodePresets';
import { TEXT_MARKDOWN_RHYTHM } from '../domain/text-layout/textMarkdownRhythm';
import { DEFAULT_CANVAS_TITLE } from '@/canvas/constants';
import { queryRect, buildSpatialIndex } from './spatialIndex';
import type { StructuredTableData } from './structuredTable';

// Local helper types used only within this module (decoupled from central types)
type NodeInfoForAI = {
  id: string;
  type: CanvasNode['type'];
  title?: string;
  contentPreview: string;
  codeType?: string;
  isLocked?: boolean;
  targetCanvasId?: string;
  completed?: boolean;
};
type SelectedNodeInfo = NodeInfoForAI;
type AINodeHelpers = {
  nodeToSelectedInfo: (node: CanvasNode) => NodeInfoForAI;
  generateContentPreview: (content: string, maxLength?: number) => string;
  getNodeTypeIcon: (nodeType: CanvasNode['type']) => NodeTypeIcon;
  validateSelectedNodes: (nodes: CanvasNode[], maxCount?: number) => boolean;
  formatNodesForAI: (nodes: CanvasNode[]) => string;
};

// 🔧 数据结构修复 - 解决嵌套数据问题
export const normalizeCanvasData = (canvas: any): Canvas => {
  if (!canvas) return canvas;
  
  let actualCanvas = canvas;
  
  // 检查并解决data嵌套问题
  if (canvas.data && typeof canvas.data === 'object') {
    // 如果外层nodes为空，但data.nodes有内容，使用data层
    if ((!canvas.nodes || canvas.nodes.length === 0) && 
        canvas.data.nodes && canvas.data.nodes.length > 0) {
      console.log('🔧 [normalizeCanvasData] 检测到data层有真实数据，使用data层');
      actualCanvas = canvas.data;
    }
    
    // 检查更深层的data.data嵌套
    if (actualCanvas.data && typeof actualCanvas.data === 'object' &&
        (!actualCanvas.nodes || actualCanvas.nodes.length === 0) &&
        actualCanvas.data.nodes && actualCanvas.data.nodes.length > 0) {
      console.log('🔧 [normalizeCanvasData] 检测到data.data层有真实数据，使用data.data层');
      actualCanvas = actualCanvas.data;
    }
  }
  
  // 确保必要字段存在
  return {
    id: actualCanvas.id || canvas.id,
    title: actualCanvas.title || canvas.title || DEFAULT_CANVAS_TITLE,
    nodes: actualCanvas.nodes || [],
    connections: actualCanvas.connections || [],
    createdAt: actualCanvas.createdAt || canvas.createdAt || Date.now(),
    updatedAt: actualCanvas.updatedAt || canvas.updatedAt || Date.now(),
    version: actualCanvas.version || canvas.version || '1.0.0',
    textOpacityPreset:
      actualCanvas.textOpacityPreset ??
      canvas.textOpacityPreset ??
      DEFAULT_TEXT_OPACITY_PRESET,
    textLayoutPreset:
      actualCanvas.textLayoutPreset ??
      canvas.textLayoutPreset ??
      DEFAULT_TEXT_LAYOUT_PRESET
  };
};

// 🔧 获取正确的节点数量 - 处理数据嵌套问题
export const getCanvasNodeCount = (canvas: any): number => {
  if (!canvas) return 0;
  
  // 优先使用外层nodes
  if (canvas.nodes && Array.isArray(canvas.nodes)) {
    return canvas.nodes.length;
  }
  
  // 检查data.nodes
  if (canvas.data && canvas.data.nodes && Array.isArray(canvas.data.nodes)) {
    return canvas.data.nodes.length;
  }
  
  // 检查更深层嵌套
  if (canvas.data && canvas.data.data && canvas.data.data.nodes && Array.isArray(canvas.data.data.nodes)) {
    return canvas.data.data.nodes.length;
  }
  
  return 0;
};

// DEFAULT_NODE_SIZES moved to local constants;
import { CanvasIdManager } from './canvasIdUtils';
import { NodeIds } from './nodeIdUtils';

// 🎯 生成唯一ID - 统一使用长ID格式，彻底解决短ID问题
export const generateId = (): string => CanvasIdManager.generate();

// ⏰ 获取当前时间戳 (数字格式，性能更优)
export const getCurrentTimestamp = (): number => Date.now();

// 🎯 获取节点默认尺寸
const getNodeDefaultSize = (type: string, codeType?: string): { width: number; height: number } => {
  if (type === 'code' && codeType) {
    return DEFAULT_NODE_SIZES[codeType as 'mermaid' | 'html'] || DEFAULT_NODE_SIZES.html;
  }
  return DEFAULT_NODE_SIZES[type as keyof typeof DEFAULT_NODE_SIZES] || DEFAULT_NODE_SIZES.text;
};

interface CalculateTextNodeHeightOptions {
  hasAccentColor?: boolean;
  layoutPreset?: TextLayoutPreset;
  layoutPresetId?: TextLayoutPresetId;
}

// 🎯 精确计算文本节点动态高度 - 基于真实UI架构的数学估算
// 注意：色带为 overlay，不计入高度；保留 hasAccentColor 参数以兼容旧调用，但不再用于叠加高度。
export const calculateTextNodeHeight = (
  content: string,
  width: number,
  options: CalculateTextNodeHeightOptions = {}
): number => {
  const layout =
    options.layoutPreset ??
    getTextLayoutPreset(options.layoutPresetId ?? DEFAULT_TEXT_LAYOUT_PRESET);
  const metrics = layout.metrics;
  const hasAccentColor = options.hasAccentColor ?? false;
  const rhythm = TEXT_MARKDOWN_RHYTHM;

  if (!content.trim()) {
    return metrics.minHeight;
  }

  // 🎯 UI组件空间占用 (基于NodeContainer + TextNodeCore架构分析)
  const UI_COMPONENTS = {
    OUTER_BORDER: 4, // 外边框 2px * 2
    CONTENT_PADDING: metrics.padding * 2, // 上下总内边距
    MIN_VERTICAL_SPACING: Math.max(6, Math.round(metrics.padding * 0.75))
  };

  // 🎯 字体渲染参数 (基于CanvasMarkdownRenderer实际设置)
  const FONT_METRICS = {
    BASE_FONT_SIZE: 16, // 基础字体大小
    BASE_LINE_HEIGHT: 22, // 基础行高 (1.4 * 16px)
    H1_FONT_SIZE: Math.round(16 * rhythm.heading1.scale), // H1标题字体
    H1_LINE_HEIGHT: Math.round(16 * rhythm.heading1.scale * rhythm.heading1.lineHeight), // H1行高
    H2_FONT_SIZE: Math.round(16 * rhythm.heading2.scale), // H2标题字体
    H2_LINE_HEIGHT: Math.round(16 * rhythm.heading2.scale * rhythm.heading2.lineHeight), // H2行高
    H3_FONT_SIZE: Math.round(16 * rhythm.heading3.scale), // H3-H6标题字体
    H3_LINE_HEIGHT: Math.round(16 * rhythm.heading3.scale * rhythm.heading3.lineHeight), // H3行高
    PARAGRAPH_SPACING: Math.round(16 * rhythm.paragraph.marginBottomRem),
    LIST_ITEM_SPACING: Math.round(16 * rhythm.list.itemSpacingRem)
  };

  // 🎯 可用内容宽度计算
  const adjustedWidth =
    width - UI_COMPONENTS.OUTER_BORDER - UI_COMPONENTS.CONTENT_PADDING;
  const availableWidth = Math.max(80, adjustedWidth);

  // 🎯 逐行分析并模拟真实换行
  let totalContentHeight = 0;
  let previousWasEmpty = false;
  let totalVisualLines = 0; // 统计视觉行数，用于判断单行情形

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // 空行处理 - 增加段落间距
    if (!trimmedLine) {
      if (!previousWasEmpty && i > 0) {
        totalContentHeight += FONT_METRICS.PARAGRAPH_SPACING;
      }
      previousWasEmpty = true;
      continue;
    }

    previousWasEmpty = false;

    // 🎯 根据Markdown元素类型计算高度
    let lineHeight = FONT_METRICS.BASE_LINE_HEIGHT;
    let fontSize = FONT_METRICS.BASE_FONT_SIZE;

    if (trimmedLine.startsWith('# ')) {
      lineHeight = FONT_METRICS.H1_LINE_HEIGHT;
      fontSize = FONT_METRICS.H1_FONT_SIZE;
    } else if (trimmedLine.startsWith('## ')) {
      lineHeight = FONT_METRICS.H2_LINE_HEIGHT;
      fontSize = FONT_METRICS.H2_FONT_SIZE;
    } else if (trimmedLine.match(/^#{3,6}\s/)) {
      lineHeight = FONT_METRICS.H3_LINE_HEIGHT;
      fontSize = FONT_METRICS.H3_FONT_SIZE;
    } else if (trimmedLine.match(/^[\*\-\+]\s/) || trimmedLine.match(/^\d+\.\s/)) {
      // 列表项 - 额外添加列表间距
      totalContentHeight += FONT_METRICS.LIST_ITEM_SPACING;
    }

    // 🎯 模拟真实自动换行 - 数学估算法
    const estimatedCharsPerLine = Math.max(
      1,
      Math.floor(availableWidth / Math.max(8, fontSize * 0.6))
    );
    const actualLineCount = Math.max(
      1,
      Math.ceil(trimmedLine.length / estimatedCharsPerLine)
    );
    totalVisualLines += actualLineCount;
    totalContentHeight += lineHeight * actualLineCount;
  }

  // 🎯 单行视觉内容：回归到预设的最小高度，避免额外留白带来的“比标准高”的观感
  if (totalVisualLines <= 1) {
    return metrics.minHeight;
  }

  // 🎯 最终高度组装（多行内容才叠加最小上下留白）
  const finalHeight =
    UI_COMPONENTS.OUTER_BORDER + // 外边框
    UI_COMPONENTS.CONTENT_PADDING + // 内边距
    totalContentHeight + // 实际内容高度
    UI_COMPONENTS.MIN_VERTICAL_SPACING + // 上下留白（仅多行）
    (hasAccentColor ? 0 : 0); // 色带 overlay，不额外增加

  // 确保最小高度
  return Math.max(metrics.minHeight, Math.round(finalHeight));
};

// 📏 文本宽度测量（缓存离屏画布，避免频繁创建）
let __measureCanvas: HTMLCanvasElement | null = null;
let __measureCtx: CanvasRenderingContext2D | null = null;
const getMeasureCtx = (): CanvasRenderingContext2D | null => {
  if (typeof document === 'undefined') return null;
  if (__measureCtx) return __measureCtx;
  try {
    __measureCanvas = document.createElement('canvas');
    __measureCtx = __measureCanvas.getContext('2d');
    return __measureCtx;
  } catch {
    return null;
  }
};
const measureTextWidth = (text: string, fontSize: number = 16, fontFamily: string = 'Inter, system-ui, sans-serif'): number => {
  const ctx = getMeasureCtx();
  if (!ctx) return text.length * Math.max(8, Math.round(fontSize * 0.6));
  ctx.font = `${fontSize}px ${fontFamily}`;
  return ctx.measureText(text).width;
};

// 🎯 智能计算节点最优尺寸（高度优先策略） - 精确版本
export const calculateOptimalNodeSize = (
  content: string,
  currentWidth: number,
  currentHeight: number,
  hasAccentColor?: boolean,
  options: CalculateTextNodeHeightOptions = {}
): { width: number; height: number } => {
  const layout =
    options.layoutPreset ??
    getTextLayoutPreset(options.layoutPresetId ?? DEFAULT_TEXT_LAYOUT_PRESET);
  const metrics = layout.metrics;

  if (!content.trim()) {
    return {
      width: Math.max(metrics.minWidth, currentWidth),
      height: metrics.minHeight
    };
  }

  let finalWidth = Math.max(metrics.minWidth, currentWidth);
  let finalHeight = calculateTextNodeHeight(content, finalWidth, {
    ...options,
    hasAccentColor
  });

  const maxScreenHeight = typeof window !== 'undefined' ? window.innerHeight * 0.8 : 1000;
  const maxScreenWidth = typeof window !== 'undefined' ? window.innerWidth * 0.9 : 1200;

  if (finalWidth > maxScreenWidth) {
    finalWidth = maxScreenWidth;
    finalHeight = calculateTextNodeHeight(content, finalWidth, {
      ...options,
      hasAccentColor
    });
  }

  finalHeight = Math.min(finalHeight, maxScreenHeight);

  return {
    width: Math.round(finalWidth),
    height: Math.round(finalHeight)
  };
};

// === Text auto-width estimation for mindmap nodes ===
// Estimate a reasonable width for text/todo nodes based on content length and preset metrics,
// clamped to [minWidth, 2 * minWidth]. Target is about ~2 visual lines for readability.
export function estimateAutoTextWidth(
  content: string,
  options: { layoutPresetId?: TextLayoutPresetId; layoutPreset?: TextLayoutPreset; nodeType?: 'text' | 'todo'; clamp?: { min?: number; max?: number } } = {}
): number {
  const layout = options.layoutPreset ?? getTextLayoutPreset(options.layoutPresetId ?? DEFAULT_TEXT_LAYOUT_PRESET);
  const metrics = layout.metrics;
  const rhythm = TEXT_MARKDOWN_RHYTHM;

  // Baseline width: use node default width (the "normal" width users expect)
  // Fallback to preset minWidth if defaults are unavailable.
  let baseWidth = 0;
  try {
    const defaults = (DEFAULT_NODE_SIZES as any);
    const key = options.nodeType === 'todo' ? 'todo' : 'text';
    baseWidth = Number(defaults?.[key]?.width) || 0;
  } catch {}
  if (!baseWidth || !Number.isFinite(baseWidth)) {
    baseWidth = Math.max(1, metrics.minWidth);
  }

  // Clamp bounds: allow override via options.clamp; otherwise use [0.5*base, 2*base]
  const MIN_DEFAULT = Math.max(1, Math.round(baseWidth * 0.5));
  const MAX_DEFAULT = Math.max(MIN_DEFAULT, Math.round(baseWidth * 2));
  const MIN = Math.max(1, Math.round(options.clamp?.min ?? MIN_DEFAULT));
  const MAX = Math.max(MIN, Math.round(options.clamp?.max ?? MAX_DEFAULT));

  const text = (content || '').trim();
  if (!text) return MIN; // empty -> use lower bound (e.g., 150 for mindmap)

  // UI paddings/borders consistent with height calculator
  const OUTER_BORDER = 4; // 2 * 2px
  const CONTENT_PADDING = metrics.padding * 2;
  const MIN_HORIZONTAL_SPACING = 16; // 保留：避免文字贴边
  const UI_X = OUTER_BORDER + CONTENT_PADDING + MIN_HORIZONTAL_SPACING;

  // 逐行测量实际宽度（考虑标题字号、列表前缀、行内标记清洗）
  const lines = text.split(/\r?\n/);
  let maxLineWidth = 0;
  const prefixGap = metrics.prefixGap || 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    // 检测标题级别
    let fontSize = 16;
    const headerMatch = line.match(/^\s*(#{1,6})\s+/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      fontSize = level === 1
        ? Math.round(16 * rhythm.heading1.scale)
        : (level === 2 ? Math.round(16 * rhythm.heading2.scale) : Math.round(16 * rhythm.heading3.scale));
    }

    // 检测列表项
    const isList = /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line);

    // 清洗 Markdown 标记（仅对测宽字符生效）
    const cleaned = line
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`([^`]*)`/g, '$1');

    // 测量
    let w = measureTextWidth(cleaned, fontSize);
    // todo节点或列表项，附加前缀留白
    if (options.nodeType === 'todo' || isList) w += prefixGap;
    if (w > maxLineWidth) maxLineWidth = w;
  }

  if (maxLineWidth <= 0) return MIN;
  const estimated = UI_X + Math.ceil(maxLineWidth);
  return Math.max(MIN, Math.min(MAX, Math.round(estimated)));
}

// 🎯 高度优先自动调整函数（专供右键菜单使用）
export const autoResizeTextNodeHeight = (
  content: string,
  currentWidth: number,
  hasAccentColor?: boolean,
  options: CalculateTextNodeHeightOptions = {}
): number => {
  const layout =
    options.layoutPreset ??
    getTextLayoutPreset(options.layoutPresetId ?? DEFAULT_TEXT_LAYOUT_PRESET);

  if (!content.trim()) {
    return layout.metrics.minHeight;
  }

  const optimalHeight = calculateTextNodeHeight(content, currentWidth, {
    ...options,
    hasAccentColor
  });

  const maxScreenHeight = typeof window !== 'undefined' ? window.innerHeight * 0.8 : 1000;
  return Math.min(optimalHeight, maxScreenHeight);
};


// 🎨 Mermaid节点智能尺寸计算（基于SVG内容边界）
export const calculateMermaidNodeSize = (
  nodeId: string,
  currentWidth: number, 
  currentHeight: number,
  diagramType?: string
): { width: number; height: number } => {
  // 🔍 查找对应的Mermaid SVG元素
  const nodeElement = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (!nodeElement) {
    console.warn(`⚠️ 未找到节点元素: ${nodeId}`);
    return { width: currentWidth, height: currentHeight };
  }
  
  // 查找SVG元素
  const svgElement = nodeElement.querySelector('svg') as SVGSVGElement;
  if (!svgElement) {
    console.warn(`⚠️ 未找到SVG元素: ${nodeId}`);
    return { width: currentWidth, height: currentHeight };
  }
  
  try {
    // 🎯 获取SVG内容的真实边界框
    const svgBBox = svgElement.getBBox();
    
    // 🎯 UI组件空间计算（与文本节点保持一致）
    const UI_COMPONENTS = {
      OUTER_BORDER: 4,        // NodeContainer 2px × 2
      CONTENT_PADDING: 32,    // 16px × 2 内边距
      MIN_VERTICAL_SPACING: 16, // Mermaid图表需要更多空间
      MIN_HORIZONTAL_SPACING: 16
    };
    
    const uiSpaceWidth = UI_COMPONENTS.OUTER_BORDER + UI_COMPONENTS.CONTENT_PADDING + UI_COMPONENTS.MIN_HORIZONTAL_SPACING;
    const uiSpaceHeight = UI_COMPONENTS.OUTER_BORDER + UI_COMPONENTS.CONTENT_PADDING + UI_COMPONENTS.MIN_VERTICAL_SPACING;
    
    // 🎯 根据图表类型调整尺寸策略
    let scaleFactor = 1.0;
    let minWidth = 200;
    let minHeight = 120;
    
    if (diagramType) {
      switch (diagramType.toLowerCase()) {
        case 'flowchart':
        case 'graph':
          scaleFactor = 1.1; // 流程图需要更多空间
          minWidth = 250;
          minHeight = 150;
          break;
        case 'sequence':
        case 'sequencediagram':
          scaleFactor = 1.15; // 时序图通常更宽
          minWidth = 300;
          minHeight = 200;
          break;
        case 'mindmap':
          scaleFactor = 1.2; // 思维导图需要最多空间
          minWidth = 280;
          minHeight = 180;
          break;
        case 'class':
        case 'classDiagram':
          scaleFactor = 1.05; // 类图相对紧凑
          minWidth = 220;
          minHeight = 140;
          break;
        default:
          scaleFactor = 1.1;
      }
    }
    
    // 🎯 计算最优尺寸
    const contentWidth = svgBBox.width * scaleFactor;
    const contentHeight = svgBBox.height * scaleFactor;
    
    const optimalWidth = Math.max(minWidth, Math.ceil(contentWidth + uiSpaceWidth));
    const optimalHeight = Math.max(minHeight, Math.ceil(contentHeight + uiSpaceHeight));
    
    // 🎯 屏幕适配边界控制
    const maxScreenWidth = typeof window !== 'undefined' ? window.innerWidth * 0.9 : 1200;
    const maxScreenHeight = typeof window !== 'undefined' ? window.innerHeight * 0.8 : 1000;
    
    const finalWidth = Math.min(optimalWidth, maxScreenWidth);
    const finalHeight = Math.min(optimalHeight, maxScreenHeight);
    
    // 📊 调试日志已禁用 - Mermaid节点尺寸计算
    // console.log(`📊 Mermaid节点尺寸计算 [${nodeId}]:`, {
    //   svgBBox: { width: svgBBox.width, height: svgBBox.height },
    //   diagramType,
    //   scaleFactor,
    //   contentSize: { width: contentWidth, height: contentHeight },
    //   optimalSize: { width: optimalWidth, height: optimalHeight },
    //   finalSize: { width: finalWidth, height: finalHeight }
    // });
    
    return {
      width: finalWidth,
      height: finalHeight
    };
    
  } catch (error) {
    console.error(`❌ Mermaid节点尺寸计算失败 [${nodeId}]:`, error);
    return { width: currentWidth, height: currentHeight };
  }
};

// 🎨 SVG节点智能尺寸计算（基于SVG内容尺寸和宽高比）
export const calculateSvgNodeSize = (
  svgContent: string,
  maxWidth: number = 800,
  maxHeight: number = 600
): { width: number; height: number } => {
  try {
    // 🔍 解析SVG内容获取尺寸信息
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, 'image/svg+xml');
    const svgElement = doc.querySelector('svg') as SVGSVGElement;

    if (!svgElement) {
      console.warn('⚠️ 无法解析SVG内容');
      return { width: 400, height: 400 }; // 默认正方形
    }

    let intrinsicWidth = 0;
    let intrinsicHeight = 0;
    let aspectRatio = 1;

    // 🎯 优先级1: 尝试从viewBox获取尺寸
    const viewBox = svgElement.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.trim().split(/\s+|,/);
      if (parts.length === 4) {
        intrinsicWidth = parseFloat(parts[2]);
        intrinsicHeight = parseFloat(parts[3]);
      }
    }

    // 🎯 优先级2: 尝试从width/height属性获取
    if (intrinsicWidth === 0 || intrinsicHeight === 0) {
      const widthAttr = svgElement.getAttribute('width');
      const heightAttr = svgElement.getAttribute('height');

      if (widthAttr && heightAttr) {
        // 移除单位（px, pt, em等）
        intrinsicWidth = parseFloat(widthAttr.replace(/[^\d.-]/g, '')) || 0;
        intrinsicHeight = parseFloat(heightAttr.replace(/[^\d.-]/g, '')) || 0;
      }
    }

    // 🎯 计算宽高比
    if (intrinsicWidth > 0 && intrinsicHeight > 0) {
      aspectRatio = intrinsicWidth / intrinsicHeight;
    }

    // 🎯 UI组件空间计算（与Mermaid保持一致）
    const UI_COMPONENTS = {
      OUTER_BORDER: 4,        // NodeContainer 2px × 2
      CONTENT_PADDING: 32,    // 16px × 2 内边距
      MIN_VERTICAL_SPACING: 16,
      MIN_HORIZONTAL_SPACING: 16
    };

    const uiSpaceWidth = UI_COMPONENTS.OUTER_BORDER + UI_COMPONENTS.CONTENT_PADDING + UI_COMPONENTS.MIN_HORIZONTAL_SPACING;
    const uiSpaceHeight = UI_COMPONENTS.OUTER_BORDER + UI_COMPONENTS.CONTENT_PADDING + UI_COMPONENTS.MIN_VERTICAL_SPACING;

    // 🎯 尺寸约束
    const MIN_WIDTH = 200;
    const MIN_HEIGHT = 150;
    const DEFAULT_SIZE = 400;

    // 🎯 计算最优显示尺寸
    let displayWidth: number;
    let displayHeight: number;

    if (intrinsicWidth > 0 && intrinsicHeight > 0) {
      // 根据内在尺寸和宽高比计算
      if (aspectRatio > 1) {
        // 宽>高，以宽度为基准
        displayWidth = Math.min(intrinsicWidth, maxWidth - uiSpaceWidth);
        displayHeight = displayWidth / aspectRatio;

        // 如果高度超限，以高度为基准重新计算
        if (displayHeight > maxHeight - uiSpaceHeight) {
          displayHeight = maxHeight - uiSpaceHeight;
          displayWidth = displayHeight * aspectRatio;
        }
      } else {
        // 高>=宽，以高度为基准
        displayHeight = Math.min(intrinsicHeight, maxHeight - uiSpaceHeight);
        displayWidth = displayHeight * aspectRatio;

        // 如果宽度超限，以宽度为基准重新计算
        if (displayWidth > maxWidth - uiSpaceWidth) {
          displayWidth = maxWidth - uiSpaceWidth;
          displayHeight = displayWidth / aspectRatio;
        }
      }
    } else {
      // 无法获取尺寸，使用默认正方形
      displayWidth = DEFAULT_SIZE;
      displayHeight = DEFAULT_SIZE;
    }

    // 🎯 应用最小尺寸限制
    displayWidth = Math.max(displayWidth, MIN_WIDTH);
    displayHeight = Math.max(displayHeight, MIN_HEIGHT);

    // 🎯 添加UI组件空间
    const finalWidth = Math.ceil(displayWidth + uiSpaceWidth);
    const finalHeight = Math.ceil(displayHeight + uiSpaceHeight);

    // 📊 调试日志
    console.log(`📊 SVG节点尺寸计算:`, {
      intrinsicSize: { width: intrinsicWidth, height: intrinsicHeight },
      aspectRatio: aspectRatio.toFixed(2),
      displaySize: { width: displayWidth.toFixed(0), height: displayHeight.toFixed(0) },
      finalSize: { width: finalWidth, height: finalHeight }
    });

    return {
      width: finalWidth,
      height: finalHeight
    };

  } catch (error) {
    console.error(`❌ SVG节点尺寸计算失败:`, error);
    return { width: 400, height: 400 }; // 后备默认值
  }
};

// ===== 全局避让：批量尺寸优化后，最小必要下推以避免重叠（仅调Y，不改X） =====
// - 作用对象：自由节点（非 group、非 mindmap 子节点、非 column 子节点）
// - 策略：按 y 从小到大稳定排序；每个节点如与已放置节点在 X 方向有区间交叠，则将当前节点 top 提升到对方 bottom + minGap
// - 复杂度：O(n^2) 最坏；一般画布规模下可接受。如需，可改用网格索引优化邻域查询
export function computeGlobalOverlapReflow(
  canvas: Canvas,
  options: { changedNodeIds?: string[]; minGapY?: number } = {}
): Map<string, { x: number; y: number }> {
  const minGap = Math.max(12, options.minGapY ?? 16);
  const byId = new Map(canvas.nodes.map(n => [n.id, n] as const));
  const containers = new Map<string, CanvasNode>();
  for (const n of canvas.nodes) containers.set(n.id, n);
  const isMindmapChild = (n: CanvasNode): boolean => {
    const pid = (n as any).parentGroupId as string | undefined;
    if (!pid) return false;
    const container = containers.get(pid);
    return Boolean(container && container.type === 'group' && (container as any).mindmap);
  };
  const isColumnChild = (n: CanvasNode): boolean => {
    const pid = (n as any).parentGroupId as string | undefined;
    if (!pid) return false;
    const container = containers.get(pid);
    return Boolean(container && container.type === 'column');
  };

  // 候选：排除 group、自身为列、mindmap 子节点、列子节点
  const candidates = canvas.nodes.filter(n => {
    if ((n as any).type === 'group') return false;
    if ((n as any).type === 'column') return false;
    if (isMindmapChild(n)) return false;
    if (isColumnChild(n)) return false;
    return true;
  });

  // 仅当 changedNodeIds 提供时，可缩小作用域到其邻域；否则全量
  let scope = candidates;
  if (options.changedNodeIds && options.changedNodeIds.length > 0) {
    const changed = new Set(options.changedNodeIds);
    // 构建空间索引，找出与 changed 节点可能交叠的邻居
    const idx = buildSpatialIndex(candidates);
    const neighborSet = new Set<string>();
    for (const id of changed) {
      const n = byId.get(id);
      if (!n) continue;
      const neigh = queryRect(idx, n.x - 1, n.y - 1, n.x + n.width + 1, n.y + n.height + 1);
      for (const m of neigh) neighborSet.add(m.id);
      neighborSet.add(id);
    }
    scope = candidates.filter(n => neighborSet.has(n.id));
  }

  // 稳定排序（先 y、再 x、再 id）
  const sorted = [...scope].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
  });

  const placed: Array<{ x0: number; x1: number; bottom: number }> = [];
  const updates = new Map<string, { x: number; y: number }>();

  for (const n of sorted) {
    const width = n.width || 200;
    const height = n.height || 60;
    const x0 = n.x;
    const x1 = n.x + width;
    const top = updates.get(n.id)?.y ?? n.y; // 若已被前序逻辑移动过，取最新
    let bottom = top + height;

    // 与已放置集合比较：若 X 区间交叠，则要求 top ≥ 该项 bottom + minGap
    let requiredTop = top;
    for (const p of placed) {
      const overlapX = !(x1 <= p.x0 || x0 >= p.x1);
      if (overlapX) {
        requiredTop = Math.max(requiredTop, p.bottom + minGap);
      }
    }
    if (requiredTop > top) {
      const newTop = Math.round(requiredTop);
      updates.set(n.id, { x: n.x, y: newTop });
      bottom = newTop + height;
    }
    placed.push({ x0, x1, bottom });
  }

  return updates;
}

// 🏭 统一节点创建入口不再从此处导出，避免形成循环依赖
// 请直接从 '../components/core/systems/NodeFactory' 导入 createNode

// ✏️ 更新节点 (扁平化结构)
export const updateNode = (node: CanvasNode, updates: UpdateNodeOptions): CanvasNode => {
  return {
    ...node,
    ...updates,
    updatedAt: getCurrentTimestamp()
  };
};

// 🔗 创建连线 (扁平化结构) - 使用语义化连接ID
export const createConnection = (from: string, to: string, canvasId: string, label?: string): CanvasConnection => {
  return {
    id: NodeIds.generateConnectionId(canvasId),
    from,
    to,
    label,
    createdAt: getCurrentTimestamp(),
    // Node-to-node connections default to side-midpoints; free lines are created via fromPoint/toPoint path.
    appearance: { endpointStrategy: 'side-midpoints' },
  };
};

// Merge connection appearance while preserving base endpoint strategy unless explicitly overridden.
export const mergeConnectionAppearance = (
  base?: ConnectionAppearance,
  override?: Partial<ConnectionAppearance> | null,
): ConnectionAppearance | undefined => {
  if (!base && !override) return undefined;
  const nextBase = (base || {}) as ConnectionAppearance;
  const nextOverride = (override || {}) as Partial<ConnectionAppearance>;
  const merged: ConnectionAppearance = {
    ...nextBase,
    ...nextOverride,
  };
  if (nextBase.arrow || nextOverride.arrow) {
    merged.arrow = {
      ...(nextBase.arrow || {}),
      ...(nextOverride.arrow || {}),
    };
  }
  if (Array.isArray(nextOverride.dashArray)) {
    merged.dashArray = [...nextOverride.dashArray];
  } else if (Array.isArray(nextBase.dashArray)) {
    merged.dashArray = [...nextBase.dashArray];
  }
  return merged;
};

// ✏️ 更新连线 (扁平化结构)
export const updateConnection = (connection: CanvasConnection, label?: string): CanvasConnection => {
  return {
    ...connection,
    label
  };
};

// 🗑️ 删除节点及相关连线
export const deleteNode = (canvas: Canvas, nodeId: string): Canvas => {
  // 先删除目标节点
  const remainingNodes = canvas.nodes.filter(node => node.id !== nodeId);
  // 清理所有收集栏的 children 引用
  const cleanedNodes = remainingNodes.map(node => {
    if (node.type === 'column' && node.children && node.children.includes(nodeId)) {
      return { ...node, children: node.children.filter(id => id !== nodeId) };
    }
    return node;
  });

  return {
    ...canvas,
    nodes: cleanedNodes,
    connections: canvas.connections.filter(
      conn => conn.from !== nodeId && conn.to !== nodeId
    ),
    updatedAt: getCurrentTimestamp()
  };
};

// 🗑️ 删除连线
export const deleteConnection = (canvas: Canvas, connectionId: string): Canvas => {
  return {
    ...canvas,
    connections: canvas.connections.filter(conn => conn.id !== connectionId),
    updatedAt: getCurrentTimestamp()
  };
};

// 🤖 转换为AI上下文格式 (适配扁平化结构)
export const toAIContext = (canvas: Canvas): AIContext => {
  const isNonGroupNode = (node: CanvasNode): node is CanvasNode & { type: Exclude<CanvasNode['type'], 'group'> } => node.type !== 'group';
  const serializeTableData = (node: CanvasNode) => {
    if (node.type !== 'table' || !node.data || !Array.isArray((node.data as any).rows)) {
      return undefined;
    }
    const rows = (node.data as StructuredTableData).rows || [];
    const MAX_ROWS = 50;
    const limitedRows = rows.slice(0, MAX_ROWS).map(row => (Array.isArray(row) ? row.map(cell => String(cell ?? '')) : []));
    const truncated = rows.length > MAX_ROWS;
    return {
      rows: limitedRows,
      columnWidths: (node.data as any).columnWidths || undefined,
      rowHeights: (node.data as any).rowHeights || undefined,
      totalRows: rows.length,
      truncated,
    };
  };
  return {
    canvas: {
      title: canvas.title,
      nodes: canvas.nodes
        .filter(isNonGroupNode)
        .map(node => ({
        id: node.id,
        type: node.type,
        content: node.content,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        title: node.title,
        codeType: node.codeType,
        children: node.children,
        isCollapsed: node.isCollapsed,
        ai: node.ai,
        tableData: serializeTableData(node)
      })),
      connections: canvas.connections.map(conn => ({
        id: conn.id,
        from: conn.from,
        to: conn.to,
        label: conn.label
      }))
    }
  };
};

// 🔄 从AI上下文恢复画布（部分）(适配扁平化结构)
export const fromAIContext = (context: AIContext): Partial<Canvas> => {
  const now = getCurrentTimestamp();
  
  const nodes: CanvasNode[] = context.canvas.nodes.map(nodeData => {
    const baseNode: CanvasNode = {
      id: nodeData.id,
      type: nodeData.type,
      x: nodeData.x,
      y: nodeData.y,
      width: nodeData.width || getNodeDefaultSize(nodeData.type, nodeData.codeType).width,
      height: nodeData.height || getNodeDefaultSize(nodeData.type, nodeData.codeType).height,
      content: nodeData.content || '',
      createdAt: now,
      updatedAt: now,
      ai: nodeData.ai || false
    };
    
    // 添加特定类型字段
    if (nodeData.title) {
      baseNode.title = nodeData.title;
    }
    if (nodeData.codeType) {
      baseNode.codeType = nodeData.codeType;
    }
    if (nodeData.children) {
      baseNode.children = nodeData.children;
    }
    if (nodeData.isCollapsed !== undefined) {
      baseNode.isCollapsed = nodeData.isCollapsed;
    }
    
    return baseNode;
  });
  
  const connections: CanvasConnection[] = context.canvas.connections.map(connData => ({
    id: connData.id || NodeIds.generateConnectionId(),
    from: connData.from,
    to: connData.to,
    label: connData.label,
    createdAt: now
  }));
  
  return {
    title: context.canvas.title,
    nodes,
    connections,
    updatedAt: now
  };
};

// ✅ 验证画布数据 (适配扁平化结构)
export const validateCanvas = (canvas: Canvas): boolean => {
  try {
    // 检查基本结构
    if (!canvas.id || !canvas.nodes || !canvas.connections) {
      return false;
    }
    
    // 检查节点
    for (const node of canvas.nodes) {
      if (!node.id || !node.type || 
          typeof node.x !== 'number' || typeof node.y !== 'number' ||
          typeof node.width !== 'number' || typeof node.height !== 'number') {
        return false;
      }
      
      if (node.type === 'code' && !node.codeType) {
        return false;
      }
      
      // column 不再要求 title；其标题语义来自 content 首行
    }
    
    // 检查连线引用的节点是否存在
    const nodeIds = new Set(canvas.nodes.map(n => n.id));
    for (const connection of canvas.connections) {
      if (!nodeIds.has(connection.from) || !nodeIds.has(connection.to)) {
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
};

// 📍 查找指定位置的节点 (适配扁平化结构)
export const findNodeAtPosition = (canvas: Canvas, x: number, y: number): CanvasNode | null => {
  // 从后往前查找（后添加的节点在上层）
  for (let i = canvas.nodes.length - 1; i >= 0; i--) {
    const node = canvas.nodes[i];
    
    if (x >= node.x && 
        x <= node.x + node.width &&
        y >= node.y && 
        y <= node.y + node.height) {
      return node;
    }
  }
  
  return null;
};

// 📊 获取画布统计信息 (适配扁平化结构)
export const getCanvasStats = (canvas: Canvas) => {
  const nodeTypes = canvas.nodes.reduce((acc, node) => {
    let key: string;
    if (node.type === 'code' && node.codeType) {
      key = `${node.type}:${node.codeType}`;
    } else {
      key = node.type;
    }
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const aiGeneratedNodes = canvas.nodes.filter(n => n.ai).length;
  
  // 表格节点统计信息 (基于Markdown内容分析)
  const tableNodes = canvas.nodes.filter(n => n.type === 'table');
  const tableStats = tableNodes.length > 0 ? {
    totalTables: tableNodes.length,
    totalCells: tableNodes.reduce((sum, node) => {
      // 简单估算：基于换行符数量估计表格大小
      const lines = node.content.split('\n').filter(line => line.includes('|'));
      const estimatedRows = Math.max(1, lines.length - 1); // 减去表头分隔符行
      const estimatedCols = lines.length > 0 ? (lines[0].split('|').length - 2) : 1; // 减去两端的空|
      return sum + (estimatedRows * estimatedCols);
    }, 0)
  } : undefined;
  
  return {
    totalNodes: canvas.nodes.length,
    totalConnections: canvas.connections.length,
    nodeTypes,
    aiGeneratedNodes,
    humanGeneratedNodes: canvas.nodes.length - aiGeneratedNodes,
    ...(tableStats && { tableStats })
  };
};

// 📦 将节点添加到收集栏
export const addNodeToColumn = (canvas: Canvas, nodeId: string, columnId: string): Canvas => {
  const nodeIndex = canvas.nodes.findIndex((n) => n.id === nodeId);
  const columnIndex = canvas.nodes.findIndex((n) => n.id === columnId);

  if (nodeIndex === -1 || columnIndex === -1) {
    throw new Error('Node or column not found');
  }

  const nodeToAdd = canvas.nodes[nodeIndex];
  const columnNode = canvas.nodes[columnIndex];

  if (columnNode.type !== 'column') {
    throw new Error('Target node is not a column');
  }

  // 禁止 column 节点作为子项被收集（不允许列嵌套列）
  if (nodeToAdd.type === 'column') {
    try { console.warn('[addNodeToColumn] Ignored: cannot add a column into a column.'); } catch {}
    return canvas;
  }

  // 检查节点是否已经在收集栏中
  if (columnNode.children && columnNode.children.includes(nodeId)) {
    return canvas;
  }

  const updatedColumn = {
    ...columnNode,
    children: [...(columnNode.children || []), nodeId],
    updatedAt: getCurrentTimestamp(),
  } as CanvasNode;

  return {
    ...canvas,
    nodes: canvas.nodes.map((node, index) => (index === columnIndex ? updatedColumn : node)),
    updatedAt: getCurrentTimestamp(),
  };
};

// 📦 从收集栏移除节点
export const removeNodeFromColumn = (canvas: Canvas, nodeId: string, columnId: string): Canvas => {
  const columnIndex = canvas.nodes.findIndex(n => n.id === columnId);
  
  if (columnIndex === -1) {
    throw new Error('Column not found');
  }
  
  const columnNode = canvas.nodes[columnIndex];
  if (columnNode.type !== 'column') {
    throw new Error('Target node is not a column');
  }
  
  const updatedColumn = {
    ...columnNode,
    children: (columnNode.children || []).filter(id => id !== nodeId),
    updatedAt: getCurrentTimestamp()
  };
  
  return {
    ...canvas,
    nodes: canvas.nodes.map((node, index) => 
      index === columnIndex ? updatedColumn : node
    ),
    updatedAt: getCurrentTimestamp()
  };
};

// 📦 移动节点到收集栏（从其他收集栏或画布）
export const moveNodeToColumn = (canvas: Canvas, nodeId: string, targetColumnId: string): Canvas => {
  // 首先从所有收集栏中移除该节点
  let updatedCanvas = canvas;
  
  for (const node of canvas.nodes) {
    if (node.type === 'column' && node.children && node.children.includes(nodeId)) {
      updatedCanvas = removeNodeFromColumn(updatedCanvas, nodeId, node.id);
    }
  }
  
  // 然后添加到目标收集栏
  return addNodeToColumn(updatedCanvas, nodeId, targetColumnId);
};

// 📦 移动节点到收集栏（指定插入索引）

// 📦 移动节点到收集栏（指定插入索引）

// 📦 获取节点所属的收集栏 (适配扁平化结构)
export const getNodeParentColumn = (canvas: Canvas, nodeId: string): CanvasNode | null => {
  for (const node of canvas.nodes) {
    if (node.type === 'column' && node.children && node.children.includes(nodeId)) {
      return node;
    }
  }
  return null;
};

// 📦 检查位置是否在收集栏内 (适配扁平化结构)
export const isPositionInColumn = (canvas: Canvas, x: number, y: number): CanvasNode | null => {
  for (const node of canvas.nodes) {
    if (node.type === 'column') {
      if (x >= node.x && 
          x <= node.x + node.width &&
          y >= node.y && 
          y <= node.y + node.height) {
        return node;
      }
    }
  }
  return null;
};

// 📊 表格专用工具函数 - 基于Markdown格式

// ✅ 验证表格Markdown内容
export const validateTableMarkdown = (content: string): boolean => {
  try {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 3) return false; // 最少需要标题行、分隔符行、数据行
    
    // 检查是否包含表格分隔符行
    const separatorLine = lines.find(line => line.includes('---') || line.includes(':-:') || line.includes(':--'));
    return !!separatorLine;
  } catch {
    return false;
  }
};

// 📏 计算表格尺寸（基于Markdown内容）
export const calculateTableDimensions = (markdownContent: string): { width: number; height: number } => {
  const minCellWidth = 120;
  const minCellHeight = 40;
  const headerHeight = 50;
  const padding = 16;
  
  try {
    const lines = markdownContent.split('\n').filter(line => line.includes('|'));
    
    if (lines.length === 0) {
      return { width: 400, height: 130 }; // 默认尺寸
    }
    
    // 计算列数（基于第一行）
    const columns = Math.max(1, lines[0].split('|').length - 2); // 减去两端的空|
    
    // 计算行数（减去分隔符行）
    const rows = Math.max(1, lines.length - 1);
    
    return {
      width: (columns * minCellWidth) + (padding * 2),
      height: headerHeight + (rows * minCellHeight) + (padding * 2)
    };
  } catch {
    return { width: 400, height: 130 }; // 出错时返回默认尺寸
  }
};

// 🎨 默认字体样式
export const DEFAULT_FONT_STYLE: FontStyle = {
  id: 'mono',
  name: '等宽字体',
  className: 'font-mono',
  // Use a stable monospace stack across platforms.
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
};

// 🎨 创建空画布
export const createEmptyCanvas = (title: string = DEFAULT_CANVAS_TITLE, id?: string): Canvas => {
  const now = getCurrentTimestamp();
  return {
    id: id || generateId(),
    title,
    nodes: [],
    connections: [],
    createdAt: now,
    updatedAt: now,
    serverVersion: now,
    version: '1.0',
    fontStyle: DEFAULT_FONT_STYLE.id,
    backgroundStyleId: 'dots-medium',
    backgroundColor: '#eeeded',
    patternColor: '#C7C9CA',
    cornerStyle: DEFAULT_CORNER_STYLE.id,  // 默认使用中圆角
    textOpacityPreset: DEFAULT_TEXT_OPACITY_PRESET,
    textLayoutPreset: DEFAULT_TEXT_LAYOUT_PRESET
  };
};

// 🔍 类型守卫函数 - 确保数据迁移安全性
export const isLegacyNode = (node: any): boolean => {
  return (
    node &&
    typeof node === 'object' &&
    (node.hasOwnProperty('position') || 
     node.hasOwnProperty('size') ||
     node.hasOwnProperty('created') ||
     node.hasOwnProperty('updated'))
  );
};

export const isLegacyConnection = (connection: any): boolean => {
  return (
    connection &&
    typeof connection === 'object' &&
    (connection.hasOwnProperty('created') || connection.hasOwnProperty('updated'))
  );
};

export const isLegacyCanvas = (canvas: any): boolean => {
  return (
    canvas &&
    typeof canvas === 'object' &&
    (canvas.hasOwnProperty('created') || 
     canvas.hasOwnProperty('updated') ||
     (canvas.nodes && canvas.nodes.some(isLegacyNode)) ||
     (canvas.connections && canvas.connections.some(isLegacyConnection)))
  );
};

// 🔄 数据迁移函数 - 将旧格式转换为新格式
export const migrateLegacyNode = (node: any): CanvasNode => {
  if (!isLegacyNode(node)) return node;

  const now = getCurrentTimestamp();
  const migratedNode: any = { ...node };

  // 迁移位置信息
  if (node.position) {
    migratedNode.x = node.position.x ?? 0;
    migratedNode.y = node.position.y ?? 0;
    delete migratedNode.position;
  }

  // 迁移尺寸信息
  if (node.size) {
    migratedNode.width = node.size.width ?? 200;
    migratedNode.height = node.size.height ?? 100;
    delete migratedNode.size;
  }

  // 迁移时间戳
  if (node.created && typeof node.created === 'string') {
    migratedNode.createdAt = new Date(node.created).getTime();
    delete migratedNode.created;
  }
  
  if (node.updated && typeof node.updated === 'string') {
    migratedNode.updatedAt = new Date(node.updated).getTime();
    delete migratedNode.updated;
  }

  // 确保必要字段存在
  migratedNode.createdAt = migratedNode.createdAt ?? now;
  migratedNode.updatedAt = migratedNode.updatedAt ?? now;
  
  return migratedNode as CanvasNode;
};

export const migrateLegacyConnection = (connection: any): CanvasConnection => {
  if (!isLegacyConnection(connection)) return connection;

  const now = getCurrentTimestamp();
  const migratedConnection: any = { ...connection };

  // 迁移时间戳
  if (connection.created && typeof connection.created === 'string') {
    migratedConnection.createdAt = new Date(connection.created).getTime();
    delete migratedConnection.created;
  }
  
  if (connection.updated && typeof connection.updated === 'string') {
    migratedConnection.updatedAt = new Date(connection.updated).getTime();
    delete migratedConnection.updated;
  }

  // 确保必要字段存在
  migratedConnection.createdAt = migratedConnection.createdAt ?? now;
  
  return migratedConnection as CanvasConnection;
};

export const migrateLegacyCanvas = (canvas: any): Canvas => {
  if (!isLegacyCanvas(canvas)) return canvas;

  const now = getCurrentTimestamp();
  const migratedCanvas: any = { ...canvas };

  // 迁移时间戳
  if (canvas.created && typeof canvas.created === 'string') {
    migratedCanvas.createdAt = new Date(canvas.created).getTime();
    delete migratedCanvas.created;
  }
  
  if (canvas.updated && typeof canvas.updated === 'string') {
    migratedCanvas.updatedAt = new Date(canvas.updated).getTime();
    delete migratedCanvas.updated;
  }

  // 迁移节点
  if (canvas.nodes) {
    migratedCanvas.nodes = canvas.nodes.map(migrateLegacyNode);
  }

  // 迁移连接
  if (canvas.connections) {
    migratedCanvas.connections = canvas.connections.map(migrateLegacyConnection);
  }

  // 确保必要字段存在
  migratedCanvas.createdAt = migratedCanvas.createdAt ?? now;
  migratedCanvas.updatedAt = migratedCanvas.updatedAt ?? now;
  migratedCanvas.version = migratedCanvas.version ?? '1.0';
  
  return migratedCanvas as Canvas;
};

// 🤖 AI输入栏相关工具函数实现

// 📝 将CanvasNode转换为简化的选中节点信息
export const nodeToSelectedInfo = (node: CanvasNode): NodeInfoForAI => {
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    contentPreview: generateContentPreview(node.content, 50),
    codeType: node.codeType,
    isLocked: node.locked,
    targetCanvasId: node.targetCanvasId,
    completed: node.completed
  };
};

// ✂️ 生成内容预览（截断长内容）
export const generateContentPreview = (content: string, maxLength: number = 50): string => {
  if (!content) return '空内容';
  
  // 清理内容：移除多余的换行符和空格
  const cleanContent = content.trim().replace(/\s+/g, ' ');
  
  if (cleanContent.length <= maxLength) {
    return cleanContent;
  }
  
  return cleanContent.substring(0, maxLength) + '...';
};

// 🎨 获取节点类型图标信息
export const getNodeTypeIcon = (nodeType: CanvasNode['type']): NodeTypeIcon => {
  return NODE_TYPE_ICONS[nodeType];
};

// ✅ 验证选中节点数量
export const validateSelectedNodes = (nodes: CanvasNode[], maxCount: number = 10): boolean => {
  return nodes.length > 0 && nodes.length <= maxCount;
};

// 🤖 格式化节点信息为AI可读格式
export const formatNodesForAI = (nodes: CanvasNode[]): string => {
  if (nodes.length === 0) {
    return '当前没有选中任何节点。';
  }
  
  const nodeDescriptions = nodes.map((node, index) => {
    const typeIcon = getNodeTypeIcon(node.type);
    let description = `${index + 1}. ${typeIcon.glyph} ${typeIcon.label}节点`;
    
    if (node.title) {
      description += ` "${node.title}"`;
    }
    
    description += `（ID: ${node.id}）`;
    
    // 添加特定类型的额外信息
    if (node.type === 'code' && node.codeType) {
      description += ` - ${node.codeType === 'mermaid' ? 'Mermaid图表' : 'HTML代码'}`;
    }
    
    if (node.type === 'column' && node.children) {
      description += ` - 包含${node.children.length}个子项`;
    }
    
    if (node.type === 'table') {
      // 分析表格大小
      const lines = node.content.split('\n').filter(line => line.includes('|'));
      const estimatedRows = Math.max(1, lines.length - 1);
      const estimatedCols = lines.length > 0 ? Math.max(1, lines[0].split('|').length - 2) : 1;
      description += ` - ${estimatedRows}行${estimatedCols}列`;
    }
    
    // 添加内容预览
    const preview = generateContentPreview(node.content, 30);
    if (preview !== '空内容') {
      description += `\n   内容预览: "${preview}"`;
    }
    
    if (node.locked) {
      description += ' [已锁定]';
    }
    
    return description;
  }).join('\n\n');
  
  return `当前选中了${nodes.length}个节点：\n\n${nodeDescriptions}`;
};

// 📊 AI节点处理工具函数集合
export const canvasAIInputHelpers: AINodeHelpers = {
  nodeToSelectedInfo,
  generateContentPreview,
  getNodeTypeIcon,
  validateSelectedNodes,
  formatNodesForAI
};

// 🎯 创建AI消息的工具函数
export const createAIMessage = (
  content: string,
  targetNodeIds?: string[],
  action?: 'edit' | 'create' | 'analyze' | 'suggest'
) => {
  return {
    content,
    targetNodeIds,
    action,
    timestamp: getCurrentTimestamp()
  };
};

// 🔍 查找节点by ID（批量）
export const findNodesByIds = (canvas: Canvas, nodeIds: string[]): CanvasNode[] => {
  const nodeMap = new Map(canvas.nodes.map(node => [node.id, node]));
  return nodeIds.map(id => nodeMap.get(id)).filter(Boolean) as CanvasNode[];
};

// 📋 获取选中节点的统计信息
export const getSelectedNodesStats = (nodes: CanvasNode[]) => {
  const stats = {
    total: nodes.length,
    byType: {} as Record<string, number>,
    totalContent: 0,
    lockedCount: 0,
    aiGeneratedCount: 0
  };
  
  nodes.forEach(node => {
    // 统计节点类型
    const typeKey = node.type === 'code' && node.codeType 
      ? `${node.type}:${node.codeType}` 
      : node.type;
    stats.byType[typeKey] = (stats.byType[typeKey] || 0) + 1;
    
    // 统计内容长度
    stats.totalContent += node.content.length;
    
    // 统计特殊状态
    if (node.locked) stats.lockedCount++;
    if (node.ai) stats.aiGeneratedCount++;
  });
  
  return stats;
};

// 🎨 生成选中节点的样式建议
export const generateNodeStyleSuggestions = (nodes: CanvasNode[]): string[] => {
  const suggestions: string[] = [];
  
  if (nodes.length === 0) return suggestions;
  
  // 基于节点类型生成建议
  const hasTextNodes = nodes.some(n => n.type === 'text');
  const hasCodeNodes = nodes.some(n => n.type === 'code');
  const hasTableNodes = nodes.some(n => n.type === 'table');
  
  if (hasTextNodes) {
    suggestions.push('优化文本格式和排版');
    suggestions.push('添加标题层级结构');
  }
  
  if (hasCodeNodes) {
    suggestions.push('格式化代码内容');
    suggestions.push('添加代码注释');
  }
  
  if (hasTableNodes) {
    suggestions.push('优化表格数据展示');
    suggestions.push('添加表格标题和描述');
  }
  
  if (nodes.length > 1) {
    suggestions.push('对齐多个节点布局');
    suggestions.push('创建节点间的连接关系');
  }
  
  return suggestions;
};
