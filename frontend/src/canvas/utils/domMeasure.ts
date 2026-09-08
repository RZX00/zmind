// 📏 DOM 实测工具：测量已渲染文本节点所需高度
// 基于已渲染的 CanvasMarkdownRenderer 内容，避免启发式误差

import { useCanvasStore } from '../stores/canvas.store';
import {
  DEFAULT_TEXT_LAYOUT_PRESET,
  getTextLayoutPreset
} from '../constants/textNodePresets';

// 计算屏幕高度上限（与编辑器保持一致的保守值）
const getMaxScreenHeight = (): number => {
  if (typeof window === 'undefined') return 1000;
  return Math.floor(window.innerHeight * 0.9);
};

// 获取当前布局预设（或默认）
const getCurrentLayoutMetrics = () => {
  try {
    const { canvas } = useCanvasStore.getState();
    const presetId = canvas?.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET;
    const preset = getTextLayoutPreset(presetId);
    return preset.metrics;
  } catch {
    // 兜底：使用默认预设
    const preset = getTextLayoutPreset(DEFAULT_TEXT_LAYOUT_PRESET);
    return preset.metrics;
  }
};

/**
 * 测量已渲染文本/待办节点的内容高度，并换算为节点所需总高度
 * 规则：
 * - 单行情形：返回当前预设的 minHeight（确保“标准高度”一致）
 * - 多行情形：节点高度 = 边框(4px) + 2×padding + 实际内容高度（再按屏幕上限裁剪）
 * 注意：色带为 overlay，不计入高度
 */
export function measureTextNodeRequiredHeight(nodeId: string): number | null {
  try {
    if (typeof document === 'undefined') return null;
    const container = document.querySelector(`[data-node-id="${nodeId}"]`);
    if (!container) return null;

    const metrics = getCurrentLayoutMetrics();
    const minHeight = metrics.minHeight;
    const paddingY = metrics.padding * 2;

    // 查找渲染的 Markdown 内容根元素
    const contentEl = container.querySelector('.text-node-content') as HTMLElement | null;
    if (!contentEl) return null;

    // 检测“视觉单行”阈值：优先读取计算样式的 line-height；失败时回退到 22px
    let lineHeightPx = 22;
    try {
      const cs = window.getComputedStyle(contentEl);
      const lh = cs.lineHeight;
      if (lh && lh.endsWith('px')) {
        const n = parseFloat(lh);
        if (!Number.isNaN(n) && n > 0) lineHeightPx = n;
      }
    } catch {
      // ignore
    }
    const singleLineThreshold = Math.ceil(lineHeightPx * 1.05);

    // 读取内容总高度
    const contentHeight = contentEl.offsetHeight; // 已包含段落/标题/列表等布局高度

    // 单行：直接回归到预设 minHeight，避免因行高/内边距带来偏移
    if (contentHeight <= singleLineThreshold) {
      return minHeight;
    }

    // 多行：按照 UI 实占空间计算
    const total = 4 /* 边框 */ + paddingY + contentHeight;
    const maxHeight = getMaxScreenHeight();
    return Math.max(minHeight, Math.min(Math.ceil(total), maxHeight));
  } catch {
    return null;
  }
}

/**
 * 批量测量多个文本/待办节点的高度
 */
export function measureBatchTextNodeHeights(nodeIds: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const id of nodeIds) {
    const h = measureTextNodeRequiredHeight(id);
    if (typeof h === 'number') result[id] = h;
  }
  return result;
}

const domMeasure = {
  measureTextNodeRequiredHeight,
  measureBatchTextNodeHeights,
};

export default domMeasure;
