// 🎨 全局圆角样式常量
// 提供给工具函数与组件共享，避免 utils 与 UI 组件之间形成循环依赖
import type { CornerStyle } from '../types/canvas';
export type { CornerStyle } from '../types/canvas';

export const CORNER_STYLES: CornerStyle[] = [
  {
    id: 'square',
    name: '方角',
    radius: 0,
    className: 'rounded-none',
  },
  {
    id: 'small',
    name: '小圆角',
    radius: 4,
    className: 'rounded',
  },
  {
    id: 'medium',
    name: '中圆角',
    radius: 8,
    className: 'rounded-lg',
  },
  {
    id: 'large',
    name: '大圆角',
    radius: 12,
    className: 'rounded-xl',
  },
  {
    id: 'extra-large',
    name: '超大圆角',
    radius: 16,
    className: 'rounded-2xl',
  },
  {
    id: 'full',
    name: '完全圆角',
    radius: 24,
    className: 'rounded-3xl',
  },
];

export const DEFAULT_CORNER_STYLE_ID = 'medium';
export const DEFAULT_CORNER_STYLE: CornerStyle =
  CORNER_STYLES.find((style) => style.id === DEFAULT_CORNER_STYLE_ID) || CORNER_STYLES[0];
