// 🆔 Canvas ID管理工具 - 全局统一ID生成和验证
// 解决多处生成ID导致的不一致性问题

/**
 * Canvas ID格式标准
 * 格式：canvas_{timestamp}_{randomString}
 * 示例：canvas_1756807439022_uafgxnj3u
 */

const CANVAS_ID_PREFIX = 'canvas_';

/**
 * 生成唯一Canvas ID
 * 全局唯一方法，确保所有Canvas ID格式一致
 */
export function generateCanvasId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  const id = `${CANVAS_ID_PREFIX}${timestamp}_${random}`;
  return id;
}

/**
 * 验证Canvas ID格式是否有效
 */
export function isValidCanvasId(id: string): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }
  
  // 检查格式：canvas_数字_字母数字串
  const pattern = /^canvas_\d+_[a-z0-9]+$/;
  return pattern.test(id);
}

/**
 * 从Canvas ID提取创建时间戳
 */
export function extractTimestampFromCanvasId(id: string): number | null {
  if (!isValidCanvasId(id)) {
    return null;
  }
  
  const parts = id.split('_');
  if (parts.length >= 2) {
    const timestamp = parseInt(parts[1], 10);
    return isNaN(timestamp) ? null : timestamp;
  }
  
  return null;
}

/**
 * 生成用于显示的短ID
 */
export function getShortCanvasId(id: string): string {
  if (!isValidCanvasId(id)) {
    return id;
  }
  
  const parts = id.split('_');
  if (parts.length >= 3) {
    return `${parts[1].slice(-6)}_${parts[2].slice(0, 6)}`;
  }
  
  return id;
}

/**
 * Canvas ID工具类
 * 提供所有ID相关的操作方法
 */
export class CanvasIdManager {
  /**
   * 生成新ID
   */
  static generate(): string {
    return generateCanvasId();
  }
  
  /**
   * 验证ID
   */
  static validate(id: string): boolean {
    return isValidCanvasId(id);
  }
  
  /**
   * 标准化ID（确保格式正确）
   */
  static normalize(id: string): string {
    if (!id) {
      return this.generate();
    }
    
    if (this.validate(id)) {
      return id;
    }
    
    // 如果ID格式不正确，生成新的
    console.warn('🔄 ID格式不正确，生成新ID:', id);
    return this.generate();
  }
  
  /**
   * 比较两个ID是否相同
   */
  static equals(id1: string, id2: string): boolean {
    return id1 === id2;
  }
  
  /**
   * 获取创建时间
   */
  static getCreatedAt(id: string): Date | null {
    const timestamp = extractTimestampFromCanvasId(id);
    return timestamp ? new Date(timestamp) : null;
  }
}

// 🎯 导出默认方法
const canvasIdUtils = {
  generate: generateCanvasId,
  validate: isValidCanvasId,
  normalize: CanvasIdManager.normalize,
  getShort: getShortCanvasId,
  getCreatedAt: CanvasIdManager.getCreatedAt,
  equals: CanvasIdManager.equals,
};

export default canvasIdUtils;
