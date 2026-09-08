// 🗃️ Canvas文件存储Repository实现
// 基于标准API客户端的真正持久化存储

import type { Canvas } from '../types/canvas';
import type {
  CanvasRepository,
  CanvasVersion,
  CreateCanvasData,
  UpdateCanvasData,
  CanvasQueryOptions,
  VersionQueryOptions,
  CanvasStats,
  REPOSITORY_ERROR_CODES
} from '../types/canvas-repository';
import { CanvasRepositoryError } from '../types/canvas-repository';
import { CanvasIdManager } from '../utils/canvasIdUtils';
import { apiClient } from '@/lib/api-client';
import { canvasCache } from '../cache/canvas-cache';
import { DEFAULT_CANVAS_TITLE } from '@/canvas/constants';
import { requiredServerEnv } from '@/lib/env-utils';
import { getCanvasClientSessionId } from './client-session-id';
import { parseCanvasWriteErrorBody } from './canvas-write-error';

const makeClientRequestId = (prefix: string) => {
  try {
    const cryptoObj: any = (globalThis as any).crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
      return `${prefix}_${cryptoObj.randomUUID()}`;
    }
  } catch {}
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const getHeaderValue = (headers: HeadersInit | undefined, name: string): string | undefined => {
  if (!headers) return undefined;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (Array.isArray(headers)) {
    const found = headers.find(([k]) => k.toLowerCase() === name.toLowerCase());
    return found?.[1];
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()];
};

/**
 * 文件系统Canvas存储Repository实现
 * 通过标准API客户端存储Canvas
 */
export class FileCanvasRepository implements CanvasRepository {
  private apiBase: string;
  private readonly proxyApiBase = '/api';

  constructor(apiBase = '/api') {
    if (typeof window !== 'undefined') {
      this.apiBase = this.proxyApiBase;
    } else {
      this.apiBase = apiBase || this.proxyApiBase;
    }
  }

  // 🔧 辅助方法：API请求封装 - 使用标准API客户端，并拼接 apiBase 前缀
  private async apiRequest<T>(
    endpoint: string,
    options: (RequestInit & { allowNotModified?: boolean }) = {}
  ): Promise<T> {
    const shouldFallbackToProxy = typeof window !== 'undefined' && this.apiBase !== this.proxyApiBase;
    const allowNotModified = Boolean(options.allowNotModified);
    const { allowNotModified: _omit, ...fetchOptions } = options;

    try {
      return await this.performRequest<T>(this.apiBase, endpoint, fetchOptions, allowNotModified);
    } catch (error) {
      if (
        shouldFallbackToProxy &&
        error instanceof CanvasRepositoryError &&
        error.code === 'NETWORK_ERROR'
      ) {
        console.warn('[FileCanvasRepository] 📡 Direct API不可达，回退到 Next API 代理');
        this.apiBase = this.proxyApiBase;
        return await this.performRequest<T>(this.proxyApiBase, endpoint, fetchOptions, allowNotModified);
      }

      throw error;
    }
  }

