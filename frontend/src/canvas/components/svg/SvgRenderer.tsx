// 🎨 SVG 渲染器组件
// 负责安全解析和渲染 SVG 内容，支持主题应用

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { SvgThemeConfig } from '../../types/canvas';

interface SvgRendererProps {
  content: string;
  theme?: SvgThemeConfig;
  interactive?: boolean;
  showError?: boolean;
  errorMessage?: string | null;
  className?: string;
  // 回调：渲染完成后返回真实的 <svg> 元素引用
  onSvgElementReady?: (svg: SVGSVGElement) => void;
}

export const SvgRenderer: React.FC<SvgRendererProps> = ({
  content,
  theme,
  interactive = false,
  showError = false,
  errorMessage,
  className = '',
  onSvgElementReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  // 从任意字符串里提取第一个 <svg>...</svg> 片段（兼容外层包裹符号/调试信息）
  const extractSvgFragment = useMemo(() => {
    return (source: string): string => {
      if (!source) return source;
      const lower = source.toLowerCase();
      const start = lower.indexOf('<svg');
      if (start === -1) return source;
      const end = lower.lastIndexOf('</svg>');
      if (end === -1) {
        // 没有显式闭合标签时，从 <svg 开始截取到末尾，交给解析器兜底
        return source.slice(start);
      }
      return source.slice(start, end + '</svg>'.length);
    };
  }, []);

  // 🔒 安全清理 SVG 内容
  const sanitizeSvg = useMemo(() => {
    return (svgCode: string): string => {
      // 移除危险的脚本标签和事件处理器
      let cleaned = svgCode;

      // 移除 <script> 标签（不使用 dotAll 标志以兼容较低目标）
      cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

      // 移除内联事件处理器（onclick, onload, onerror 等）
      cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
      cleaned = cleaned.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');

      return cleaned;
    };
  }, []);

  // 🎨 应用主题到 SVG 元素
  const applySvgTheme = useMemo(() => {
    return (svg: SVGElement, themeConfig: SvgThemeConfig) => {
      if (themeConfig.colors) {
        // 应用 CSS 变量
        Object.entries(themeConfig.colors).forEach(([key, value]) => {
          if (value) {
            svg.style.setProperty(`--svg-${key}`, value);
          }
        });
      }

      if (themeConfig.cssVariables) {
        Object.entries(themeConfig.cssVariables).forEach(([key, value]) => {
          svg.style.setProperty(key, value);
        });
      }

      // 应用颜色方案
      svg.setAttribute('data-color-scheme', themeConfig.colorScheme);
    };
  }, []);

  // 🎯 渲染 SVG 内容
  useEffect(() => {
    if (!containerRef.current) return;

    try {
      // 清空容器（仅清理手动挂载的 SVG 根节点，不触碰 React children）
      containerRef.current.innerHTML = '';

      // 先提取 SVG 片段，再进行安全清理
      const rawFragment = extractSvgFragment(content || '');
      const cleanedContent = sanitizeSvg(rawFragment);

      // 解析 SVG
      const parser = new DOMParser();
      const doc = parser.parseFromString(cleanedContent, 'image/svg+xml');
      const errorNode = doc.querySelector('parsererror');

      if (errorNode) {
        setRenderError('SVG 解析错误：代码格式不正确');
        return;
      }

      // 提取 SVG 根元素
      const svgElement = doc.querySelector('svg');
      if (!svgElement) {
        setRenderError('未找到有效的 SVG 元素');
        return;
      }

      // 应用主题
      if (theme) {
        applySvgTheme(svgElement, theme);
      }

      // 设置响应式尺寸
      if (!svgElement.hasAttribute('viewBox')) {
        // 如果没有 viewBox，尝试从 width/height 创建
        const width = svgElement.getAttribute('width') || '100';
        const height = svgElement.getAttribute('height') || '100';
        svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
      }

      // 设置为填充容器
      svgElement.setAttribute('width', '100%');
      svgElement.setAttribute('height', '100%');
      svgElement.style.maxWidth = '100%';
      svgElement.style.maxHeight = '100%';

      // 如果不是交互模式，禁用指针事件
      if (!interactive) {
        svgElement.style.pointerEvents = 'none';
      }

      // 插入 DOM
      containerRef.current.appendChild(svgElement);
      try {
        // 仅当为 <svg> 根时回调
        const asSvg = svgElement as unknown as SVGSVGElement | null;
        if (asSvg && typeof asSvg.getBoundingClientRect === 'function') {
          onSvgElementReady?.(asSvg);
        }
      } catch {}
      setRenderError(null);

    } catch (error: any) {
      console.error('SVG 渲染错误:', error);
      setRenderError(`渲染错误: ${error.message || '未知错误'}`);
    }
  }, [content, theme, interactive, sanitizeSvg, applySvgTheme, onSvgElementReady, extractSvgFragment]);

  // 显示的错误信息
  const displayError = showError ? errorMessage : renderError;

  return (
    <div
      className={`svg-renderer ${className}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          maxWidth: '100%',
          maxHeight: '100%'
        }}
      />
      {displayError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="text-center p-4">
            <div className="text-2xl mb-2">⚠️</div>
            <div className="text-sm text-red-500 dark:text-red-400">
              {displayError}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              请检查 SVG 代码格式是否正确
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SvgRenderer;
