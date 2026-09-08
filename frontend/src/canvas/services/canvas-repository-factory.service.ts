// 🏭 Canvas Repository工厂服务
// 提供统一的Repository创建和切换能力，支持本地存储和未来Supabase切换

import type {
  CanvasRepository,
  CanvasRepositoryFactory,
  RepositoryType,
  RepositoryConfig,
  CanvasVersion,
  CreateCanvasData,
  UpdateCanvasData
} from '../types/canvas-repository';
import { FileCanvasRepository } from './canvas-file-repository.service';
import { requiredEnv } from '@/lib/env-utils';

// 预留Supabase实现接口
interface SupabaseCanvasRepository extends CanvasRepository {
  // Supabase特有方法可在此扩展
}

/**
 * Canvas Repository工厂实现
 * 负责创建和管理不同类型的Repository实例
 */
class CanvasRepositoryFactoryImpl implements CanvasRepositoryFactory {
  private currentType: RepositoryType = 'file';
  private currentRepository: CanvasRepository | null = null;
  private config: RepositoryConfig;

  constructor() {
    // 默认配置
    this.config = {
      type: 'file',
      file: {
        // 可选择直连后端或使用 Next Route 代理
        // 直连: NEXT_PUBLIC_BACKEND_URL
        // 代理: '/api' (避免CORS/鉴权问题)
        apiBase: process.env.NEXT_PUBLIC_CANVAS_API_MODE === 'direct'
          ? requiredEnv('NEXT_PUBLIC_BACKEND_URL')
          : '/api',
        maxVersions: 50,
      }
    };

    // 从环境变量或localStorage读取配置
    this.loadConfig();
  }

  /**
   * 加载配置
   */
  private loadConfig(): void {
    try {
      // 从localStorage读取配置（仅浏览器环境，支持运行时切换）
      if (typeof window !== 'undefined') {
        const storedConfig = window.localStorage?.getItem('canvas_repository_config');
        if (storedConfig) {
          const parsed = JSON.parse(storedConfig);
          this.config = { ...this.config, ...parsed };
          this.currentType = this.config.type;
        }
      }

      // 从环境变量读取（优先级更高）
      if (typeof window !== 'undefined') {
        // 开发环境和生产环境都使用 file 存储（Next 代理到后端）
        this.currentType = 'file';
      }

    } catch (error) {
      console.warn('[CanvasRepositoryFactory] 加载配置失败，使用默认配置:', error);
    }
  }

  /**
   * 保存配置到localStorage
   */
  private saveConfig(): void {
    try {
      localStorage.setItem('canvas_repository_config', JSON.stringify(this.config));
    } catch (error) {
      console.warn('[CanvasRepositoryFactory] 保存配置失败:', error);
    }
  }

  /**
   * 创建Repository实例
   */
  create(type: RepositoryType): CanvasRepository {
    switch (type) {
      case 'file':
        return new FileCanvasRepository(this.config.file?.apiBase);
      
      case 'supabase':
        // TODO: 实现Supabase Repository
        throw new Error('Supabase Repository尚未实现，请使用file类型');
      
      default:
        throw new Error(`不支持的Repository类型: ${type}`);
    }
  }

  /**
   * 获取当前Repository类型
   */
  getCurrentType(): RepositoryType {
    return this.currentType;
  }

  /**
   * 切换Repository类型
   */
  async switchTo(type: RepositoryType): Promise<void> {
    if (type === this.currentType) {
      return; // 相同类型，无需切换
    }

    try {
      // 数据迁移逻辑（如果需要）
      if (this.currentRepository && type !== this.currentType) {
        await this.migrateData(this.currentType, type);
      }

      // 更新配置
      this.config.type = type;
      this.currentType = type;
      this.saveConfig();

      // 清空当前Repository实例，强制下次创建新实例
      this.currentRepository = null;

      console.log(`[CanvasRepositoryFactory] 已切换到 ${type} Repository`);
      
    } catch (error) {
      console.error('[CanvasRepositoryFactory] 切换Repository失败:', error);
      throw error;
    }
  }

  /**
   * 获取当前Repository实例（单例模式）
   */
  getCurrentRepository(): CanvasRepository {
    if (!this.currentRepository) {
      this.currentRepository = this.create(this.currentType);
    }
    return this.currentRepository;
  }

  /**
   * 数据迁移逻辑（预留给未来使用）
   */
  private async migrateData(from: RepositoryType, to: RepositoryType): Promise<void> {
    console.log(`[CanvasRepositoryFactory] 准备数据迁移: ${from} -> ${to}`);
    
    try {
      // 获取源Repository的数据
      const sourceRepo = this.create(from);
      const data = await sourceRepo.exportData();
      
      // 导入到目标Repository
      const targetRepo = this.create(to);
      await targetRepo.importData(data);
      
      console.log(`[CanvasRepositoryFactory] 数据迁移完成: ${data.canvases.length}个画布, ${data.versions.length}个版本`);
      
    } catch (error) {
      console.error('[CanvasRepositoryFactory] 数据迁移失败:', error);
      throw new Error(`数据迁移失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<RepositoryConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();
    
    // 如果类型发生变化，清空当前实例
    if (newConfig.type && newConfig.type !== this.currentType) {
      this.currentType = newConfig.type;
      this.currentRepository = null;
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): RepositoryConfig {
    return { ...this.config };
  }

  /**
   * 检查Repository健康状态
   */
  async checkHealth(): Promise<{
    type: RepositoryType;
    isHealthy: boolean;
    message: string;
    stats?: any;
  }> {
    try {
      const repo = this.getCurrentRepository();
      const stats = await repo.getStats();
      
      return {
        type: this.currentType,
        isHealthy: true,
        message: '仓库运行正常',
        stats,
      };
      
    } catch (error) {
      return {
        type: this.currentType,
        isHealthy: false,
        message: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  /**
   * 重置到默认状态
   */
  async reset(): Promise<void> {
    try {
      // 清空当前Repository的所有数据
      if (this.currentRepository) {
        await this.currentRepository.clearAll();
      }

      // 重置配置
      localStorage.removeItem('canvas_repository_config');
      this.loadConfig();
      this.currentRepository = null;

      console.log('[CanvasRepositoryFactory] 已重置到默认状态');
      
    } catch (error) {
      console.error('[CanvasRepositoryFactory] 重置失败:', error);
      throw error;
    }
  }
}

// 🎯 导出单例实例
export const canvasRepositoryFactory = new CanvasRepositoryFactoryImpl();

// 🎯 便捷方法：获取当前Repository
export const getCurrentCanvasRepository = (): CanvasRepository => {
  return canvasRepositoryFactory.getCurrentRepository();
};

// 🎯 便捷方法：切换Repository类型
export const switchCanvasRepository = async (type: RepositoryType): Promise<void> => {
  await canvasRepositoryFactory.switchTo(type);
};

// 🎯 调试用：检查Repository状态
export const debugCanvasRepository = async () => {
  const health = await canvasRepositoryFactory.checkHealth();
  console.log('[CanvasRepository Debug]', health);
  return health;
};

// 🎯 导出必需的类型，解决TypeScript导入问题
export type { CanvasVersion, CreateCanvasData, UpdateCanvasData } from '../types/canvas-repository';
