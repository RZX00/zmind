// 🖼️ Canvas缩略图生成服务
// 为画布生成静态缩略图，支持SVG和位图格式

import type { Canvas, CanvasNode } from '../types/canvas';
import { canvasManager } from './canvas-manager.service';

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  scale?: number;
  format?: 'svg' | 'png' | 'jpeg';
  quality?: number;
  backgroundColor?: string;
}

export interface ThumbnailResult {
  url: string;
  width: number;
  height: number;
  format: string;
  generatedAt: number;
}

/**
 * Canvas缩略图生成服务
 * 基于画布数据生成静态缩略图
 */
class CanvasThumbnailService {
  private thumbnailCache = new Map<string, ThumbnailResult>();
  private readonly DEFAULT_OPTIONS: Required<ThumbnailOptions> = {
    width: 280,
    height: 180,
    scale: 0.2,
    format: 'svg',
    quality: 80,
    backgroundColor: '#ffffff'
  };

  /**
   * 生成画布缩略图
   * @param canvasId 画布ID
   * @param options 缩略图选项
   * @returns 缩略图结果
   */
  async generateThumbnail(canvasId: string, options?: ThumbnailOptions): Promise<ThumbnailResult | null> {
    try {
      console.log('🖼️ [Thumbnail] 生成缩略图:', canvasId);
      
      // 获取画布数据
      const canvas = await canvasManager.getCanvas(canvasId);
      if (!canvas) {
        console.warn('❌ [Thumbnail] 画布不存在:', canvasId);
        return null;
      }

      const opts = { ...this.DEFAULT_OPTIONS, ...options };
      const cacheKey = this.getCacheKey(canvasId, opts);
      
      // 检查缓存
      if (this.thumbnailCache.has(cacheKey)) {
        const cached = this.thumbnailCache.get(cacheKey)!;
        console.log('✨ [Thumbnail] 使用缓存缩略图:', canvasId);
        return cached;
      }

      // 生成缩略图
      const result = await this.generateFromCanvas(canvas, opts);
      
      // 缓存结果
      this.thumbnailCache.set(cacheKey, result);
      
      console.log('✅ [Thumbnail] 缩略图生成成功:', canvasId);
      return result;
      
    } catch (error) {
      console.error('❌ [Thumbnail] 缩略图生成失败:', error);
      return null;
    }
  }

  /**
   * 从画布数据生成缩略图
   * @param canvas 画布数据
   * @param options 选项
   * @returns 缩略图结果
   */
  private async generateFromCanvas(canvas: Canvas, options: Required<ThumbnailOptions>): Promise<ThumbnailResult> {
    // 计算画布边界
    const bounds = this.calculateCanvasBounds(canvas);
    
    // 生成SVG
    const svg = this.generateSVG(canvas, bounds, options);
    
    if (options.format === 'svg') {
      // 直接返回SVG
      const url = this.svgToDataUrl(svg);
      return {
        url,
        width: options.width,
        height: options.height,
        format: 'svg',
        generatedAt: Date.now()
      };
    } else {
      // 转换为位图格式
      const url = await this.svgToBitmap(svg, options);
      return {
        url,
        width: options.width,
        height: options.height,
        format: options.format,
        generatedAt: Date.now()
      };
    }
  }

