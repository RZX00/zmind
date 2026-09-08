// 🎨 Canvas数据访问层抽象接口
// 设计兼容本地存储和未来Supabase的统一接口

import type { Canvas, CanvasNode, CanvasConnection } from './canvas';
import type { TextOpacityPresetId, TextLayoutPresetId } from '../constants/textNodePresets';

// 📊 Canvas扩展元数据类型 - 为数据库存储添加元数据字段
export interface CanvasMetadata {
  user_id?: string;        // 预留给云端用户系统
  is_deleted?: boolean;    // 软删除标记（预留）
  tags?: string[];         // 标签系统（预留）
  description?: string;    // 画布描述（预留）
  // 前端扩展：连接锚点（冗余保存曲率锚点，便于后台忽略时也能恢复）
  connectionAnchors?: Record<string, { x: number; y: number }>;
  // 前端扩展：相对锚点参数（u,v）冗余保存，确保刷新后保持曲率稳定
  connectionAnchorParams?: Record<string, { u: number; v: number }>;
  // 前端扩展：连接样式（冗余保存外观样式，便于后台忽略时也能恢复）
  connectionStyles?: Record<string, any>;
  // 前端扩展：群组附属连线（冗余保存，以便后台清洗节点字段时仍可恢复）
  groupAttachments?: Record<string, string[]>;
}

// 📄 完整Canvas类型（包含元数据）- 统一数据模型
export interface FullCanvas extends Canvas {
  // 从Canvas继承: id, title, nodes, connections, createdAt, updatedAt, version
  // 添加数据库层元数据
  metadata?: CanvasMetadata;
}

export interface CanvasVersion {
  id: string;
  canvas_id: string;
  version_data: Canvas;   // 版本快照数据
  created_at: number;     // 时间戳(number格式，与Canvas一致)
  is_auto_save: boolean;  // 是否为自动保存
  description?: string;   // 版本描述
}

// 🔧 操作相关类型
export interface CreateCanvasData {
  title: string;
  nodes?: CanvasNode[];        // 可选，默认为空数组
  connections?: CanvasConnection[];  // 可选，默认为空数组
  user_id?: string;
  metadata?: CanvasMetadata;
  clientRequestId?: string;    // 客户端请求ID（本地乐观更新用）
  // 全局文本节点预设（可选，持久化）
  textOpacityPreset?: TextOpacityPresetId;
  textLayoutPreset?: TextLayoutPresetId;
  // 全局背景/样式（可选，持久化）
  backgroundColor?: string;
  backgroundStyleId?: string;
  patternColor?: string;
  cornerStyle?: string;
  fontStyle?: string;
}

export interface UpdateCanvasData {
  title?: string;
  nodes?: CanvasNode[];
  connections?: CanvasConnection[];
  version?: string;            // 字符串类型，与Canvas一致
  serverVersion?: number;      // 并发控制（优先使用）
  metadata?: CanvasMetadata;
  // 全局文本节点预设（可选，持久化）
  textOpacityPreset?: TextOpacityPresetId;
  textLayoutPreset?: TextLayoutPresetId;
  // 全局背景/样式（可选，持久化）
  backgroundColor?: string;
  backgroundStyleId?: string;
  patternColor?: string;
  cornerStyle?: string;
  fontStyle?: string;
}

export interface CanvasQueryOptions {
  user_id?: string;
  limit?: number;
  offset?: number;
  order_by?: 'createdAt' | 'updatedAt' | 'title';  // 与Canvas字段名一致
  order_direction?: 'asc' | 'desc';
  include_deleted?: boolean;   // 是否包含软删除的画布
}

export interface VersionQueryOptions {
  limit?: number;
  is_auto_save?: boolean;
  order_direction?: 'asc' | 'desc';
}

// 📈 统计信息
export interface CanvasStats {
  total_canvases: number;
  total_versions: number;
  storage_size: number;    // 字节数
  oldest_canvas: number;   // 时间戳(number格式)
  newest_canvas: number;   // 时间戳(number格式)
}

// 🎯 Repository抽象接口 - 直接操作Canvas类型，消除转换层
export interface CanvasRepository {
  // 基础CRUD操作 - 直接返回Canvas类型
  create(data: CreateCanvasData): Promise<Canvas>;
  findById(id: string, options?: { signal?: AbortSignal }): Promise<Canvas | null>;
  findAll(options?: CanvasQueryOptions): Promise<Canvas[]>;
  update(id: string, data: UpdateCanvasData): Promise<Canvas>;
  delete(id: string): Promise<void>;
  
  // 版本管理 - 使用统一的CanvasVersion类型
  saveVersion(canvasId: string, data: Canvas, isAutoSave?: boolean): Promise<CanvasVersion>;
  getVersions(canvasId: string, options?: VersionQueryOptions): Promise<CanvasVersion[]>;
  deleteVersion(versionId: string): Promise<void>;
  restoreVersion(versionId: string): Promise<Canvas>;
  
  // 统计和工具方法
  getStats(): Promise<CanvasStats>;
  exists(id: string): Promise<boolean>;
  clearAll(): Promise<void>;  // 危险操作，仅用于开发测试
  
  // 数据迁移支持 - 使用统一类型
  exportData(): Promise<{
    canvases: Canvas[];
    versions: CanvasVersion[];
  }>;
  importData(data: {
    canvases: Canvas[];
    versions: CanvasVersion[];
  }): Promise<void>;
}

// 🔄 Repository工厂模式 - 支持运行时切换实现
export type RepositoryType = 'file' | 'supabase';

export interface CanvasRepositoryFactory {
  create(type: RepositoryType): CanvasRepository;
  getCurrentType(): RepositoryType;
  switchTo(type: RepositoryType): Promise<void>;
}

// 🛠️ 工具类型
export interface RepositoryConfig {
  type: RepositoryType;
  file?: {
    apiBase?: string;
    maxVersions?: number;
  };
  supabase?: {
    url: string;
    key: string;
    schema?: string;
  };
}

// 📝 错误类型
export class CanvasRepositoryError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'CanvasRepositoryError';
  }
}

// 常见错误代码
export const REPOSITORY_ERROR_CODES = {
  NOT_FOUND: 'CANVAS_NOT_FOUND',
  INVALID_DATA: 'INVALID_CANVAS_DATA',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  STORAGE_FULL: 'STORAGE_FULL',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  OPERATION_NOT_SUPPORTED: 'OPERATION_NOT_SUPPORTED',
  OPERATION_FAILED: 'OPERATION_FAILED',
} as const;
