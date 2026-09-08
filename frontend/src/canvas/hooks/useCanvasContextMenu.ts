// 🖱️ 画布右键菜单Hook
// 处理右键菜单显示、隐藏和菜单项操作

import { useState, useEffect, useCallback, useRef } from 'react';
import {useTranslations} from 'next-intl';
import type { Canvas, CanvasNode, CanvasConnection } from '../../types/canvas';
import type { MenuState as ContextMenuState, MenuItem as ContextMenuItem } from '@/types/menu';
import { calculateGroupBounds } from '../components/core/systems/CoordinateSystem';
import { getHiddenMindmapNodesForGroup } from '../utils/groupUtils';
import { calculateMermaidNodeSize } from '../utils/canvasUtils';
import { AlignmentType } from '../services/canvas-node-alignment.service';
import { NodeAlignmentService } from '../services/canvas-node-alignment.service';
import { DEFAULT_KEYBOARD_SHORTCUTS } from '../types/node-alignment';
import { useCanvasStore } from '../stores/canvas.store';
import { DEFAULT_TEXT_LAYOUT_PRESET } from '../constants/textNodePresets';
import {
  measureOrEstimateTextNodeHeight,
  resolveTextLayoutPreset,
} from '../domain/text-layout/textLayoutService';
import { useAuth } from '@/components/AuthProvider';
import { buildMediaProxyUrl as buildMediaProxyUrlHelper, deriveStoragePath } from '../utils/mediaUtils';
import { toast } from 'sonner';
import { createSandboxFile, ensureCanvasThread, getProject, getThread } from '@/lib/api';
import { resolveBackendBase } from '@/lib/backend';
import { resolveProjectRuntimeRef } from '@/lib/runtime-ref';
import { DownloadFormat, downloadPresentation, handleGoogleSlidesUpload } from '@/components/thread/tool-views/utils/presentation-utils';
import {
  getPresentationPath,
  isPresentationResultHtmlNode,
  resolvePresentationTitle,
  upsertPresentationMetadata,
  updatePresentationExportState,
  type PresentationExportKey,
} from '../utils/presentationMetadata';

// 📍 局部位置类型定义
interface Position {
  x: number;
  y: number;
}

interface PresentationRuntimeContext {
  canvasId: string;
  threadId: string;
  projectId: string;
  sandboxId: string;
  sandboxUrl: string;
}

export interface UseCanvasContextMenuOptions {
  // 节点操作
  selectedNodes: string[];
  nodes: CanvasNode[];
  onDeleteNodes: (nodeIds: string[]) => void;
  onDuplicateNodes: (nodeIds: string[]) => void;
  onEditNode: (nodeId: string) => void;
  onOpenExpandedEditor?: (nodeId: string) => void;
  onLockToggle: (nodeId: string, locked: boolean) => void;
  onSizeChange: (nodeId: string, size: { width: number; height: number }) => void;
  onBatchSizeChange?: (updates: Array<{ nodeId: string; size: { width: number; height: number } }>) => void; // 批量尺寸调整
  onAutoSizeModeChange?: (nodeId: string, mode: 'auto' | 'manual') => void; // 自动尺寸模式切换
  // AI 属性开关
  onToggleNodeAI?: (nodeIds: string[], ai: boolean) => void;


  // 对齐操作
  onAlignment?: (nodes: CanvasNode[], alignmentType: AlignmentType) => void;

  // 连线操作
  selectedConnections?: string[];
  connections?: CanvasConnection[];
  onDeleteConnections?: (connectionIds: string[]) => void;
  onEditConnection?: (connectionId: string) => void;

  // 画布操作
  onCreateNode: (type: 'text' | 'todo' | 'code' | 'html' | 'column' | 'table', position: Position) => void;
  // 成组相关（可选）
  onCreateGroup?: (nodeIds: string[], connectionIds?: string[]) => void;
  onUngroup?: (groupId: string) => void;
  onRenameGroup?: (groupId: string) => void;
  onSwitchGroupType?: (groupId: string, toMindmap: boolean) => void;
  onLeaveGroup?: (nodeId: string) => void; // 节点脱离群组
  // 思维导图方向切换（右向/双向）
  onSwitchMindmapOrientation?: (groupId: string, orientation: 'right' | 'both') => void;
  groups?: Array<{ id: string; nodeIds: string[] }>;

  // 编辑模式状态
  isEditMode: boolean;

}

export interface UseCanvasContextMenuReturn {
  // 菜单状态
  contextMenu: ContextMenuState;
  
  // 事件处理器
  handleContextMenu: (event: React.MouseEvent, targetNodeId?: string, targetConnectionId?: string, rightClickState?: any) => void;
  hideContextMenu: () => void;
}

