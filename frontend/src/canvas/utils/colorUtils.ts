/**
 * 🎨 通用颜色工具库
 *
 * 提供颜色格式转换、颜色计算等通用功能
 * 统一处理hexToRgba等常用颜色操作，避免代码重复
 */

/**
 * 将十六进制颜色转换为RGBA格式
 *
 * 支持3位和6位十六进制格式:
 * - #RGB -> #RRGGBB
 * - #RRGGBB -> rgba(r, g, b, a)
 *
 * @param hex - 十六进制颜色值 (#RGB 或 #RRGGBB)
 * @param alpha - 透明度值 (0-1)
 * @returns RGBA颜色字符串
 *
 * @example
 * hexToRgba('#f00', 0.5)     // 'rgba(255, 0, 0, 0.5)'
 * hexToRgba('#ff0000', 0.8)  // 'rgba(255, 0, 0, 0.8)'
 */
export function hexToRgba(hex: string, alpha: number = 1): string {
  // 🛡️ 输入验证
  if (!hex || typeof hex !== 'string') {
    console.warn('hexToRgba: Invalid hex color provided', hex);
    return `rgba(0, 0, 0, ${Math.max(0, Math.min(1, alpha))})`;
  }

  // 🎯 清理输入，移除#号
  const cleanHex = hex.replace('#', '');

  let r = 0, g = 0, b = 0;

  if (cleanHex.length === 3) {
    // 🎯 处理3位格式 #RGB -> #RRGGBB
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  } else if (cleanHex.length === 6) {
    // 🎯 处理6位格式 #RRGGBB
    r = parseInt(cleanHex.substring(0, 2), 16);
    g = parseInt(cleanHex.substring(2, 4), 16);
    b = parseInt(cleanHex.substring(4, 6), 16);
  } else {
    console.warn('hexToRgba: Invalid hex format, expected #RGB or #RRGGBB', hex);
    return `rgba(0, 0, 0, ${Math.max(0, Math.min(1, alpha))})`;
  }

  // 🛡️ 确保透明度在有效范围内
  const normalizedAlpha = Math.max(0, Math.min(1, alpha));

  return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
}

/**
 * 验证十六进制颜色格式是否有效
 *
 * @param hex - 十六进制颜色值
 * @returns 是否为有效的hex颜色
 */
export function isValidHex(hex: string): boolean {
  if (!hex || typeof hex !== 'string') return false;

  const cleanHex = hex.replace('#', '');
  return /^([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/.test(cleanHex);
}

/**
 * 将RGBA颜色转换为十六进制格式
 *
 * @param r - 红色分量 (0-255)
 * @param g - 绿色分量 (0-255)
 * @param b - 蓝色分量 (0-255)
 * @returns 十六进制颜色字符串
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const hex = Math.round(Math.max(0, Math.min(255, n))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 获取颜色的亮度值 (0-1)
 * 基于 WCAG 相对亮度计算公式
 *
 * @param hex - 十六进制颜色值
 * @returns 亮度值 (0为最暗，1为最亮)
 */
export function getColorLuminance(hex: string): number {
  const cleanHex = hex.replace('#', '');

  let r = 0, g = 0, b = 0;

  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  } else if (cleanHex.length === 6) {
    r = parseInt(cleanHex.substring(0, 2), 16);
    g = parseInt(cleanHex.substring(2, 4), 16);
    b = parseInt(cleanHex.substring(4, 6), 16);
  }

  // 转换为相对亮度
  const toLinear = (c: number) => {
    const normalized = c / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * 判断颜色是否为深色
 * 基于亮度阈值判断，用于自动选择对比色
 *
 * @param hex - 十六进制颜色值
 * @param threshold - 亮度阈值 (默认0.5)
 * @returns 是否为深色
 */
export function isDarkColor(hex: string, threshold: number = 0.5): boolean {
  return getColorLuminance(hex) < threshold;
}

/**
 * 获取颜色的对比色（黑色或白色）
 * 用于确保文字在背景上的可读性
 *
 * @param hex - 背景颜色的十六进制值
 * @returns 对比色 (#000000 或 #ffffff)
 */
export function getContrastColor(hex: string): string {
  return isDarkColor(hex) ? '#ffffff' : '#000000';
}

/**
 * 调整颜色的透明度
 *
 * @param hex - 十六进制颜色值
 * @param alpha - 新的透明度值 (0-1)
 * @returns RGBA颜色字符串
 */
export function withAlpha(hex: string, alpha: number): string {
  return hexToRgba(hex, alpha);
}

/**
 * 创建颜色的渐变版本
 *
 * @param hex - 基础颜色
 * @param steps - 渐变步数
 * @param startAlpha - 起始透明度
 * @param endAlpha - 结束透明度
 * @returns 渐变色数组
 */
export function createGradientSteps(
  hex: string,
  steps: number = 5,
  startAlpha: number = 0.1,
  endAlpha: number = 1
): string[] {
  const gradients: string[] = [];
  const stepSize = (endAlpha - startAlpha) / (steps - 1);

  for (let i = 0; i < steps; i++) {
    const alpha = startAlpha + (stepSize * i);
    gradients.push(hexToRgba(hex, alpha));
  }

  return gradients;
}