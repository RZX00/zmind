// 文件夹数据迁移服务
// 从localStorage迁移到后端API存储

import type { FoldersMetadata, Folder } from '../types/folder';
import { requiredEnv } from '@/lib/env-utils';
import { DEFAULT_FOLDERS_METADATA } from '../types/folder';

// API基础配置
const API_BASE_URL = requiredEnv('NEXT_PUBLIC_BACKEND_URL');
const FOLDERS_API_URL = `${API_BASE_URL}/folders`;

export interface MigrationResult {
  success: boolean;
  migratedFolders: number;
  errors: string[];
  details: string[];
}

/**
 * 文件夹数据迁移器
 * 负责将localStorage中的文件夹数据迁移到后端API
 */
class FolderMigrationService {
  private readonly STORAGE_KEY = 'folders_metadata';
  private readonly MIGRATION_FLAG_KEY = 'folders_migration_completed';

  // API请求辅助方法
  private async apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    try {
      const response = await fetch(`${FOLDERS_API_URL}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `API请求失败: ${response.status}`);
      }

      const result = await response.json();
      return result.data || result;
    } catch (error) {
      console.error('迁移API请求失败:', error);
      throw error;
    }
  }

  // 检查是否需要迁移
  async needsMigration(): Promise<boolean> {
    try {
      // 检查是否已完成迁移
      const migrationCompleted = localStorage.getItem(this.MIGRATION_FLAG_KEY);
      if (migrationCompleted === 'true') {
        return false;
      }

      // 检查localStorage中是否有文件夹数据
      const localData = localStorage.getItem(this.STORAGE_KEY);
      if (!localData) {
        return false;
      }

      try {
        const metadata = JSON.parse(localData) as FoldersMetadata;
        const folderCount = Object.keys(metadata.folders || {}).length;
        
        if (folderCount === 0) {
          return false;
        }

        return true;
      } catch (error) {
        console.warn('localStorage数据格式无效:', error);
        return false;
      }
    } catch (error) {
      console.error('迁移检查失败:', error);
      return false;
    }
  }

  // 执行迁移
  async migrate(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      migratedFolders: 0,
      errors: [],
      details: []
    };

    try {
      // 1. 读取localStorage数据
      const localData = localStorage.getItem(this.STORAGE_KEY);
      if (!localData) {
        result.errors.push('localStorage中无文件夹数据');
        return result;
      }

      const metadata = JSON.parse(localData) as FoldersMetadata;
      const folders = Object.values(metadata.folders || {});
      
      if (folders.length === 0) {
        result.success = true;
        this.markMigrationCompleted();
        return result;
      }

      // 2. 按层级排序，确保父文件夹先创建
      const sortedFolders = this.sortFoldersByLevel(folders as Folder[]);
      // 3. 逐个迁移文件夹
      const folderMapping = new Map<string, string>(); // oldId -> newId
      
      for (const folder of sortedFolders) {
        try {
          // 映射父文件夹ID
          const mappedParentId = folder.parentId ? folderMapping.get(folder.parentId) : null;
          
          // 创建文件夹
          const newFolder = await this.apiRequest<Folder>('/', {
            method: 'POST',
            body: JSON.stringify({
              name: folder.name,
              parentId: mappedParentId,
              sortOrder: folder.sortOrder
            })
          });

          // 记录ID映射
          folderMapping.set(folder.id, newFolder.id);
          result.migratedFolders++;
          // 延迟以避免API过载
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          const errorMsg = `迁移文件夹 ${folder.name} 失败: ${error instanceof Error ? error.message : String(error)}`;
          console.error(errorMsg);
          result.errors.push(errorMsg);
        }
      }

      // 4. 迁移Canvas文件关联
      await this.migrateCanvasAssociations(folders as Folder[], folderMapping, result);

      // 5. 标记迁移完成
      if (result.errors.length === 0) {
        this.markMigrationCompleted();
        result.success = true;
      } else {
        result.success = result.migratedFolders > 0; // 部分成功也算成功
      }

    } catch (error) {
      const errorMsg = `迁移过程中发生严重错误: ${error instanceof Error ? error.message : String(error)}`;
      console.error(errorMsg);
      result.errors.push(errorMsg);
    }

    return result;
  }

  // 按层级排序文件夹
  private sortFoldersByLevel(folders: Folder[]): Folder[] {
    return folders.sort((a, b) => {
      // 首先按层级排序
      if (a.level !== b.level) {
        return a.level - b.level;
      }
      // 同层级按创建时间排序
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  // 迁移Canvas文件关联
  private async migrateCanvasAssociations(
    originalFolders: Folder[], 
    folderMapping: Map<string, string>, 
    result: MigrationResult
  ): Promise<void> {
    try {
      let totalCanvasMoved = 0;
      
      for (const originalFolder of originalFolders) {
        if (originalFolder.canvasIds && originalFolder.canvasIds.length > 0) {
          const newFolderId = folderMapping.get(originalFolder.id);
          if (!newFolderId) {
            result.errors.push(`无法找到文件夹 ${originalFolder.name} 的新ID`);
            continue;
          }

          for (const canvasId of originalFolder.canvasIds) {
            try {
              await this.apiRequest(`/${newFolderId}/canvases/${canvasId}`, {
                method: 'POST',
                body: JSON.stringify({ fromFolderId: null })
              });
              totalCanvasMoved++;
              
              // 延迟以避免API过载
              await new Promise(resolve => setTimeout(resolve, 50));
            } catch (error) {
              result.errors.push(`移动Canvas ${canvasId} 到文件夹 ${originalFolder.name} 失败`);
            }
          }
        }
      }

      
    } catch (error) {
      result.errors.push(`Canvas关联迁移失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 标记迁移完成
  private markMigrationCompleted(): void {
    try {
      localStorage.setItem(this.MIGRATION_FLAG_KEY, 'true');
    } catch (error) {
      console.warn('设置迁移标记失败:', error);
    }
  }

  // 清理本地数据（可选）
  async cleanupLocalData(): Promise<void> {
    try {
      // 备份数据以防万一
      const localData = localStorage.getItem(this.STORAGE_KEY);
      if (localData) {
        const backupKey = `${this.STORAGE_KEY}_backup_${Date.now()}`;
        localStorage.setItem(backupKey, localData);
      }

      // 清理原始数据
      localStorage.removeItem(this.STORAGE_KEY);
      
    } catch (error) {
      console.error('清理本地数据失败:', error);
      throw error;
    }
  }

  // 重置迁移状态（仅用于测试）
  async resetMigrationFlag(): Promise<void> {
    localStorage.removeItem(this.MIGRATION_FLAG_KEY);
  }

  // 获取迁移状态
  getMigrationStatus(): {
    completed: boolean;
    hasLocalData: boolean;
    localFolderCount: number;
  } {
    const completed = localStorage.getItem(this.MIGRATION_FLAG_KEY) === 'true';
    const localData = localStorage.getItem(this.STORAGE_KEY);
    let localFolderCount = 0;
    
    if (localData) {
      try {
        const metadata = JSON.parse(localData) as FoldersMetadata;
        localFolderCount = Object.keys(metadata.folders || {}).length;
      } catch (error) {
        console.warn('解析本地数据失败:', error);
      }
    }

    return {
      completed,
      hasLocalData: !!localData,
      localFolderCount
    };
  }
}

// 导出单例实例
export const folderMigrationService = new FolderMigrationService();