export const useCanvasContextMenu = ({
  selectedNodes,
  nodes,
  onDeleteNodes,
  onDuplicateNodes,
  onEditNode,
  onOpenExpandedEditor,
  onLockToggle,
  onSizeChange,
  onBatchSizeChange,
  onAutoSizeModeChange,
  onToggleNodeAI,
  onAlignment,
  selectedConnections = [],
  connections = [],
  onDeleteConnections,
  onEditConnection,
  onCreateNode,
  onCreateGroup,
  onUngroup,
  onRenameGroup,
  onSwitchGroupType,
  onLeaveGroup,
  onSwitchMindmapOrientation,
  groups = [],
  isEditMode,
}: UseCanvasContextMenuOptions): UseCanvasContextMenuReturn => {
  
  // 🎯 菜单状态
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    items: [],
    meta: undefined,
  });

  const hideContextMenu = useCallback(() => {
    setContextMenu(prev => ({
      ...prev,
      visible: false,
    }));
  }, []);
  const textLayoutPresetId = useCanvasStore(
    (state) => state.canvas?.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET
  );
  const currentCanvasId = useCanvasStore((state) => state.canvas?.id);
  const updateNodeInStore = useCanvasStore((state) => state.updateNode);
  const textLayoutPreset = resolveTextLayoutPreset({ layoutPresetId: textLayoutPresetId as any });
  const t = useTranslations();
  const { session } = useAuth();
  const presentationRuntimeRef = useRef<PresentationRuntimeContext | null>(null);

  // 工具：判断是否为“有形状的文本节点”（shapeDecoration.type 存在且非 none）
  const isShapedTextNode = useCallback((n: CanvasNode) => {
    try {
      return n.type === 'text' && Boolean((n as any)?.shapeDecoration && (n as any).shapeDecoration?.type && (n as any).shapeDecoration.type !== 'none');
    } catch { return false; }
  }, []);

  const sanitizeFileSegment = useCallback((input: string) => {
    const sanitized = input
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    return sanitized || 'presentation';
  }, []);

  const resolvePresentationRuntime = useCallback(async (): Promise<PresentationRuntimeContext> => {
    if (!currentCanvasId) {
      throw new Error(t('canvas.menu.presentation.missingCanvas', { default: 'No active canvas found' }));
    }

    if (presentationRuntimeRef.current?.canvasId === currentCanvasId) {
      return presentationRuntimeRef.current;
    }

    const ensured = await ensureCanvasThread(currentCanvasId);
    const thread = await getThread(ensured.thread_id);
    const projectId = thread?.project_id;

    if (!projectId) {
      throw new Error(t('canvas.menu.presentation.missingProject', { default: 'Canvas is not bound to a project' }));
    }

    const project = await getProject(projectId);
    const sandboxId = resolveProjectRuntimeRef(project);
    const sandboxUrl = project?.sandbox?.sandbox_url || resolveBackendBase().replace(/\/api$/, '');

    if (!sandboxId) {
      throw new Error(t('canvas.menu.presentation.missingSandbox', { default: 'Project sandbox is not ready' }));
    }

    const runtime: PresentationRuntimeContext = {
      canvasId: currentCanvasId,
      threadId: ensured.thread_id,
      projectId,
      sandboxId,
      sandboxUrl,
    };
    presentationRuntimeRef.current = runtime;
    return runtime;
  }, [currentCanvasId, t]);

  const patchPresentationNodeData = useCallback((
    nodeId: string,
    updater: (node: CanvasNode) => Record<string, unknown>,
  ) => {
    const liveNode = useCanvasStore.getState().canvas?.nodes?.find((candidate) => candidate.id === nodeId);
    if (!liveNode) return;
    const nextData = updater(liveNode);
    updateNodeInStore(nodeId, { data: nextData as any });
  }, [updateNodeInStore]);

  const setPresentationExportStatus = useCallback((
    nodeId: string,
    exportKey: PresentationExportKey,
    status: 'idle' | 'running' | 'success' | 'failed',
    options?: {
      result?: { url?: string; fileName?: string; presentationId?: string };
      error?: { code: string; message: string };
    },
  ) => {
    patchPresentationNodeData(nodeId, (liveNode) =>
      updatePresentationExportState(liveNode, exportKey, {
        status,
        updatedAt: new Date().toISOString(),
        ...(options?.result ? { result: options.result } : {}),
        ...(options?.error ? { error: options.error } : {}),
      }),
    );
  }, [patchPresentationNodeData]);

  const ensurePresentationSandboxAsset = useCallback(async (node: CanvasNode) => {
    if (!(node.type === 'code' && node.codeType === 'html')) {
      throw new Error(t('canvas.menu.presentation.invalidNode', { default: 'Only HTML nodes can be exported as PPT' }));
    }

    const runtime = await resolvePresentationRuntime();
    const liveNode = useCanvasStore.getState().canvas?.nodes?.find((candidate) => candidate.id === node.id) || node;
    const presentationTitle = resolvePresentationTitle(liveNode);
    const existingPath = getPresentationPath(liveNode);
    const projectSegment = sanitizeFileSegment(runtime.projectId || currentCanvasId || 'canvas');
    const defaultFileName = `${sanitizeFileSegment(presentationTitle)}-${Date.now()}.html`;
    const presentationPath = existingPath || `presentations/${projectSegment}/${defaultFileName}`;

    await createSandboxFile(runtime.sandboxId, presentationPath, liveNode.content || '');

    patchPresentationNodeData(liveNode.id, (freshNode) =>
      upsertPresentationMetadata(freshNode, {
        projectId: runtime.projectId,
        threadId: runtime.threadId,
        role: 'result_html',
        title: presentationTitle,
        presentationPath,
        capabilities: {
          fullscreen: true,
          downloadPptx: true,
          exportGoogleSlides: true,
        },
      }),
    );

    return {
      ...runtime,
      presentationPath,
      presentationTitle,
    };
  }, [currentCanvasId, patchPresentationNodeData, resolvePresentationRuntime, sanitizeFileSegment, t]);

  const triggerPresentationFullscreen = useCallback(async (nodeId: string) => {
    const selectorSafeId = String(nodeId).replace(/"/g, '\\"');
    const nodeContainer = document.querySelector(`[data-node-id="${selectorSafeId}"]`) as HTMLElement | null;
    if (!nodeContainer) {
      throw new Error(t('canvas.menu.presentation.fullscreenNodeNotFound', { default: 'Unable to locate this node on canvas' }));
    }

    const iframe = nodeContainer.querySelector('[data-html-preview-iframe]') as HTMLElement | null;
    const fullscreenTarget = iframe || nodeContainer;
    const requestFullscreen = fullscreenTarget.requestFullscreen?.bind(fullscreenTarget);
    if (!requestFullscreen) {
      throw new Error(t('canvas.menu.presentation.fullscreenUnsupported', { default: 'Fullscreen is not supported in this browser' }));
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    await requestFullscreen();
  }, [t]);

  const downloadHtmlSnapshot = useCallback((node: CanvasNode) => {
    if (!(node.type === 'code' && node.codeType === 'html')) return;
    const htmlContent = node.content || '';
    const presentationTitle = resolvePresentationTitle(node);
    const fileName = `${sanitizeFileSegment(presentationTitle)}.html`;
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.rel = 'noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(objectUrl);
    setPresentationExportStatus(node.id, 'html', 'success', {
      result: { fileName },
    });
    toast.success(t('canvas.menu.presentation.downloadHtmlSuccess', { default: 'HTML file downloaded' }));
  }, [sanitizeFileSegment, setPresentationExportStatus, t]);

  // 📋 生成画布菜单项
  const generateCanvasMenuItems = useCallback((position: Position): ContextMenuItem[] => {
    const menuItems: ContextMenuItem[] = [
      {
        id: 'create-text',
        label: t('canvas.menu.createText', {default: 'New Text Node'}),
        icon: 'Type',
        action: () => {
          onCreateNode('text', position);
          hideContextMenu();
        },
      },
      {
        id: 'create-todo',
        label: t('canvas.menu.createTodo', {default: 'New To-Do Node'}),
        icon: 'CheckSquare',
        action: () => {
          onCreateNode('todo', position);
          hideContextMenu();
        },
      },
      {
        id: 'create-code',
        label: t('canvas.menu.createMermaid', {default: 'New Mermaid Diagram'}),
        icon: 'FileCode2',
        action: () => {
          onCreateNode('code', position);
          hideContextMenu();
        },
      },
      {
        id: 'create-html',
        label: t('canvas.menu.createHTML', {default: 'New HTML Node'}),
        icon: 'Code',
        action: () => {
          onCreateNode('html', position);
          hideContextMenu();
        },
      },
      {
        id: 'create-column',
        label: t('canvas.menu.createColumn', {default: 'New Column'}),
        icon: 'FolderPlus',
        action: () => {
          onCreateNode('column', position);
          hideContextMenu();
        },
      },
      {
        id: 'create-table',
        label: t('canvas.menu.createTable', {default: 'New Table Node'}),
        icon: 'Table',
        action: () => {
          onCreateNode('table', position);
          hideContextMenu();
        },
      },
    ];

    // 思维导图模板创建入口已移除（改用 Tab 扩展方式）

    // 🎯 添加"调整所有节点大小"功能（支持文本、待办、Mermaid、图片媒体、Canvas Link 节点）
    const resizableNodes = nodes.filter(node => {
      // 文本和待办节点：需要有内容
      if (node.type === 'text' || node.type === 'todo') {
        return node.content?.trim();
      }
      // Mermaid节点：code类型且为mermaid
      if (node.type === 'code' && (node as any).codeType === 'mermaid') {
        return (node.content?.trim());
      }
      // Canvas Link：有标题即可
      if (node.type === 'canvas-link') {
        return String((node as any).title || '').trim().length > 0;
      }
      // 媒体图片：可按比例自适应
      if (node.type === 'media' && (node as any).mediaType === 'image') {
        const n: any = node;
        return Boolean(n.fileUrl || n.localPath);
      }
      return false;
    });
    
    if (onBatchSizeChange) {
      const eligibleCount = resizableNodes.filter(n => !(n.type === 'text' && isShapedTextNode(n as CanvasNode))).length;
      menuItems.push(
        {
          id: 'separator-batch',
          label: '',
          separator: true,
          action: () => {},
        },
        {
          id: 'resize-all-nodes',
          label: t('canvas.menu.optimizeSizes', {default: 'Optimize Node Sizes'}),
          icon: 'Maximize2',
          disabled: eligibleCount === 0,
          action: () => {
            hideContextMenu();
            (async () => {
              const updates: Array<{ nodeId: string; size: { width: number; height: number } }> = [];

              const imageSizePromises: Promise<void>[] = [];

              for (const node of resizableNodes) {
                // 有形状的文本节点不参与批量优化
                if (node.type === 'text' && isShapedTextNode(node as CanvasNode)) {
                  continue;
                }
                if (node.type === 'code' && (node as any).codeType === 'mermaid') {
                  const size = calculateMermaidNodeSize(node.id, node.width, node.height, 'mermaid');
                  updates.push({ nodeId: node.id, size });
                  continue;
                }

                if (node.type === 'text' || node.type === 'todo') {
                  const measuredOrEstimatedHeight = measureOrEstimateTextNodeHeight({
                    node,
                    layoutPreset: textLayoutPreset,
                  });
                  updates.push({
                    nodeId: node.id,
                    size: { width: node.width, height: measuredOrEstimatedHeight },
                  });
                  continue;
                }

                if (node.type === 'canvas-link') {
                  const title = String((node as any).title || '').trim();
                  // 离屏测量标题宽度
                  const measure = (text: string, fontSize = 24, fontFamily = 'Google Sans Code, Inter, system-ui, sans-serif') => {
                    try {
                      const canvas = document.createElement('canvas');
                      const ctx = canvas.getContext('2d');
                      if (!ctx) return 0;
                      ctx.font = `${fontSize}px ${fontFamily}`;
                      return ctx.measureText(text).width;
                    } catch { return 0; }
                  };
                  const contentWidth = Math.ceil(measure(title));
                  const PADDING_X = 24; // 左右最小边距
                  const ICON_ROOM = 24; // 右上角图标占位
                  const required = contentWidth + PADDING_X * 2 + ICON_ROOM;
                  const MAX_WIDTH = 800;
                  const MIN_WIDTH = 200; // 允许收缩
                  const newWidth = Math.max(MIN_WIDTH, Math.min(required, MAX_WIDTH));
                  // 估算高度：标题行 + 状态点 + 上下边距
                  const PADDING_Y = 16;
                  const TITLE_H = 32; // 2xl 近似
                  const STATUS_H = 18;
                  const requiredH = Math.max(48, TITLE_H + STATUS_H + PADDING_Y * 2);
                  const MAX_H = 160;
                  const newHeight = Math.max(48, Math.min(requiredH, MAX_H));
                  if (newWidth !== node.width || newHeight !== node.height) {
                    updates.push({ nodeId: node.id, size: { width: newWidth, height: newHeight } });
                  }
                  continue;
                }

                if (node.type === 'media' && (node as any).mediaType === 'image') {
                  const n: any = node;
                  const url = n.fileUrl || n.localPath;
                  if (!url) continue;
                  imageSizePromises.push(new Promise<void>((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                      const naturalW = (img as any).naturalWidth || img.width || 0;
                      const naturalH = (img as any).naturalHeight || img.height || 0;
                      if (naturalW > 0 && naturalH > 0) {
                        const aspect = naturalW / naturalH;
                        const newWidth = Math.max(1, node.height * aspect);
                        updates.push({ nodeId: node.id, size: { width: newWidth, height: node.height } });
                      }
                      resolve();
                    };
                    img.onerror = () => resolve();
                    img.src = url;
                  }));
                  continue;
                }
              }

              if (imageSizePromises.length > 0) {
                await Promise.all(imageSizePromises);
              }

              if (updates.length > 0) {
                onBatchSizeChange?.(updates);
              }
            })();
          },
        }
      );
    }

    return menuItems;
  }, [onCreateNode, nodes, onBatchSizeChange, textLayoutPreset, isShapedTextNode, hideContextMenu, t]);

  // 📋 生成组菜单项
  const generateGroupMenuItems = useCallback((groupId: string): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];

    // Rename
    items.push({
      id: 'group-rename',
      label: t('canvas.menu.group.rename', {default: 'Rename Group'}),
      icon: 'Edit',
      action: () => {
        onRenameGroup?.(groupId);
        hideContextMenu();
      },
    });

    // 对齐/分布（基于组内成员）
    const group = groups?.find(g => g.id === groupId);
    const groupNodeIds = group?.nodeIds || [];
    const memberNodes = nodes.filter(n => groupNodeIds.includes(n.id));
    const canAlign = memberNodes.length >= 2;
    const canDistribute = memberNodes.length >= 3;

    if (onAlignment && memberNodes.length >= 2) {
      const alignmentSubmenu: ContextMenuItem[] = [
        {
          id: 'g-align-left',
          label: t('canvas.menu.align.left', {default: 'Align Left'}),
          icon: 'AlignStartVertical',
          shortcut: DEFAULT_KEYBOARD_SHORTCUTS.alignLeft,
          action: () => {
            if (!canAlign) return;
            const result = NodeAlignmentService.align(memberNodes, AlignmentType.LEFT);
            onAlignment(result.alignedNodes, AlignmentType.LEFT);
          },
          disabled: !canAlign,
        },
        {
          id: 'g-align-right',
          label: t('canvas.menu.align.right', {default: 'Align Right'}),
          icon: 'AlignEndVertical',
          shortcut: DEFAULT_KEYBOARD_SHORTCUTS.alignRight,
          action: () => {
            if (!canAlign) return;
            const result = NodeAlignmentService.align(memberNodes, AlignmentType.RIGHT);
            onAlignment(result.alignedNodes, AlignmentType.RIGHT);
          },
          disabled: !canAlign,
        },
        {
          id: 'g-align-top',
          label: t('canvas.menu.align.top', {default: 'Align Top'}),
          icon: 'AlignStartHorizontal',
          shortcut: DEFAULT_KEYBOARD_SHORTCUTS.alignTop,
          action: () => {
            if (!canAlign) return;
            const result = NodeAlignmentService.align(memberNodes, AlignmentType.TOP);
            onAlignment(result.alignedNodes, AlignmentType.TOP);
          },
          disabled: !canAlign,
        },
        {
          id: 'g-align-bottom',
          label: t('canvas.menu.align.bottom', {default: 'Align Bottom'}),
          icon: 'AlignEndHorizontal',
          shortcut: DEFAULT_KEYBOARD_SHORTCUTS.alignBottom,
          action: () => {
            if (!canAlign) return;
            const result = NodeAlignmentService.align(memberNodes, AlignmentType.BOTTOM);
            onAlignment(result.alignedNodes, AlignmentType.BOTTOM);
          },
          disabled: !canAlign,
        },
        {
          id: 'g-align-center-h',
          label: t('canvas.menu.align.centerH', {default: 'Center Horizontally'}),
          icon: 'AlignHorizontalJustifyCenter',
          shortcut: DEFAULT_KEYBOARD_SHORTCUTS.alignCenterH,
          action: () => {
            if (!canAlign) return;
            const result = NodeAlignmentService.align(memberNodes, AlignmentType.CENTER_H);
            onAlignment(result.alignedNodes, AlignmentType.CENTER_H);
          },
          disabled: !canAlign,
        },
        {
          id: 'g-align-center-v',
          label: t('canvas.menu.align.centerV', {default: 'Center Vertically'}),
          icon: 'AlignVerticalJustifyCenter',
          shortcut: DEFAULT_KEYBOARD_SHORTCUTS.alignCenterV,
          action: () => {
            if (!canAlign) return;
            const result = NodeAlignmentService.align(memberNodes, AlignmentType.CENTER_V);
            onAlignment(result.alignedNodes, AlignmentType.CENTER_V);
          },
          disabled: !canAlign,
        },
      ];

      if (canDistribute) {
        alignmentSubmenu.push(
          { id: 'g-align-sep', label: '', separator: true, action: () => {} },
          {
            id: 'g-distribute-h',
            label: t('canvas.menu.align.distributeH', {default: 'Distribute Horizontally'}),
            icon: 'ArrowRightLeft',
            shortcut: DEFAULT_KEYBOARD_SHORTCUTS.distributeH,
            action: () => {
              const result = NodeAlignmentService.align(memberNodes, AlignmentType.DISTRIBUTE_H);
              onAlignment(result.alignedNodes, AlignmentType.DISTRIBUTE_H);
            },
          },
          {
            id: 'g-distribute-v',
            label: t('canvas.menu.align.distributeV', {default: 'Distribute Vertically'}),
            icon: 'ArrowUpDown',
            shortcut: DEFAULT_KEYBOARD_SHORTCUTS.distributeV,
            action: () => {
              const result = NodeAlignmentService.align(memberNodes, AlignmentType.DISTRIBUTE_V);
              onAlignment(result.alignedNodes, AlignmentType.DISTRIBUTE_V);
            },
          },
        );
      }

      items.push({
        id: 'g-alignment-menu',
        label: canDistribute ? t('canvas.menu.align.alignAndDistribute', {default: 'Align and Distribute'}) : t('canvas.menu.align.title', {default: 'Align'}),
        icon: 'MoreHorizontal',
        hasSubmenu: true,
        submenu: alignmentSubmenu,
      });
      items.push({ id: 'separator-align', label: '', separator: true, action: () => {} });
    }

    // 🎯 群组类型切换
    const currentGroup = nodes.find(n => n.id === groupId && n.type === 'group') as any;
    const isMindmap = currentGroup && (currentGroup.groupMode === 'mindmap' || Boolean(currentGroup.mindmap));
    const switchToLabel = isMindmap ? 'Switch to Group' : 'Switch to Mind Map';
    const switchIcon = isMindmap ? 'Folder' : 'Workflow';

    items.push({
      id: 'group-switch-type',
      label: switchToLabel,
      icon: switchIcon,
      action: () => {
        onSwitchGroupType?.(groupId, !isMindmap);
        hideContextMenu();
      },
    });

    items.push({ id: 'separator-switch', label: '', separator: true, action: () => {} });

    // 思维导图方向切换（仅当为思维导图组时显示）
    if (isMindmap) {
      const orientation: 'right' | 'both' = (currentGroup?.mindmap?.orientation === 'both') ? 'both' : 'right';
      const orientationSubmenu: ContextMenuItem[] = [
        {
          id: 'g-orient-right',
          label: t('canvas.mindmap.orientation.right', { default: 'Right only' }),
          icon: 'ArrowRight',
          action: () => { onSwitchMindmapOrientation?.(groupId, 'right'); hideContextMenu(); },
          checked: orientation === 'right',
        },
        {
          id: 'g-orient-both',
          label: t('canvas.mindmap.orientation.both', { default: 'Both sides' }),
          icon: 'ArrowLeftRight',
          action: () => { onSwitchMindmapOrientation?.(groupId, 'both'); hideContextMenu(); },
          checked: orientation === 'both',
        }
      ];
      items.push({
        id: 'g-orientation',
        label: t('canvas.mindmap.orientation.title', { default: 'Mindmap Orientation' }),
        icon: 'ArrowLeftRight',
        hasSubmenu: true,
        submenu: orientationSubmenu,
      });
      items.push({ id: 'separator-orientation', label: '', separator: true, action: () => {} });
    }

    // Ungroup
    items.push({
      id: 'group-ungroup',
      label: t('canvas.menu.group.ungroup', {default: 'Ungroup'}),
      icon: 'Split',
      action: () => {
        onUngroup?.(groupId);
        hideContextMenu();
      },
    });
    return items;
  }, [onRenameGroup, onUngroup, onAlignment, nodes, groups, t, hideContextMenu, onSwitchGroupType, onSwitchMindmapOrientation]);

  // 📋 生成节点菜单项
  const generateNodeMenuItems = useCallback((targetNodeId: string): ContextMenuItem[] => {
    const targetNode = nodes.find(node => node.id === targetNodeId);
    if (!targetNode) return [];

    // 🚫 表格节点有自己的右键菜单系统，不使用画布右键菜单
    if (targetNode.type === 'table') return [];

    const isMultiSelect = selectedNodes.length > 1;
    const selectedNodeIds = isMultiSelect ? selectedNodes : [targetNodeId];

    const items: ContextMenuItem[] = [];

    // Edit (single selection)
    if (!isMultiSelect) {
      items.push({
        id: 'edit-node',
        label: t('canvas.menu.node.edit', {default: 'Edit Node'}),
        icon: 'Edit',
        action: () => {
          onEditNode(targetNodeId);
          hideContextMenu();
        },
      });

      const isTextLike = targetNode.type === 'text' || targetNode.type === 'todo';
      if (isTextLike && onOpenExpandedEditor) {
        items.push({
          id: 'open-expanded-editor',
          label: t('canvas.menu.node.expandEdit', { default: 'Open Expanded Editor' }),
          icon: 'Maximize2',
          action: () => {
            onOpenExpandedEditor(targetNodeId);
            hideContextMenu();
          },
        });
      }

      items.push({
        id: 'separator-1',
        label: '',
        separator: true,
        action: () => {},
      });
    }

    // Pin/Unpin (single selection)
    if (!isMultiSelect) {
      const isLocked = targetNode.locked;
      items.push({
        id: 'toggle-pin',
        label: isLocked ? 'unpin' : 'pin',
        icon: isLocked ? 'Unlock' : 'Lock',
        action: () => {
          onLockToggle(targetNodeId, !isLocked);
          hideContextMenu();
        },
      });
      
      items.push({
        id: 'separator-2',
        label: '',
        separator: true,
        action: () => {},
      });
    }

    // AI toggle (single/multi) — combined entry
    if (onToggleNodeAI && selectedNodeIds.length > 0) {
      const aiCount = selectedNodeIds.reduce((acc, id) => acc + (nodes.find(n => n.id === id)?.ai ? 1 : 0), 0);
      const allAI = aiCount === selectedNodeIds.length;
      const label = allAI
        ? (isMultiSelect ? t('canvas.menu.node.ai.unmarkSelected', {default: 'Unmark AI (Selected)'}) : t('canvas.menu.node.ai.unmark', {default: 'Unmark AI'}))
        : (isMultiSelect ? t('canvas.menu.node.ai.markSelected', {default: 'Mark as AI (Selected)'}) : t('canvas.menu.node.ai.mark', {default: 'Mark as AI'}));
      items.push({ id: 'toggle-ai', label, icon: 'Sparkles', action: () => { onToggleNodeAI(selectedNodeIds, !allAI); hideContextMenu(); } });
      items.push({ id: 'separator-ai', label: '', separator: true, action: () => {} });
    }

    // Optimize size for supported node types
    if (!isMultiSelect) {
    const isTextLike = targetNode.type === 'text' || targetNode.type === 'todo';
    const shapedText = targetNode.type === 'text' && isShapedTextNode(targetNode);
    const isResizable = isTextLike ||
                         targetNode.type === 'canvas-link' ||
                         (targetNode.type === 'code' && (targetNode as any).codeType === 'mermaid') ||
                         (targetNode.type === 'media' && (targetNode as any).mediaType === 'image' && ((targetNode as any).fileUrl || (targetNode as any).localPath));

      if (isResizable) {
        items.push({
          id: 'auto-resize',
          label: t('canvas.menu.node.optimize', {default: 'Optimize Size'}),
          icon: 'Maximize2',
          disabled: shapedText,
          action: () => {
            hideContextMenu();
            (async () => {
              if (targetNode.type === 'code' && (targetNode as any).codeType === 'mermaid') {
                const optimalSize = calculateMermaidNodeSize(targetNodeId, targetNode.width, targetNode.height, 'mermaid');
                onSizeChange(targetNodeId, optimalSize);
                onAutoSizeModeChange?.(targetNodeId, 'auto');
                return;
              }

              if (targetNode.type === 'text' || targetNode.type === 'todo') {
                // 有形状的文本节点：完全跳过
                if (isShapedTextNode(targetNode as CanvasNode)) { return; }
                const optimalSize = {
                  width: targetNode.width,
                  height: measureOrEstimateTextNodeHeight({
                    node: targetNode,
                    layoutPreset: textLayoutPreset,
                  }),
                };
                onSizeChange(targetNodeId, optimalSize);
                onAutoSizeModeChange?.(targetNodeId, 'auto');
                return;
              }

              if (targetNode.type === 'canvas-link') {
                // Measure title width & adjust size
                const title = String((targetNode as any).title || '').trim();
                const measure = (text: string, fontSize = 24, fontFamily = 'Google Sans Code, Inter, system-ui, sans-serif') => {
                  try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return 0;
                    ctx.font = `${fontSize}px ${fontFamily}`;
                    return ctx.measureText(text).width;
                  } catch { return 0; }
                };
                const contentWidth = Math.ceil(measure(title));
                const PADDING_X = 24;
                const ICON_ROOM = 24;
                const required = contentWidth + PADDING_X * 2 + ICON_ROOM;
                const MAX_WIDTH = 800;
                const MIN_WIDTH = 200; // allow shrink
                const newWidth = Math.max(MIN_WIDTH, Math.min(required, MAX_WIDTH));

                // Estimate height
                const PADDING_Y = 16;
                const TITLE_H = 32; // 2xl 近似
                const STATUS_H = 18;
                const requiredH = Math.max(48, TITLE_H + STATUS_H + PADDING_Y * 2);
                const MAX_H = 160;
                const newHeight = Math.max(48, Math.min(requiredH, MAX_H));

                if (newWidth !== targetNode.width || newHeight !== targetNode.height) {
                  onSizeChange(targetNodeId, { width: newWidth, height: newHeight });
                }
                onAutoSizeModeChange?.(targetNodeId, 'auto');
                return;
              }

              if (targetNode.type === 'media' && (targetNode as any).mediaType === 'image') {
                const n: any = targetNode;
                const url = n.fileUrl || n.localPath;
                if (!url) return;
                await new Promise<void>((resolve) => {
                  const img = new Image();
                  img.onload = () => {
                    const naturalW = (img as any).naturalWidth || img.width || 0;
                    const naturalH = (img as any).naturalHeight || img.height || 0;
                    if (naturalW > 0 && naturalH > 0) {
                      const aspect = naturalW / naturalH;
                      const newWidth = Math.max(1, targetNode.height * aspect);
                      onSizeChange(targetNodeId, { width: newWidth, height: targetNode.height });
                      onAutoSizeModeChange?.(targetNodeId, 'auto');
                    }
                    resolve();
                  };
                  img.onerror = () => resolve();
                  img.src = url;
                });
                return;
              }
            })();
          },
        });

        items.push({
          id: 'separator-3',
          label: '',
          separator: true,
          action: () => {},
        });
      }

      if (isPresentationResultHtmlNode(targetNode)) {
        items.push({
          id: 'presentation-fullscreen',
          label: t('canvas.menu.presentation.fullscreen', { default: '全屏展示' }),
          icon: 'Maximize2',
          action: () => {
            hideContextMenu();
            triggerPresentationFullscreen(targetNodeId).catch((error) => {
              const message = error instanceof Error
                ? error.message
                : t('canvas.menu.presentation.fullscreenFailed', { default: 'Failed to enter fullscreen mode' });
              toast.error(message);
            });
          },
        });

        items.push({
          id: 'presentation-download-html',
          label: t('canvas.menu.presentation.downloadHtml', { default: '下载 HTML' }),
          icon: 'Download',
          action: () => {
            hideContextMenu();
            try {
              downloadHtmlSnapshot(targetNode);
            } catch (error) {
              const message = error instanceof Error
                ? error.message
                : t('canvas.menu.presentation.downloadHtmlFailed', { default: 'Failed to download HTML' });
              toast.error(message);
            }
          },
        });

        items.push({
          id: 'presentation-download-pptx',
          label: t('canvas.menu.presentation.downloadPptx', { default: '导出 PPTX' }),
          icon: 'Download',
          action: () => {
            hideContextMenu();
            (async () => {
              try {
                setPresentationExportStatus(targetNodeId, 'pptx', 'running');
                const runtime = await ensurePresentationSandboxAsset(targetNode);
                const fileBase = sanitizeFileSegment(runtime.presentationTitle);
                await downloadPresentation(
                  DownloadFormat.PPTX,
                  runtime.sandboxUrl,
                  runtime.presentationPath,
                  fileBase,
                );
                setPresentationExportStatus(targetNodeId, 'pptx', 'success', {
                  result: {
                    fileName: `${fileBase}.pptx`,
                  },
                });
              } catch (error) {
                const message = error instanceof Error
                  ? error.message
                  : t('canvas.menu.presentation.downloadPptxFailed', { default: 'Failed to export PPTX' });
                setPresentationExportStatus(targetNodeId, 'pptx', 'failed', {
                  error: {
                    code: 'pptx_export_failed',
                    message,
                  },
                });
                toast.error(message);
              }
            })();
          },
        });

        items.push({
          id: 'presentation-export-google-slides',
          label: t('canvas.menu.presentation.exportGoogleSlides', { default: '导出到 Google Slides' }),
          icon: 'ExternalLink',
          action: () => {
            hideContextMenu();
            (async () => {
              try {
                setPresentationExportStatus(targetNodeId, 'googleSlides', 'running');
                const runtime = await ensurePresentationSandboxAsset(targetNode);
                const uploadResult = await handleGoogleSlidesUpload(runtime.sandboxUrl, runtime.presentationPath);

                if (uploadResult?.redirected_to_auth) {
                  setPresentationExportStatus(targetNodeId, 'googleSlides', 'idle');
                  return;
                }

                const googleSlidesUrl = uploadResult?.google_slides_url;
                if (!googleSlidesUrl) {
                  throw new Error(t('canvas.menu.presentation.googleSlidesNoUrl', { default: 'No Google Slides URL returned' }));
                }
                const presentationId = googleSlidesUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];

                setPresentationExportStatus(targetNodeId, 'googleSlides', 'success', {
                  result: {
                    url: googleSlidesUrl,
                    presentationId,
                  },
                });
              } catch (error) {
                const message = error instanceof Error
                  ? error.message
                  : t('canvas.menu.presentation.exportGoogleSlidesFailed', { default: 'Failed to export to Google Slides' });
                setPresentationExportStatus(targetNodeId, 'googleSlides', 'failed', {
                  error: {
                    code: 'google_slides_export_failed',
                    message,
                  },
                });
                toast.error(message);
              }
            })();
          },
        });

        items.push({
          id: 'separator-presentation',
          label: '',
          separator: true,
          action: () => {},
        });
      }

      if (targetNode.type === 'media') {
        const storagePath = deriveStoragePath(targetNode as any);
        const downloadUrl = storagePath
          ? buildMediaProxyUrlHelper(storagePath, {
              token: session?.access_token,
              canvasId: currentCanvasId || undefined,
              extraParams: targetNode.fileName ? { download: targetNode.fileName } : undefined,
            })
          : undefined;
        const uploadStatus = (targetNode as any).uploadStatus;
        const disabled = !downloadUrl || (uploadStatus && uploadStatus !== 'uploaded');
        items.push({
          id: 'media-download',
          label: t('canvas.menu.media.downloadOriginal', { default: '下载原图' }),
          icon: 'Download',
          disabled,
          action: () => {
            if (disabled || !downloadUrl) return;
            try {
              const link = document.createElement('a');
              link.href = downloadUrl;
              link.download = targetNode.fileName || 'media-file';
              link.rel = 'noreferrer';
              link.target = '_self';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              toast.success(t('canvas.menu.media.downloadStarted', { default: '已开始下载' }));
            } catch (err) {
              console.error('[canvas] Failed to open media download link', err);
            }
            hideContextMenu();
          },
        });
        items.push({
          id: 'separator-media',
          label: '',
          separator: true,
          action: () => {},
        });
      }
    }

    // Leave group (single)
    if (!isMultiSelect && onLeaveGroup) {
      // 检查节点是否在群组中：方法1 - 通过 parentGroupId
      const hasParentGroup = Boolean((targetNode as any).parentGroupId);
      // 检查节点是否在群组中：方法2 - 通过 groups 数组查找
      const nodeInGroup = groups?.some(group => group.nodeIds.includes(targetNodeId));

      if (hasParentGroup || nodeInGroup) {
        items.push({ id: 'leave-group', label: t('canvas.menu.leaveGroup', {default: 'Leave Group'}), icon: 'ArrowUpFromLine', action: () => { onLeaveGroup(targetNodeId); hideContextMenu(); } });

        items.push({
          id: 'separator-leave-group',
          label: '',
          separator: true,
          action: () => {},
        });
      }
    }

    // 思维导图菜单入口移除（使用 Tab 扩展）

    // Group (multi select or node+connection)
    const selectionElementsCount = selectedNodeIds.length + (selectedConnections?.length || 0);
    if (onCreateGroup && selectionElementsCount >= 2) {
      items.push({
        id: 'group-create',
        label: t('canvas.menu.group.group', {default: 'Group'}),
        icon: 'SquareStack',
        action: () => {
          onCreateGroup(selectedNodeIds, selectedConnections);
          hideContextMenu();
        },
      });
      items.push({ id: 'separator-group', label: '', separator: true, action: () => {} });
    }

    // 🎯 对齐选项（多选时显示，且支持对齐操作）
    if (isMultiSelect && selectedNodeIds.length >= 2 && onAlignment) {
      const selectedNodeObjects = nodes.filter(node => selectedNodeIds.includes(node.id));
      const canAlign = selectedNodeIds.length >= 2;
      const canDistribute = selectedNodeIds.length >= 3;
      
      // Alignment submenu
      const alignmentSubmenu: ContextMenuItem[] = [
        {
          id: 'align-left',
          label: t('canvas.menu.align.left', {default: 'Align Left'}),
          icon: 'AlignStartVertical',
          shortcut: DEFAULT_KEYBOARD_SHORTCUTS.alignLeft,
          action: () => {
            if (canAlign) {
              const result = NodeAlignmentService.align(selectedNodeObjects, AlignmentType.LEFT);
              onAlignment(result.alignedNodes, AlignmentType.LEFT);
            }
          },
          disabled: !canAlign,
        },
        {
          id: 'align-right',
          label: t('canvas.menu.align.right', {default: 'Align Right'}),
          icon: 'AlignEndVertical',
          shortcut: DEFAULT_KEYBOARD_SHORTCUTS.alignRight,
          action: () => {
            if (canAlign) {
              const result = NodeAlignmentService.align(selectedNodeObjects, AlignmentType.RIGHT);
              onAlignment(result.alignedNodes, AlignmentType.RIGHT);
            }
          },
          disabled: !canAlign,
        },
        {
          id: 'align-top',
          label: t('canvas.menu.align.top', {default: 'Align Top'}),
          icon: 'AlignStartHorizontal',
          shortcut: DEFAULT_KEYBOARD_SHORTCUTS.alignTop,
          action: () => {
            if (canAlign) {
              const result = NodeAlignmentService.align(selectedNodeObjects, AlignmentType.TOP);
              onAlignment(result.alignedNodes, AlignmentType.TOP);
            }
          },
          disabled: !canAlign,
        },
        {
          id: 'align-bottom',
          label: t('canvas.menu.align.bottom', {default: 'Align Bottom'}),
          icon: 'AlignEndHorizontal',
          shortcut: DEFAULT_KEYBOARD_SHORTCUTS.alignBottom,
          action: () => {
            if (canAlign) {
              const result = NodeAlignmentService.align(selectedNodeObjects, AlignmentType.BOTTOM);
              onAlignment(result.alignedNodes, AlignmentType.BOTTOM);
            }
          },
          disabled: !canAlign,
        },
        {
          id: 'align-center-h',
          label: t('canvas.menu.align.centerH', {default: 'Center Horizontally'}),
          icon: 'AlignHorizontalJustifyCenter',
          shortcut: DEFAULT_KEYBOARD_SHORTCUTS.alignCenterH,
          action: () => {
            if (canAlign) {
              const result = NodeAlignmentService.align(selectedNodeObjects, AlignmentType.CENTER_H);
              onAlignment(result.alignedNodes, AlignmentType.CENTER_H);
            }
          },
          disabled: !canAlign,
        },
        {
          id: 'align-center-v',
          label: t('canvas.menu.align.centerV', {default: 'Center Vertically'}),
          icon: 'AlignVerticalJustifyCenter',
          shortcut: DEFAULT_KEYBOARD_SHORTCUTS.alignCenterV,
          action: () => {
            if (canAlign) {
              const result = NodeAlignmentService.align(selectedNodeObjects, AlignmentType.CENTER_V);
              onAlignment(result.alignedNodes, AlignmentType.CENTER_V);
            }
          },
          disabled: !canAlign,
        },
      ];

      // Distribution entries
      if (canDistribute) {
        alignmentSubmenu.push(
          {
            id: 'alignment-separator',
            label: '',
            separator: true,
            action: () => {},
          },
          {
            id: 'distribute-h',
            label: 'Distribute Horizontally',
            icon: 'ArrowRightLeft',
            shortcut: DEFAULT_KEYBOARD_SHORTCUTS.distributeH,
            action: () => {
              const result = NodeAlignmentService.align(selectedNodeObjects, AlignmentType.DISTRIBUTE_H);
              onAlignment(result.alignedNodes, AlignmentType.DISTRIBUTE_H);
            },
          },
          {
            id: 'distribute-v',
            label: 'Distribute Vertically',
            icon: 'ArrowUpDown',
            shortcut: DEFAULT_KEYBOARD_SHORTCUTS.distributeV,
            action: () => {
              const result = NodeAlignmentService.align(selectedNodeObjects, AlignmentType.DISTRIBUTE_V);
              onAlignment(result.alignedNodes, AlignmentType.DISTRIBUTE_V);
            },
          }
        );
      }

      items.push({
        id: 'alignment-menu',
        label: canDistribute ? t('canvas.menu.align.alignAndDistribute', {default: 'Align and Distribute'}) : t('canvas.menu.align.title', {default: 'Align'}),
        icon: 'MoreHorizontal',
        hasSubmenu: true,
        submenu: alignmentSubmenu,
        action: () => {}, // 子菜单不需要直接action
      });

      items.push({
        id: 'separator-alignment',
        label: '',
        separator: true,
        action: () => {},
      });
    }

    // 复制选项
      items.push({ id: 'duplicate-nodes', label: isMultiSelect ? t('canvas.menu.duplicateNodes', {count: selectedNodeIds.length, default: 'Duplicate {count} Nodes'}) : t('canvas.menu.duplicateNode', {default: 'Duplicate Node'}), icon: 'Copy', action: () => { onDuplicateNodes(selectedNodeIds); hideContextMenu(); } });

      // Delete
      items.push({ id: 'delete-nodes', label: isMultiSelect ? t('canvas.menu.deleteNodes', {count: selectedNodeIds.length, default: 'Delete {count} Nodes'}) : t('canvas.menu.deleteNode', {default: 'Delete Node'}), icon: 'Trash2', action: () => { onDeleteNodes(selectedNodeIds); hideContextMenu(); } });

    // 如果是多选，添加分隔符和选择信息
    if (isMultiSelect) {
      items.unshift({
        id: 'separator-0',
        label: '',
        separator: true,
        action: () => {},
      });
      
      items.unshift({ id: 'multi-select-info', label: t('canvas.menu.selectedCount', {count: selectedNodeIds.length, default: 'Selected {count} nodes'}), icon: 'CheckSquare', disabled: true, action: () => {} });
    }

    // Compact separators for text node: keep only one before delete
    const isText = targetNode.type === 'text';
    if (isText) {
      const compact: ContextMenuItem[] = [];
      let insertedDeleteSeparator = false;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.separator) continue; // drop all raw separators for text node
        const isDelete = (it.id?.includes('delete') || it.icon === 'Trash2');
        if (isDelete && compact.length > 0 && !insertedDeleteSeparator) {
          compact.push({ id: 'separator-delete', label: '', separator: true, action: () => {} } as any);
          insertedDeleteSeparator = true;
        }
        compact.push(it);
      }
      return compact;
    }
    // Generic cleanup: remove leading/trailing and duplicate separators
    const trimmed: ContextMenuItem[] = [];
    for (const it of items) {
      if (it.separator) {
        if (trimmed.length === 0) continue;
        if (trimmed[trimmed.length - 1].separator) continue;
      }
      trimmed.push(it);
    }
    if (trimmed.length > 0 && trimmed[trimmed.length - 1].separator) trimmed.pop();
    return trimmed;
  }, [nodes, selectedNodes, onEditNode, onOpenExpandedEditor, onLockToggle, onSizeChange, onDuplicateNodes, onDeleteNodes, onAlignment, onCreateGroup, onAutoSizeModeChange, isShapedTextNode, session?.access_token, currentCanvasId, groups, hideContextMenu, onLeaveGroup, onToggleNodeAI, selectedConnections, t, textLayoutPreset, triggerPresentationFullscreen, downloadHtmlSnapshot, ensurePresentationSandboxAsset, sanitizeFileSegment, setPresentationExportStatus]);

  // 📋 生成连线菜单项
  const generateConnectionMenuItems = useCallback((targetConnectionId: string): ContextMenuItem[] => {
    const targetConnection = connections.find(conn => conn.id === targetConnectionId);
    if (!targetConnection) return [];

    const isMultiSelect = selectedConnections.length > 1;
    const selectedConnectionIds = isMultiSelect ? selectedConnections : [targetConnectionId];

    const items: ContextMenuItem[] = [];

    // Edit (single)
    if (!isMultiSelect && onEditConnection) {
      items.push({ id: 'edit-connection', label: t('canvas.menu.connection.editLabel', {default: 'Edit Label'}), icon: 'Edit', action: () => { onEditConnection(targetConnectionId); hideContextMenu(); } });
      
      items.push({
        id: 'separator-1',
        label: '',
        separator: true,
        action: () => {},
      });
    }

    // Style submenu — keep compact and consistent with global UI
    try {
      const store = useCanvasStore.getState();
      const applyTo = (patch: any) => {
        selectedConnectionIds.forEach((id) => store.updateConnection(id, { appearance: patch } as any));
        hideContextMenu();
      };
      const styleSubmenu: ContextMenuItem[] = [
        { id: 'style-solid', label: t('canvas.menu.connection.style.solid', {default: 'Solid'}), action: () => applyTo({ dashed: false, dashArray: undefined }) },
        { id: 'style-dashed', label: t('canvas.menu.connection.style.dashed', {default: 'Dashed'}), action: () => applyTo({ dashed: true, dashArray: [6,3] }) },
        { id: 'sep-style-1', label: '', separator: true, action: () => {} },
        { id: 'arrow-end-toggle', label: t('canvas.menu.connection.style.toggleEnd', {default: 'Toggle End Arrow'}), action: () => {
            const end = !Boolean(((targetConnection as any).appearance?.arrow?.end) ?? true);
            applyTo({ arrow: { ...((targetConnection as any).appearance?.arrow||{}), end } });
          }
        },
        { id: 'arrow-start-toggle', label: t('canvas.menu.connection.style.toggleStart', {default: 'Toggle Start Arrow'}), action: () => {
            const start = !Boolean(((targetConnection as any).appearance?.arrow?.start) ?? false);
            applyTo({ arrow: { ...((targetConnection as any).appearance?.arrow||{}), start } });
          }
        },
        { id: 'sep-style-2', label: '', separator: true, action: () => {} },
        { id: 'color-blue', label: t('canvas.menu.connection.style.color', {name: 'Blue', default: 'Color: {name}'}), action: () => applyTo({ color: '#3b82f6' }) },
        { id: 'color-red', label: t('canvas.menu.connection.style.color', {name: 'Red', default: 'Color: {name}'}), action: () => applyTo({ color: '#ef4444' }) },
        { id: 'color-green', label: t('canvas.menu.connection.style.color', {name: 'Green', default: 'Color: {name}'}), action: () => applyTo({ color: '#10b981' }) },
        { id: 'color-amber', label: t('canvas.menu.connection.style.color', {name: 'Amber', default: 'Color: {name}'}), action: () => applyTo({ color: '#f59e0b' }) },
        { id: 'color-violet', label: t('canvas.menu.connection.style.color', {name: 'Violet', default: 'Color: {name}'}), action: () => applyTo({ color: '#8b5cf6' }) },
        { id: 'color-slate', label: t('canvas.menu.connection.style.color', {name: 'Slate', default: 'Color: {name}'}), action: () => applyTo({ color: '#64748b' }) },
      ];
      items.push({ id: 'connection-style', label: t('canvas.menu.connection.style.title', {default: 'Style'}), icon: 'MoreHorizontal', hasSubmenu: true, submenu: styleSubmenu, action: () => {} });
      items.push({ id: 'separator-style', label: '', separator: true, action: () => {} });
    } catch {}

    // 删除选项
    if (onDeleteConnections) {
      items.push({ id: 'delete-connections', label: isMultiSelect ? t('canvas.menu.connection.deleteConnections', {count: selectedConnectionIds.length, default: 'Delete {count} connections'}) : t('canvas.menu.connection.deleteOne', {default: 'Delete Connection'}), icon: 'Trash2', action: () => { onDeleteConnections(selectedConnectionIds); hideContextMenu(); } });
    }

    // 如果是多选，添加选择信息
    if (isMultiSelect) {
      items.unshift({
        id: 'separator-0',
        label: '',
        separator: true,
        action: () => {},
      });
      
      items.unshift({ id: 'multi-select-info', label: `Selected ${selectedConnectionIds.length} connections`, icon: 'Link', disabled: true, action: () => {} });
    }

    return items;
  }, [connections, selectedConnections, onEditConnection, onDeleteConnections, t, hideContextMenu]);

  // 🖱️ 右键菜单处理
  const handleContextMenu = useCallback((event: React.MouseEvent, targetNodeId?: string, targetConnectionId?: string, rightClickState?: any) => {
    // Chat 模式也允许右键菜单（仅在共享/只读模式下由父层阻断）
    
    // 🎯 如果正在右键拖动或刚刚完成拖动，不显示菜单
    if (rightClickState?.isRightDragging || rightClickState?.hasRightDragged) {
      event.preventDefault();
      return;
    }
    
    event.preventDefault();
    event.stopPropagation();

    // 🎯 修复：区分屏幕坐标（用于菜单显示）和画布坐标（用于节点创建）
    const screenPosition: Position = {
      x: event.clientX,
      y: event.clientY,
    };

    // 🎯 计算画布坐标用于节点创建
    const canvasContainer = document.querySelector('[data-canvas-container]');
    let canvasPosition: Position = screenPosition; // 默认值
    
    if (canvasContainer) {
      const rect = canvasContainer.getBoundingClientRect();
      const transformWrapper = canvasContainer.querySelector('.react-transform-wrapper');
      const transformComponent = transformWrapper?.querySelector('.react-transform-component');
      
      if (transformComponent) {
        const style = window.getComputedStyle(transformComponent);
        const transform = style.transform;
        
        if (transform && transform !== 'none') {
          const matrix = new DOMMatrix(transform);
          const scale = matrix.a;
          const translateX = matrix.e;
          const translateY = matrix.f;
          
          // 🎯 正确的屏幕坐标到画布坐标转换
          canvasPosition = {
            x: (event.clientX - rect.left - translateX) / scale,
            y: (event.clientY - rect.top - translateY) / scale
          };
        }
      }
    }

    let menuItems: ContextMenuItem[];
    
    if (targetConnectionId) {
      // 连线右键菜单
      menuItems = generateConnectionMenuItems(targetConnectionId);
    } else if (targetNodeId) {
      // 节点右键菜单
      menuItems = generateNodeMenuItems(targetNodeId);
    } else {
      // 🎯 画布/组菜单判定：先检测是否命中组（外扩8px）
      let hitGroupId: string | null = null;
      if (groups && groups.length > 0) {
        const nodeMap = new Map<string, CanvasNode>();
        nodes.forEach(n => nodeMap.set(n.id, n));
        const groupNodeMap = new Map<string, CanvasNode>();
        nodes.forEach(n => { if ((n as any).type === 'group') groupNodeMap.set(n.id, n); });
        const fakeCanvas: Canvas = {
          id: 'ctx', title: '', nodes, connections: (connections || []),
          createdAt: 0, updatedAt: 0, version: '1.0.0'
        } as Canvas;
        for (const g of groups) {
          const groupNode = groupNodeMap.get(g.id);
          let members = g.nodeIds.map(id => nodeMap.get(id)).filter(Boolean) as CanvasNode[];
          // 思维导图：按折叠状态过滤隐藏成员，避免使用“全部展开”的几何
          if (groupNode && (groupNode as any).mindmap) {
            try {
              const hidden = getHiddenMindmapNodesForGroup(fakeCanvas, g.id);
              if (hidden && hidden.size > 0) {
                members = members.filter(m => !hidden.has(m.id));
              }
              if (members.length === 0) {
                const rootId = (groupNode as any).mindmap?.rootId as string | undefined;
                const root = rootId ? nodeMap.get(rootId) : undefined;
                if (root) members = [root];
              }
            } catch {}
          }
          if (members.length === 0) continue;
          const b = calculateGroupBounds(members);
          const offset = 8;
          const bx = b.x - offset;
          const by = b.y - offset;
          const bw = b.width + offset * 2;
          const bh = b.height + offset * 2;
          if (canvasPosition.x >= bx && canvasPosition.x <= bx + bw && canvasPosition.y >= by && canvasPosition.y <= by + bh) {
            hitGroupId = g.id;
            break;
          }
        }
      }

      if (hitGroupId) {
        menuItems = generateGroupMenuItems(hitGroupId);
      } else {
        menuItems = generateCanvasMenuItems(canvasPosition);
      }
    }

    // 如果没有任何菜单项，避免显示空白菜单
    if (!menuItems || menuItems.length === 0) {
      return;
    }

    setContextMenu({ visible: true, x: screenPosition.x, y: screenPosition.y, items: menuItems, meta: targetNodeId ? { targetNodeId } : undefined });
  }, [generateNodeMenuItems, generateCanvasMenuItems, generateConnectionMenuItems, connections, generateGroupMenuItems, groups, nodes]);

  // 🚫 隐藏菜单
  

  // 🎮 全局点击监听（点击外部关闭菜单）
  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      // 如果点击在菜单外部，关闭菜单
      if (contextMenu.visible) {
        const target = event.target as Element;
        if (!target.closest('.context-menu')) {
          hideContextMenu();
        }
      }
    };

    if (contextMenu.visible) {
      document.addEventListener('click', handleGlobalClick);
      document.addEventListener('contextmenu', handleGlobalClick);
      
      return () => {
        document.removeEventListener('click', handleGlobalClick);
        document.removeEventListener('contextmenu', handleGlobalClick);
      };
    }
  }, [contextMenu.visible, hideContextMenu]);

  // ⌨️ ESC键关闭菜单
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape' && contextMenu.visible) {
        hideContextMenu();
      }
    };

    if (contextMenu.visible) {
      document.addEventListener('keydown', handleKeyDown);
      
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [contextMenu.visible, hideContextMenu]);

  return {
    contextMenu,
    handleContextMenu,
    hideContextMenu,
  };
};
