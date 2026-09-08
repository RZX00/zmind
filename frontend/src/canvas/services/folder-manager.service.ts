// 文件夹管理服务 (API版本)
// 基于后端API提供完整的文件夹CRUD和树形结构管理

import type {
  Folder,
  FolderTreeNode,
  FoldersMetadata,
  CreateFolderOptions,
  UpdateFolderOptions,
  MoveCanvasOptions,
  MoveFolderOptions,
  FolderStats,
  FolderQueryOptions,
  FolderManager
} from '../types/folder';

import {
  DEFAULT_FOLDERS_METADATA,
  FOLDER_CONSTANTS
} from '../types/folder';

import { canvasManager } from './canvas-manager.service';
import type { Canvas } from '../types/canvas';
import { folderMigrationService } from './folder-migration.service';
import { requiredEnv } from '@/lib/env-utils';

// API基础配置（通过 Next API 代理，自动注入鉴权）
const FOLDERS_API_BASE = `/api/folders`;

// 工具函数
const generateId = (): string => Math.random().toString(36).substring(2) + Date.now().toString(36);
const getCurrentTimestamp = (): number => Date.now();

/**
 * 文件夹管理器实现 (API版本)
 * 基于后端API进行文件夹管理，支持云端存储
 */
class FolderManagerImpl implements FolderManager {
  private metadata: FoldersMetadata = { ...DEFAULT_FOLDERS_METADATA };
  private isInitialized = false;

  // 初始化
  async initialize(): Promise<void> {
    if (!this.isInitialized) {
      // 检查并执行数据迁移
      await this.checkAndMigrate();

      // 从API加载元数据
      await this.loadMetadata();
      this.isInitialized = true;
    }
  }

  // 检查并执行数据迁移
  private async checkAndMigrate(): Promise<void> {
    try {
      const needsMigration = await folderMigrationService.needsMigration();
      if (needsMigration) {
        const migrationResult = await folderMigrationService.migrate();

        if (!migrationResult.success && migrationResult.errors.length > 0) {
          console.error('数据迁移失败:', migrationResult.errors);
        }
      }
    } catch (error) {
      console.error('迁移检查失败:', error);
      // 不阻塞初始化流程
    }
  }

  // API请求辅助方法（统一通过标准 API 客户端）
  private async apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const { apiClient } = await import('@/lib/api-client');
    const primaryUrl = `${FOLDERS_API_BASE}${endpoint}`;

    // First try: Next route proxy (same-origin)
    let resp = await apiClient.request<T>(primaryUrl, {
      ...options,
      showErrors: false,
    });

    // Fallback: If route doesn't exist in Next (404), call backend URL directly
    if (!resp.success && (resp.error as any)?.status === 404) {
      const base = requiredEnv('NEXT_PUBLIC_BACKEND_URL').replace(/\/$/, '');
      const fallbackPath = primaryUrl.startsWith('/api')
        ? primaryUrl
        : `/api${endpoint}`;
      const fallbackUrl = base.endsWith('/api')
        ? `${base}${fallbackPath.replace(/^\/api/, '')}`
        : `${base}${fallbackPath}`;
      resp = await apiClient.request<T>(fallbackUrl, {
        ...options,
        showErrors: false,
      });
    }