  /**
   * 计算画布边界
   */
  private calculateCanvasBounds(canvas: Canvas): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  } {
    if (!canvas.nodes || canvas.nodes.length === 0) {
      return {
        minX: 0,
        minY: 0,
        maxX: 800,
        maxY: 600,
        width: 800,
        height: 600
      };
    }

    let minX = Number.MAX_SAFE_INTEGER;
    let minY = Number.MAX_SAFE_INTEGER;
    let maxX = Number.MIN_SAFE_INTEGER;
    let maxY = Number.MIN_SAFE_INTEGER;

    for (const node of canvas.nodes) {
      const left = node.x;
      const top = node.y;
      const right = node.x + node.width;
      const bottom = node.y + node.height;

      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, right);
      maxY = Math.max(maxY, bottom);
    }

    // 添加边距
    const padding = 20;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * 生成SVG字符串
   */
  private generateSVG(canvas: Canvas, bounds: any, options: Required<ThumbnailOptions>): string {
    const { width, height, backgroundColor } = options;
    const { minX, minY, width: canvasWidth, height: canvasHeight } = bounds;

    // 计算缩放比例以适应目标尺寸
    const scaleX = width / canvasWidth;
    const scaleY = height / canvasHeight;
    const scale = Math.min(scaleX, scaleY);

    const svgElements: string[] = [];

    // 背景
    svgElements.push(
      `<rect width="100%" height="100%" fill="${backgroundColor}" stroke="none"/>`
    );

    // 渲染节点
    if (canvas.nodes) {
      for (const node of canvas.nodes) {
        const nodeElement = this.renderNodeToSVG(node, minX, minY, scale);
        if (nodeElement) {
          svgElements.push(nodeElement);
        }
      }
    }

    // 渲染连接线
    if (canvas.connections) {
      for (const connection of canvas.connections) {
        const connectionElement = this.renderConnectionToSVG(connection, canvas.nodes || [], minX, minY, scale);
        if (connectionElement) {
          svgElements.push(connectionElement);
        }
      }
    }

    return `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        ${svgElements.join('\n        ')}
      </svg>
    `.trim();
  }

  /**
   * 将节点渲染为SVG元素
   */
  private renderNodeToSVG(node: CanvasNode, offsetX: number, offsetY: number, scale: number): string | null {
    const x = (node.x - offsetX) * scale;
    const y = (node.y - offsetY) * scale;
    const width = node.width * scale;
    const height = node.height * scale;

    const commonAttrs = `x="${x}" y="${y}" width="${width}" height="${height}" rx="4"`;

    switch (node.type) {
      case 'text':
        return `
          <rect ${commonAttrs} fill="#ffffff" stroke="#e2e8f0" stroke-width="1"/>
          <text x="${x + 8}" y="${y + 20}" font-family="system-ui" font-size="12" fill="#374151">
            ${this.truncateText(node.content || node.title || '文本', 20)}
          </text>
        `;

      case 'todo':
        {
          const todoCompleted = (node as any).completed || false;
          const checkboxFill = todoCompleted ? '#10b981' : '#ffffff';
          const textColor = todoCompleted ? '#9ca3af' : '#374151';
          const textDecoration = todoCompleted ? 'line-through' : 'none';
          return `
            <rect ${commonAttrs} fill="#ffffff" stroke="#e2e8f0" stroke-width="1"/>
            <rect x="${x + 8}" y="${y + 8}" width="12" height="12" fill="${checkboxFill}" stroke="#d1d5db" stroke-width="1" rx="2"/>
            ${todoCompleted ? `<path d="M${x + 10} ${y + 13} l2 2 l4 -4" stroke="white" stroke-width="2" fill="none"/>` : ''}
            <text x="${x + 25}" y="${y + 18}" font-family="system-ui" font-size="11" fill="${textColor}" text-decoration="${textDecoration}">
              ${this.truncateText(node.content || node.title || '待办', 18)}
            </text>
          `;
        }

      case 'code':
        {
          const codeType = (node as any).codeType || 'code';
          const bgColor = codeType === 'mermaid' ? '#f0f9ff' : '#1f2937';
          const codeTextColor = codeType === 'mermaid' ? '#0369a1' : '#ffffff';
          return `
            <rect ${commonAttrs} fill="${bgColor}" stroke="#6b7280" stroke-width="1"/>
            <text x="${x + 8}" y="${y + 20}" font-family="monospace" font-size="10" fill="${codeTextColor}">
              ${codeType.toUpperCase()}
            </text>
          `;
        }

      case 'table':
        return `
          <rect ${commonAttrs} fill="#ffffff" stroke="#e2e8f0" stroke-width="1"/>
          <line x1="${x}" y1="${y + 30}" x2="${x + width}" y2="${y + 30}" stroke="#e2e8f0"/>
          <line x1="${x + width/2}" y1="${y}" x2="${x + width/2}" y2="${y + height}" stroke="#e2e8f0"/>
          <text x="${x + 8}" y="${y + 20}" font-family="system-ui" font-size="10" fill="#6b7280">TABLE</text>
        `;

      case 'column':
        return `
          <rect ${commonAttrs} fill="#f8fafc" stroke="#cbd5e1" stroke-width="1"/>
          <text x="${x + 8}" y="${y + 20}" font-family="system-ui" font-size="10" fill="#475569">
            ${this.truncateText(((node.content || '').split('\n')[0] || node.title || 'column'), 15)}
          </text>
        `;

      case 'canvas-link':
        return `
          <rect ${commonAttrs} fill="#fdf2f8" stroke="#ec4899" stroke-width="2"/>
          <circle cx="${x + width/2}" cy="${y + height/2 - 10}" r="12" fill="#ec4899"/>
          <line x1="${x + width/2 - 6}" y1="${y + height/2 - 10}" x2="${x + width/2 + 6}" y2="${y + height/2 - 10}" stroke="white" stroke-width="2"/>
          <line x1="${x + width/2}" y1="${y + height/2 - 16}" x2="${x + width/2}" y2="${y + height/2 - 4}" stroke="white" stroke-width="2"/>
          <text x="${x + 8}" y="${y + height - 10}" font-family="system-ui" font-size="10" fill="#ec4899">
            ${this.truncateText(node.title || 'Canvas Link', 15)}
          </text>
        `;

      case 'code':
        if (node.codeType === 'html') {
          return `
            <rect ${commonAttrs} fill="#fef3c7" stroke="#f59e0b" stroke-width="1"/>
            <text x="${x + 8}" y="${y + 20}" font-family="system-ui" font-size="10" fill="#92400e">HTML</text>
          `;
        }
        // 其他代码类型的处理逻辑
        return `
          <rect ${commonAttrs} fill="#dbeafe" stroke="#3b82f6" stroke-width="1"/>
          <text x="${x + 8}" y="${y + 20}" font-family="system-ui" font-size="10" fill="#1e40af">CODE</text>
        `;

      default:
        return `
          <rect ${commonAttrs} fill="#f3f4f6" stroke="#9ca3af" stroke-width="1"/>
          <text x="${x + 8}" y="${y + 20}" font-family="system-ui" font-size="10" fill="#6b7280">
            ${node.type.toUpperCase()}
          </text>
        `;
    }
  }

  /**
   * 渲染连接线为SVG元素
   */
  private renderConnectionToSVG(connection: any, nodes: CanvasNode[], offsetX: number, offsetY: number, scale: number): string | null {
    try {
      const fromNode = nodes.find(n => n.id === connection.fromNodeId);
      const toNode = nodes.find(n => n.id === connection.toNodeId);
      
      if (!fromNode || !toNode) return null;

      const fromX = (fromNode.x + fromNode.width / 2 - offsetX) * scale;
      const fromY = (fromNode.y + fromNode.height / 2 - offsetY) * scale;
      const toX = (toNode.x + toNode.width / 2 - offsetX) * scale;
      const toY = (toNode.y + toNode.height / 2 - offsetY) * scale;

      return `<line x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${toY}" stroke="#6b7280" stroke-width="1.5" opacity="0.7"/>`;
    } catch (error) {
      console.warn('[Thumbnail] 渲染连接线失败:', error);
      return null;
    }
  }

  /**
   * 截断文本
   */
  private truncateText(text: string, maxLength: number): string {
    const cleaned = text.replace(/[<>&"']/g, ''); // 清理XML特殊字符
    return cleaned.length > maxLength ? cleaned.substring(0, maxLength) + '...' : cleaned;
  }

  /**
   * 将SVG转换为Data URL
   */
  private svgToDataUrl(svg: string): string {
    const base64 = btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${base64}`;
  }

  /**
   * 将SVG转换为位图（占位符实现）
   */
  private async svgToBitmap(svg: string, options: Required<ThumbnailOptions>): Promise<string> {
    // TODO: 实现真正的SVG到位图转换
    // 可以使用Canvas API或第三方库如html2canvas
    console.log('🚧 [Thumbnail] SVG到位图转换功能待实现');
    return this.svgToDataUrl(svg); // 暂时返回SVG
  }

  /**
   * 生成缓存键
   */
  private getCacheKey(canvasId: string, options: Required<ThumbnailOptions>): string {
    return `${canvasId}-${options.width}x${options.height}-${options.scale}-${options.format}`;
  }

  /**
   * 清除指定画布的缓存
   */
  clearThumbnailCache(canvasId: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.thumbnailCache.keys()) {
      if (key.startsWith(canvasId + '-')) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.thumbnailCache.delete(key));
    console.log('🗑️ [Thumbnail] 清除缓存:', canvasId, keysToDelete.length, '条');
  }

  /**
   * 清除所有缓存
   */
  clearAllCache(): void {
    this.thumbnailCache.clear();
    console.log('🗑️ [Thumbnail] 清除所有缓存');
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.thumbnailCache.size,
      keys: Array.from(this.thumbnailCache.keys())
    };
  }
}

// 🎯 导出单例实例
export const canvasThumbnailService = new CanvasThumbnailService();

// 🎯 便捷方法
export const generateCanvasThumbnail = (canvasId: string, options?: ThumbnailOptions) => 
  canvasThumbnailService.generateThumbnail(canvasId, options);

export const clearThumbnailCache = (canvasId: string) => 
  canvasThumbnailService.clearThumbnailCache(canvasId);

export default canvasThumbnailService;