  private async performRequest<T>(
    base: string,
    endpoint: string,
    options: RequestInit,
    allowNotModified: boolean
  ): Promise<T> {
    const url = `${base}${endpoint}`;
    const requestId =
      getHeaderValue(options.headers, 'X-Client-Request-Id') ||
      getHeaderValue(options.headers, 'Idempotency-Key');
    const ifMatch = getHeaderValue(options.headers, 'If-Match');
    const requestLog: Record<string, any> = {
      url,
      endpoint,
      method: options.method || 'GET',
    };
    if (requestId) requestLog.requestId = requestId;
    if (ifMatch) requestLog.ifMatch = ifMatch;
    console.log('[FileCanvasRepository] 🔍 Request:', requestLog);

    try {
      let response = await apiClient.request<T>(url, {
        ...options,
        showErrors: false, // 我们自己处理错误
      });

      // Fallback: If Next route is missing (404), call backend directly (server-side only)
      if (
        base === this.proxyApiBase &&
        !response.success &&
        (response.error as any)?.status === 404 &&
        typeof window === 'undefined'
      ) {
        const baseUrl = requiredServerEnv('BACKEND_INTERNAL_URL').replace(/\/$/, '');
        const prefix = baseUrl.match(/\/(api)(\/)?$/) ? '' : '/api';
        const fallbackUrl = `${baseUrl}${prefix}${endpoint}`;
        console.log('[FileCanvasRepository] ↩️ Fallback to backend:', fallbackUrl);
        response = await apiClient.request<T>(fallbackUrl, {
          ...options,
          showErrors: false,
        });
      }

      if (response.success && response.status === 304 && allowNotModified) {
        return null as T;
      }

      if (!response.success) {
        const error = response.error;
        const status = error?.status || 500;
        const requestId2 =
          getHeaderValue(options.headers, 'X-Client-Request-Id') ||
          getHeaderValue(options.headers, 'Idempotency-Key');
        const ifMatch2 = getHeaderValue(options.headers, 'If-Match');
        const code = status === 404
          ? 'NOT_FOUND'
          : status === 409
            ? 'VERSION_CONFLICT'
            : status === 401 || status === 403
              ? 'PERMISSION_DENIED'
              : 'OPERATION_FAILED';
        const parsed = parseCanvasWriteErrorBody((error as any)?.details);
        const message = parsed.message || error?.message || 'API request failed';
        const errorCode = parsed.code || (error as any)?.code;
        console.error('[FileCanvasRepository] write failed', {
          status,
          code: errorCode || code,
          message,
          serverVersion: parsed.serverVersion,
          requestId: requestId2,
          ifMatch: ifMatch2,
          url,
        });
        throw new CanvasRepositoryError(
          message,
          code,
          {
            status,
            url,
            endpoint,
            method: options.method || 'GET',
            requestId: requestId2,
            ifMatch: ifMatch2,
            serverVersion: parsed.serverVersion,
            code: errorCode,
            body: parsed.body,
          },
        );
      }

      return response.data as T;
    } catch (error) {
      if (error instanceof CanvasRepositoryError) {
        throw error;
      }

      // 网络或其他错误
      throw new CanvasRepositoryError(
        `API请求失败: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR'
      );
    }
  }

  // 🔍 验证Canvas数据
  private validateCanvasData(data: Canvas): void {
    if (!data || typeof data !== 'object') {
      throw new CanvasRepositoryError(
        '无效的画布数据格式',
        'INVALID_DATA'
      );
    }
    
    if (!data.id || !data.title) {
      throw new CanvasRepositoryError(
        '画布数据缺少必需字段',
        'INVALID_DATA'
      );
    }
  }

  // 🎯 使用统一ID生成工具
  private generateId(): string {
    return CanvasIdManager.generate();
  }

  // 简化的数据规范化：直接返回标准Canvas结构，不处理data嵌套
  private fixCanvasData(canvas: any): Canvas {
    // 规范化 + 轻量清洗，防御性地去掉无意义字段
    const cleanNode = (n: any) => {
      if (!n || typeof n !== 'object') return n;
      const out: any = {};
      for (const k of Object.keys(n)) {
        const v = (n as any)[k];
        if (v === null || v === undefined) continue;
        out[k] = v;
      }
      if (!out.parentGroupId) delete out.parentGroupId;
      if (out.locked === false) delete out.locked;
      if (out.selected !== undefined) delete out.selected;
      if (out.isEditing !== undefined) delete out.isEditing;
      if (out.type !== 'code') {
        delete out.codeType;
        delete out.mermaidTheme;
        delete out.mermaidThemeId;
      }
      // Title 通常仅对 canvas-link 有意义（column/group 的标题映射在 content 首行）
      if (!['canvas-link'].includes(out.type)) {
        const defaults = new Set(['文本节点','待办事项','节点','HTML节点','代码节点','表格','Mermaid图表','Column','画布链接']);
        if (!out.title || defaults.has(out.title)) delete out.title;
      }
      return out;
    };
    const cleanConn = (c: any) => {
      if (!c || typeof c !== 'object') return c;
      const out: any = {};
      for (const k of Object.keys(c)) {
        const v = (c as any)[k];
        if (v === null || v === undefined) continue;
        out[k] = v;
      }
      if (out.selected !== undefined) delete out.selected;
      return out;
    };
    return {
      id: canvas.id,
      title: canvas.title || DEFAULT_CANVAS_TITLE,
      nodes: Array.isArray(canvas.nodes) ? canvas.nodes.map(cleanNode) : [],
      connections: Array.isArray(canvas.connections) ? canvas.connections.map(cleanConn) : [],
      createdAt: typeof canvas.createdAt === 'number' ? canvas.createdAt : Date.now(),
      updatedAt: typeof canvas.updatedAt === 'number' ? canvas.updatedAt : Date.now(),
      version: canvas.version || '1.0.0',
      serverVersion: typeof canvas.serverVersion === 'number' ? canvas.serverVersion : undefined,
      // 全局背景/样式（若后端返回）
      backgroundColor: canvas.backgroundColor,
      backgroundStyleId: canvas.backgroundStyleId,
      patternColor: canvas.patternColor,
      cornerStyle: canvas.cornerStyle,
      fontStyle: canvas.fontStyle,
      // 透传全局文本预设（若后端返回）
      textOpacityPreset: canvas.textOpacityPreset,
      textLayoutPreset: canvas.textLayoutPreset,
      // 透传元数据（用于前端扩展，如连接锚点）
      metadata: canvas.metadata,
    };
  }

  // ================== Repository接口实现 ==================

  async create(data: CreateCanvasData): Promise<Canvas> {
    // 与后端契约：POST /canvases 接收 {title, nodes, connections}
    const clientRequestId = data.clientRequestId || makeClientRequestId('canvas_create');
    const payload = {
      title: data.title,
      nodes: data.nodes || [],
      connections: data.connections || [],
      // 可选：全局背景/样式
      ...(data as any).backgroundColor ? { backgroundColor: (data as any).backgroundColor } : {},
      ...(data as any).backgroundStyleId ? { backgroundStyleId: (data as any).backgroundStyleId } : {},
      ...(data as any).patternColor ? { patternColor: (data as any).patternColor } : {},
      ...(data as any).cornerStyle ? { cornerStyle: (data as any).cornerStyle } : {},
      ...(data as any).fontStyle ? { fontStyle: (data as any).fontStyle } : {},
      // 将可选的全局文本预设传给后端
      ...(data.textOpacityPreset ? { textOpacityPreset: data.textOpacityPreset } : {}),
      ...(data.textLayoutPreset ? { textLayoutPreset: data.textLayoutPreset } : {}),
      ...(data.metadata ? { metadata: data.metadata } : {}),
    }

    const headers = clientRequestId
      ? { 'X-Client-Request-Id': clientRequestId, 'Idempotency-Key': clientRequestId }
      : undefined;
    const savedCanvas = await this.apiRequest<Canvas>('/canvases', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    return this.fixCanvasData(savedCanvas);
  }

  async findById(id: string, options?: { signal?: AbortSignal }): Promise<Canvas | null> {
    try {
      const cached = canvasCache.get(id) || canvasCache.hydrateFromSnapshot(id);
      const cachedVersion = cached?.version;
      const cachedUpdatedAt = cached?.updatedAt;
      const cachedEtag = cachedVersion
        ? `W/"canvas:${id}:${cachedVersion}:${String(cachedUpdatedAt || 0)}"`
        : undefined;
      const headers = cachedEtag ? { 'If-None-Match': cachedEtag } : undefined;

      const canvas = await this.apiRequest<Canvas>(`/canvases/${id}/snapshot`, {
        headers,
        signal: options?.signal,
        allowNotModified: true,
      });

      if (!canvas && cached?.canvas) {
        return this.fixCanvasData(cached.canvas);
      }

      if (!canvas) {
        return null;
      }

      return this.fixCanvasData(canvas);
    } catch (error) {
      if (error instanceof CanvasRepositoryError) {
        const status = (error as any).details?.status;
        if (status === 404) {
          try {
            const canvas = await this.apiRequest<Canvas>(`/canvases/${id}`, {
              signal: options?.signal,
            });
            return this.fixCanvasData(canvas);
          } catch {
            return null;
          }
        }
        if (error.code === 'NOT_FOUND') {
          return null;
        }
      }
      throw error;
    }
  }

  async findAll(options: CanvasQueryOptions = {}): Promise<Canvas[]> {
    try {
      const canvases = await this.apiRequest<Canvas[]>('/canvases');
      
      let result = canvases.map(canvas => this.fixCanvasData(canvas));
      
      // 应用查询选项
      if (options.limit) {
        result = result.slice(0, options.limit);
      }
      
      return result;
    } catch (error) {
      console.warn('[FileCanvasRepository] API调用失败，返回空列表:', error);
      
      // 降级行为：返回空列表，不阻断用户操作
      return [];
    }
  }

  async update(id: string, data: UpdateCanvasData): Promise<Canvas> {
    // 保持与后端 CanvasUpdate 模型一致：仅发送 title/nodes/connections/version
    const payload: any = {}
    if (data.title !== undefined) payload.title = data.title
    if (data.nodes !== undefined) payload.nodes = data.nodes
    if (data.connections !== undefined) payload.connections = data.connections
    if (data.version !== undefined) payload.version = data.version
    if (data.textOpacityPreset !== undefined) payload.textOpacityPreset = data.textOpacityPreset
    if (data.textLayoutPreset !== undefined) payload.textLayoutPreset = data.textLayoutPreset
    // 新增：背景/样式字段透传
    const anyData: any = data as any
    if (anyData.backgroundColor !== undefined) payload.backgroundColor = anyData.backgroundColor
    if (anyData.backgroundStyleId !== undefined) payload.backgroundStyleId = anyData.backgroundStyleId
    if (anyData.patternColor !== undefined) payload.patternColor = anyData.patternColor
    if (anyData.cornerStyle !== undefined) payload.cornerStyle = anyData.cornerStyle
    if (anyData.fontStyle !== undefined) payload.fontStyle = anyData.fontStyle
    if (data.metadata !== undefined) payload.metadata = data.metadata

    // 并发控制：将传入的 version 作为 If-Match 头
    const headers: Record<string, string> = {}
    const clientRequestId = (data as any)?.clientRequestId || makeClientRequestId('canvas_update');
    headers['X-Client-Request-Id'] = clientRequestId;
    headers['Idempotency-Key'] = clientRequestId;
    const clientSessionId = getCanvasClientSessionId();
    if (clientSessionId) {
      headers['X-Client-Session-Id'] = clientSessionId;
    }
    if (typeof data.serverVersion === 'number') {
      headers['If-Match'] = String(data.serverVersion)
    }

    const updatedCanvas = await this.apiRequest<Canvas>(`/canvases/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });

    return this.fixCanvasData(updatedCanvas);
  }