    if (!resp.success) {
      const err = resp.error;
      throw new Error(err?.message || 'API请求失败');
    }
    const data: any = resp.data;
    return (data?.data ?? data) as T;
  }

  // 从API加载元数据
  private async loadMetadata(): Promise<void> {
    try {
      const apiResponse = await this.apiRequest<{
        folders: Folder[];
        tree: FolderTreeNode[];
        metadata: any;
      }>('/', { method: 'GET' });

      // 构建本地元数据格式
      this.metadata = {
        version: apiResponse.metadata?.version || '1.0.0',
        folders: {},
        rootFolderIds: [],
        expandedFolders: {},
        lastUpdated: apiResponse.metadata?.lastUpdated || Date.now()
      };

      // 填充文件夹映射
      if (apiResponse.folders && Array.isArray(apiResponse.folders)) {
        apiResponse.folders.forEach(folder => {
          this.metadata.folders[folder.id] = folder;
          if (!folder.parentId) {
            this.metadata.rootFolderIds.push(folder.id);
          }
          // 保持展开状态
          this.metadata.expandedFolders[folder.id] = folder.isExpanded;
        });
      }
    } catch (error) {
      console.warn('API加载失败，使用默认配置:', error);
      this.metadata = { ...DEFAULT_FOLDERS_METADATA };
    }
  }

  // 刷新本地缓存
  private async refreshLocalCache(): Promise<void> {
    await this.loadMetadata();
  }

  // 获取所有文件夹
  async getAllFolders(): Promise<Folder[]> {
    await this.initialize();
    return Object.values(this.metadata.folders);
  }

  // 根据ID获取文件夹
  async getFolderById(id: string): Promise<Folder | null> {
    await this.initialize();
    return this.metadata.folders[id] || null;
  }

  // 创建文件夹
  async createFolder(options: CreateFolderOptions): Promise<Folder> {
    try {
      const { clientRequestId, ...payload } = options as CreateFolderOptions & { clientRequestId?: string };
      const headers = clientRequestId ? { 'X-Client-Request-Id': clientRequestId } : undefined;
      const newFolder = await this.apiRequest<Folder>('/', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      // 刷新本地缓存
      await this.refreshLocalCache();

      return newFolder;
    } catch (error) {
      console.error('创建文件夹失败:', error);
      throw error;
    }
  }

  // 更新文件夹
  async updateFolder(id: string, options: UpdateFolderOptions): Promise<Folder> {
    try {
      const updatedFolder = await this.apiRequest<Folder>(`/${id}`, {
        method: 'PUT',
        body: JSON.stringify(options)
      });

      // 刷新本地缓存
      await this.refreshLocalCache();

      return updatedFolder;
    } catch (error) {
      console.error('更新文件夹失败:', error);
      throw error;
    }
  }

  // 删除文件夹
  async deleteFolder(id: string, moveCanvasesToParent = true): Promise<void> {
    try {
      await this.apiRequest(`/${id}?moveCanvasesToParent=${moveCanvasesToParent}`, {
        method: 'DELETE'
      });

      // 刷新本地缓存
      await this.refreshLocalCache();
    } catch (error) {
      console.error('删除文件夹失败:', error);
      throw error;
    }
  }

  // 移动Canvas文件
  async moveCanvas(options: MoveCanvasOptions): Promise<void> {
    try {
      const { canvasId, fromFolderId, toFolderId } = options;

      if (toFolderId) {
        await this.apiRequest(`/${toFolderId}/canvases/${canvasId}`, {
          method: 'POST',
          body: JSON.stringify({ fromFolderId })
        });
      } else {
        // 移动到根目录 - 从当前文件夹删除
        if (fromFolderId) {
          await this.apiRequest(`/${fromFolderId}/canvases/${canvasId}`, {
            method: 'DELETE'
          });
        }
      }

      // 刷新本地缓存
      await this.refreshLocalCache();
    } catch (error) {
      console.error('Canvas移动失败:', error);
      throw error;
    }
  }

  // 移动文件夹
  async moveFolder(options: MoveFolderOptions): Promise<void> {
    try {
      const { folderId, newParentId } = options;

      // 使用updateFolder来更新parentId实现移动功能
      await this.apiRequest(`/${folderId}`, {
        method: 'PUT',
        body: JSON.stringify({ parentId: newParentId })
      });

      // 刷新本地缓存
      await this.refreshLocalCache();
    } catch (error) {
      console.error('文件夹移动失败:', error);
      throw error;
    }
  }

  // 构建文件夹树
  async buildFolderTree(includeCanvases = false, existingCanvases?: Canvas[]): Promise<FolderTreeNode[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const folders = Object.values(this.metadata.folders);

    // 🚀 Canvas数据优化：使用传入的现有Canvas列表，避免重复请求
    let canvases: Canvas[] = [];
    if (includeCanvases) {
      if (existingCanvases) {
        canvases = existingCanvases;
      } else {
        canvases = await canvasManager.getAllCanvases();
      }
    }
    const canvasMap = new Map<string, Canvas>(canvases.map(c => [c.id, c]));

    // 构建树形结构
    const rootNodes: FolderTreeNode[] = [];
    const folderMap = new Map<string, FolderTreeNode>();

    // 创建文件夹节点
    for (const folder of folders) {
      const node: FolderTreeNode = {
        id: folder.id,
        name: folder.name,
        type: 'folder',
        parentId: folder.parentId,
        childFolderIds: folder.childFolderIds,
        canvasIds: folder.canvasIds,
        isExpanded: this.metadata.expandedFolders[folder.id] || false,
        level: this.calculateFolderLevel(folder.id),
        sortOrder: folder.sortOrder,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      };
      folderMap.set(folder.id, node);
    }

    // 构建层级结构 - 只添加根级文件夹到rootNodes
    for (const folder of folders) {
      const node = folderMap.get(folder.id)!;

      if (!folder.parentId) {
        // 根级文件夹
        rootNodes.push(node);
      }
    }

    // 添加根级Canvas文件（不属于任何文件夹的Canvas）
    if (includeCanvases) {
      const rootCanvases = canvases.filter(canvas => {
        // 检查Canvas是否不属于任何文件夹
        return !folders.some(folder => folder.canvasIds.includes(canvas.id));
      });

      // 创建根级Canvas节点
      for (const canvas of rootCanvases) {
        const node: FolderTreeNode = {
          id: canvas.id,
          name: typeof canvas.title === 'string' ? canvas.title : '未命名画布',
          type: 'canvas',
          parentId: null,
          childFolderIds: [],
          canvasIds: [],
          isExpanded: false,
          level: 0,
          sortOrder: canvas.updatedAt || getCurrentTimestamp(),
          createdAt: canvas.createdAt || getCurrentTimestamp(),
          updatedAt: canvas.updatedAt || getCurrentTimestamp(),
          canvas: {
            id: canvas.id,
            title: typeof canvas.title === 'string' ? canvas.title : '未命名画布',
            updatedAt: canvas.updatedAt || getCurrentTimestamp(),
          },
        };
        rootNodes.push(node);
      }
    }

    // 排序：文件夹在前，Canvas在后，同类按更新时间倒序排序（最新的在前）
    const sortNodes = (nodes: FolderTreeNode[]) => {
      return nodes.sort((a, b) => {
        // 文件夹优先
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        // 同类型按更新时间倒序排序（最新的在前）
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    };

    // 先对根节点进行排序
    sortNodes(rootNodes);

    return this.flattenTree(rootNodes, folderMap, includeCanvases, canvasMap);
  }

  // 展开文件夹树
  private flattenTree(
    nodes: FolderTreeNode[],
    folderMap: Map<string, FolderTreeNode>,
    includeCanvases: boolean,
    canvasMap: Map<string, Canvas>
  ): FolderTreeNode[] {
    const result: FolderTreeNode[] = [];
    // 记录已添加的Canvas ID，防止重复添加
    const addedCanvasIds = new Set<string>();

    const addNode = (node: FolderTreeNode) => {
      result.push(node);

      // 如果是Canvas节点，记录ID
      if (node.type === 'canvas') {
        addedCanvasIds.add(node.id);
      }

      // 如果是文件夹且已展开，添加子节点
      if (node.type === 'folder' && node.isExpanded) {
        // 添加子文件夹
        const childFolders = (node.childFolderIds || [])
          .map(id => folderMap.get(id))
          .filter(Boolean) as FolderTreeNode[];

        // 按更新时间排序子文件夹（最新的在前）
        childFolders.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        for (const childFolder of childFolders) {
          addNode(childFolder);
        }

        // 添加Canvas文件 - 按更新时间排序
        if (includeCanvases) {
          const folder = this.metadata.folders[node.id];
          if (folder) {
            const canvasNodes: FolderTreeNode[] = [];
            for (const canvasId of folder.canvasIds) {
              // 避免重复添加Canvas
              if (!addedCanvasIds.has(canvasId)) {
                const c = canvasMap.get(canvasId);
                const canvasNode: FolderTreeNode = {
                  id: canvasId,
                  name: c ? (typeof c.title === 'string' ? c.title : '未命名画布') : `Canvas-${canvasId.substring(0, 8)}`,
                  type: 'canvas',
                  parentId: node.id,
                  childFolderIds: [],
                  canvasIds: [],
                  isExpanded: false,
                  level: node.level + 1,
                  sortOrder: (c?.updatedAt) || getCurrentTimestamp(),
                  createdAt: (c?.createdAt) || getCurrentTimestamp(),
                  updatedAt: (c?.updatedAt) || getCurrentTimestamp(),
                  canvas: c
                    ? { id: c.id, title: typeof c.title === 'string' ? c.title : '未命名画布', updatedAt: c.updatedAt || getCurrentTimestamp() }
                    : undefined,
                };
                canvasNodes.push(canvasNode);
                addedCanvasIds.add(canvasId);
              }
            }
            // 按更新时间排序Canvas文件（最新的在前）
            canvasNodes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

            // 将Canvas文件添加到结果中，紧贴在文件夹后面
            result.push(...canvasNodes);
          }
        }
      }
    };

    for (const node of nodes) {
      addNode(node);
    }

    return result;
  }

  // 切换文件夹展开状态
  async toggleFolder(folderId: string): Promise<Folder> {
    try {
      await this.initialize();
      const folder = this.metadata.folders[folderId];
      if (!folder) {
        throw new Error('文件夹不存在');
      }

      const newExpandedState = !this.metadata.expandedFolders[folderId];

      // 🚀 乐观更新：立即更新本地状态
      this.metadata.expandedFolders[folderId] = newExpandedState;

      // 后台异步发送请求，不阻塞UI返回
      this.apiRequest(`/${folderId}`, {
        method: 'PUT',
        body: JSON.stringify({ isExpanded: newExpandedState })
      }).catch(err => {
        console.error('后台同步展开状态失败:', err);
        // 如果失败，回滚本地状态（可选，也可以忽略，因为只会影响下次加载）
        this.metadata.expandedFolders[folderId] = !newExpandedState;
      });

      // 不再调用 refreshLocalCache()，避免全量API请求

      return this.metadata.folders[folderId];
    } catch (error) {
      console.error('切换展开状态失败:', error);
      throw error;
    }
  }

  // 展开所有文件夹
  async expandAllFolders(): Promise<void> {
    try {
      await this.initialize();

      // 🚀 乐观更新：立即更新本地状态
      for (const folderId of Object.keys(this.metadata.folders)) {
        this.metadata.expandedFolders[folderId] = true;
      }

      // 后台异步批量更新
      const updatePromises = Object.values(this.metadata.folders).map(folder =>
        this.apiRequest(`/${folder.id}`, {
          method: 'PUT',
          body: JSON.stringify({ isExpanded: true })
        }).catch(e => console.error(`Failed to expand folder ${folder.id}`, e))
      );

      // 不等待所有请求完成
      Promise.all(updatePromises).catch(e => console.error('Batch expand failed', e));

      // 不再调用 refreshLocalCache()

    } catch (error) {
      console.error('展开所有文件夹失败:', error);
      throw error;
    }
  }

  // 折叠所有文件夹
  async collapseAllFolders(): Promise<void> {
    try {
      await this.initialize();

      // 🚀 乐观更新：立即更新本地状态
      for (const folderId of Object.keys(this.metadata.folders)) {
        this.metadata.expandedFolders[folderId] = false;
      }

      // 后台异步批量更新
      const updatePromises = Object.values(this.metadata.folders).map(folder =>
        this.apiRequest(`/${folder.id}`, {
          method: 'PUT',
          body: JSON.stringify({ isExpanded: false })
        }).catch(e => console.error(`Failed to collapse folder ${folder.id}`, e))
      );

      // 不等待所有请求完成
      Promise.all(updatePromises).catch(e => console.error('Batch collapse failed', e));

      // 不再调用 refreshLocalCache()

    } catch (error) {
      console.error('折叠所有文件夹失败:', error);
      throw error;
    }
  }

  // 获取统计信息
  async getStats(): Promise<FolderStats> {
    try {
      const stats = await this.apiRequest<FolderStats>('/stats', {
        method: 'GET'
      });

      return stats;
    } catch (error) {
      console.error('获取统计信息失败:', error);
      // 如果API失败，使用本地计算
      await this.initialize();
      const foldersByLevel: Record<number, number> = {};
      for (const folder of Object.values(this.metadata.folders)) {
        const level = folder.level;
        foldersByLevel[level] = (foldersByLevel[level] || 0) + 1;
      }

      return {
        totalFolders: Object.keys(this.metadata.folders).length,
        totalCanvases: 0, // 无法准确计算
        foldersByLevel,
        deepestLevel: Math.max(...Object.values(this.metadata.folders).map(f => f.level), 0)
      };
    }
  }

  // 搜索文件夹
  async searchFolders(query: string): Promise<Folder[]> {
    await this.initialize();

    if (!query?.trim()) {
      return [];
    }

    const searchTerm = query.trim().toLowerCase();

    return Object.values(this.metadata.folders).filter(folder =>
      folder.name.toLowerCase().includes(searchTerm)
    );
  }

  // 根据ID获取文件夹(别名)
  async getFolder(id: string): Promise<Folder | null> {
    await this.initialize();
    return this.metadata.folders[id] || null;
  }

  // 验证文件夹结构
  async validateStructure(): Promise<boolean> {
    await this.initialize();

    try {
      // 检查数据一致性
      for (const folder of Object.values(this.metadata.folders)) {
        // 检查父子关系
        if (folder.parentId) {
          const parent = this.metadata.folders[folder.parentId];
          if (!parent || !parent.childFolderIds.includes(folder.id)) {
            return false;
          }
        }

        // 检查子文件夹关系
        for (const childId of folder.childFolderIds) {
          const child = this.metadata.folders[childId];
          if (!child || child.parentId !== folder.id) {
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // 通过Canvas ID查找所属文件夹
  async findFoldersByCanvas(canvasId: string): Promise<Folder | null> {
    await this.initialize();

    for (const folder of Object.values(this.metadata.folders)) {
      if (folder.canvasIds.includes(canvasId)) {
        return folder;
      }
    }

    return null;
  }

  // 获取文件夹路径
  async getFolderPath(folderId: string): Promise<string[]> {
    await this.initialize();

    const path: string[] = [];
    let currentId: string | null = folderId;

    while (currentId) {
      const folder: Folder | undefined = this.metadata.folders[currentId];
      if (!folder) break;

      path.unshift(folder.name);
      currentId = folder.parentId;
    }

    return path;
  }

  // 工具方法：计算文件夹层级
  private calculateFolderLevel(folderId: string): number {
    let level = 0;
    let currentId: string | null = folderId;

    // 从当前文件夹向上遍历到根目录，计算层级
    while (currentId) {
      const folder: Folder | undefined = this.metadata.folders[currentId];
      if (!folder) break;

      // 如果有父文件夹，层级+1
      if (folder.parentId) {
        level++;
      }
      currentId = folder.parentId;
    }

    // level即为从根到当前的距离
    return level;
  }

  // 检查是否会产生循环依赖
  private wouldCreateCycle(folderId: string, newParentId: string): boolean {
    let currentId: string | null = newParentId;

    while (currentId) {
      if (currentId === folderId) {
        return true; // 找到循环
      }

      const folder: Folder | undefined = this.metadata.folders[currentId];
      if (!folder) break;

      currentId = folder.parentId;
    }

    return false;
  }

  // 计算子树深度
  private calculateSubtreeDepth(folderId: string): number {
    const folder: Folder | undefined = this.metadata.folders[folderId];
    if (!folder || folder.childFolderIds.length === 0) {
      return 1;
    }

    let maxChildDepth = 0;
    for (const childId of folder.childFolderIds) {
      const childDepth = this.calculateSubtreeDepth(childId);
      maxChildDepth = Math.max(maxChildDepth, childDepth);
    }

    return maxChildDepth + 1;
  }
}

// 导出单例实例
export const folderManager = new FolderManagerImpl();

// 🎯 导出必需的类型，解决TypeScript导入问题
export type { Folder } from '../types/folder';
