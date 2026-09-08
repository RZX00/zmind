// 🔗 Canvas Link 服务 - 画布链接管理
// 为Canvas Link节点提供专门的画布管理功能

import { canvasManager } from './canvas-manager.service';
import { createEmptyCanvas } from '../utils/canvasUtils';
import type { Canvas } from '../types/canvas';

export interface CanvasLinkInfo {
  id: string;
  title: string;
  lastUpdated: number;
}

/**
 * Canvas Link 专用服务
 * 封装画布管理器的功能，提供Canvas Link节点需要的接口
 */
class CanvasLinkService {

  /**
   * 创建新画布并返回画布ID
   * @param name 画布名称
   * @returns 新创建的画布ID
   */
  async createCanvas(name: string): Promise<string> {
    try {
      const canvas = await canvasManager.createCanvas(name.trim());
      return canvas.id;
    } catch (error) {
      console.error('Canvas Link画布创建失败:', error);
      throw new Error(`画布创建失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 获取所有可用画布的列表
   * @returns 画布信息数组
   */
  async getAvailableCanvases(): Promise<CanvasLinkInfo[]> {
    try {
      // 获取所有画布，按更新时间倒序排列
      const canvases = await canvasManager.getAllCanvases({
        orderBy: 'updated_at',
        orderDirection: 'desc',
        limit: 50 // 限制返回数量避免性能问题
      });

      // 转换为Canvas Link需要的格式
      return canvases.map(canvas => ({
        id: canvas.id,
        title: canvas.title || '未命名画布',
        lastUpdated: canvas.updatedAt
      }));
      
    } catch (error) {
      console.error('Canvas Link获取画布列表失败:', error);
      // 返回空数组而不是抛出错误，避免UI崩溃
      return [];
    }
  }

  /**
   * 检查画布是否存在
   * @param canvasId 画布ID
   * @returns 画布是否存在
   */
  async canvasExists(canvasId: string): Promise<boolean> {
    try {
      return await canvasManager.canvasExists(canvasId);
    } catch (error) {
      console.error('Canvas Link检查画布存在性失败:', error);
      return false;
    }
  }

  /**
   * 获取画布信息（用于验证链接）
   * @param canvasId 画布ID
   * @returns 画布信息或null
   */
  async getCanvasInfo(canvasId: string): Promise<CanvasLinkInfo | null> {
    try {
      const canvas = await canvasManager.getCanvas(canvasId);
      if (!canvas) return null;

      return {
        id: canvas.id,
        title: canvas.title || '未命名画布',
        lastUpdated: canvas.updatedAt
      };
    } catch (error) {
      console.error('Canvas Link获取画布信息失败:', error);
      return null;
    }
  }

  /**
   * 搜索画布（支持模糊匹配）
   * @param query 搜索关键词
   * @returns 匹配的画布信息数组
   */
  async searchCanvases(query: string): Promise<CanvasLinkInfo[]> {
    try {
      const allCanvases = await this.getAvailableCanvases();
      const lowercaseQuery = query.toLowerCase().trim();
      
      if (!lowercaseQuery) return allCanvases;
      
      return allCanvases.filter(canvas => 
        canvas.title.toLowerCase().includes(lowercaseQuery)
      );
    } catch (error) {
      console.error('Canvas Link搜索画布失败:', error);
      return [];
    }
  }

  /**
   * 生成画布缩略图URL
   * @param canvasId 画布ID
   * @returns 缩略图URL或null
   */
  async generateThumbnailUrl(canvasId: string): Promise<string | null> {
    try {
      // 检查画布是否存在
      const exists = await this.canvasExists(canvasId);
      if (!exists) return null;
      
      // 使用缩略图服务生成真正的缩略图
      const { canvasThumbnailService } = await import('./canvas-thumbnail.service');
      const result = await canvasThumbnailService.generateThumbnail(canvasId, {
        width: 280,
        height: 180,
        format: 'svg',
        backgroundColor: '#f8fafc'
      });
      
      return result?.url || null;
      
    } catch (error) {
      console.error('Canvas Link生成缩略图失败:', error);
      return null;
    }
  }
}

// 🎯 导出单例实例
export const canvasLinkService = new CanvasLinkService();

// 🎯 便捷导出方法 - 匹配Canvas Link组件的回调接口
export const createCanvasForLink = (name: string) => canvasLinkService.createCanvas(name);
export const getAvailableCanvasesForLink = () => canvasLinkService.getAvailableCanvases();
export const generateCanvasThumbnail = (canvasId: string) => canvasLinkService.generateThumbnailUrl(canvasId);

export default canvasLinkService;