  // 🔧 新增：操作集应用（统一写路径，基于 If-Match 并发控制）
  async applyOps(
    id: string,
    operations: any[],
    baseVersion?: number,
    idempotencyKey?: string,
  ): Promise<{ canvas: Canvas; applied?: any[]; id_map?: Record<string, string>; serverVersion?: number }>{
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new CanvasRepositoryError('operations 必须是非空数组', 'INVALID_DATA')
    }
    const headers: Record<string, string> = {}
    if (typeof baseVersion === 'number') headers['If-Match'] = String(baseVersion)
    const clientRequestId = idempotencyKey || makeClientRequestId('canvas_apply');
    headers['X-Client-Request-Id'] = clientRequestId;
    headers['Idempotency-Key'] = clientRequestId;
    const clientSessionId = getCanvasClientSessionId();
    if (clientSessionId) {
      headers['X-Client-Session-Id'] = clientSessionId;
    }
    const resp = await this.apiRequest<any>(`/canvases/${id}/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ operations }),
    })
    const canvas = this.fixCanvasData(resp?.canvas || resp)
    const applied = resp?.applied
    const id_map = resp?.id_map ?? resp?.idMap
    const serverVersion =
      typeof resp?.serverVersion === 'number'
        ? resp.serverVersion
        : typeof canvas?.serverVersion === 'number'
          ? canvas.serverVersion
          : undefined
    return { canvas, applied, id_map, serverVersion }
  }

  async delete(id: string): Promise<void> {
    await this.apiRequest(`/canvases/${id}`, {
      method: 'DELETE',
    });
  }

  // ================== 版本管理功能 ==================
  // 完整实现版本管理功能

  async saveVersion(canvasId: string, data: Canvas, isAutoSave = false): Promise<CanvasVersion> {
    this.validateCanvasData(data);
    const payload = { is_auto_save: isAutoSave, description: isAutoSave ? '自动保存' : '手动保存版本' }
    const saved = await this.apiRequest<CanvasVersion>(`/canvases/${canvasId}/versions`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
    return saved
  }

  async getVersions(canvasId: string, options: VersionQueryOptions = {}): Promise<CanvasVersion[]> {
    const params = new URLSearchParams()
    if (options.limit) params.set('limit', String(options.limit))
    if (typeof options.is_auto_save === 'boolean') params.set('is_auto_save', String(options.is_auto_save))
    if (options.order_direction) params.set('order_direction', options.order_direction)
    const search = params.toString() ? `?${params.toString()}` : ''
    const versions = await this.apiRequest<CanvasVersion[]>(`/canvases/${canvasId}/versions${search}`)
    return versions
  }

  async restoreVersion(versionId: string): Promise<Canvas> {
    const restored = await this.apiRequest<Canvas>(`/canvases/versions/${versionId}/restore`, { method: 'POST' })
    return this.fixCanvasData(restored as any)
  }

  async deleteVersion(versionId: string): Promise<void> {
    await this.apiRequest(`/canvases/versions/${versionId}`, { method: 'DELETE' })
  }

  // ================== 统计功能 ==================

  async getStats(): Promise<CanvasStats> {
    const canvases = await this.findAll();
    
    // 获取版本统计
    let totalVersions = 0;
    for (const canvas of canvases) {
      try {
        const versions = await this.getVersions(canvas.id);
        totalVersions += versions.length;
      } catch (error) {
        // 忽略版本获取失败
      }
    }
    
    // 计算存储大小（粗略估算）
    const storageSize = JSON.stringify(canvases).length;
    
    return {
      total_canvases: canvases.length,
      total_versions: totalVersions,
      storage_size: storageSize,
      oldest_canvas: canvases.length > 0 ? 
        Math.min(...canvases.map(c => c.createdAt)) : 
        Date.now(),
      newest_canvas: canvases.length > 0 ? 
        Math.max(...canvases.map(c => c.updatedAt)) : 
        Date.now()
    };
  }

  // ================== 批量操作 ==================

  // 批量删除画布
  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  async exportData(): Promise<{
    canvases: Canvas[];
    versions: CanvasVersion[];
  }> {
    const canvases = await this.findAll();
    
    // 收集所有版本
    const allVersions: CanvasVersion[] = [];
    for (const canvas of canvases) {
      try {
        const versions = await this.getVersions(canvas.id);
        allVersions.push(...versions);
      } catch (error) {
        console.warn(`导出画布 ${canvas.id} 的版本失败:`, error);
      }
    }
    
    return {
      canvases,
      versions: allVersions
    };
  }

  async importData(data: {
    canvases: Canvas[];
    versions: CanvasVersion[];
  }): Promise<void> {
    if (!data.canvases || !Array.isArray(data.canvases)) {
      throw new CanvasRepositoryError(
        '导入数据格式无效',
        'INVALID_DATA'
      );
    }

    // 导入画布数据
    for (const canvas of data.canvases) {
      await this.create({
        title: canvas.title,
        nodes: canvas.nodes,
        connections: canvas.connections
      });
    }
    
    // 导入版本数据（如果有）
    if (data.versions && Array.isArray(data.versions)) {
      for (const version of data.versions) {
        try {
          await this.saveVersion(
            version.canvas_id, 
            version.version_data, 
            version.is_auto_save
          );
        } catch (error) {
          console.warn(`导入版本 ${version.id} 失败:`, error);
        }
      }
    }
  }

  // ================== 工具方法 ==================

  async exists(id: string): Promise<boolean> {
    // 为了兼容标准客户端的响应处理，使用 GET 并处理 404
    try {
      const canvas = await this.findById(id);
      return canvas !== null;
    } catch {
      return false;
    }
  }

  async clearAll(): Promise<void> {
    try {
      const canvases = await this.findAll();
      for (const canvas of canvases) {
        await this.delete(canvas.id);
      }
    } catch (error) {
      throw new CanvasRepositoryError(
        '清空数据失败',
        'OPERATION_FAILED',
        error
      );
    }
  }
}
