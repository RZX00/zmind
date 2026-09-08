import { useCallback } from 'react';
import type { Canvas, CanvasNode } from '../../../../types/canvas';
import { useCanvasStore } from '../../../stores/canvas.store';

export interface UseGroupsParams {
  canvas: Canvas;
  updateCanvas: (canvas: Canvas) => void;
  selectedGroupId: string | null;
  createGroup: (ids: string[], nodes: CanvasNode[]) => any | null;
  startGroupDrag: (e: React.MouseEvent, group: any, createdFromPermanent?: boolean, permanentGroupId?: string) => void;
}

export interface UseGroupsResult {
  onSelectGroup: (groupId: string | null) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onGroupDragStart: (e: React.MouseEvent, groupId: string) => void;
  onUngroup: (groupId: string) => void;
}

export default function useGroups(params: UseGroupsParams): UseGroupsResult {
  const { canvas, updateCanvas, selectedGroupId, createGroup, startGroupDrag } = params;
  const store = useCanvasStore();

  const onSelectGroup = useCallback((groupId: string | null) => {
    store.selectGroup(groupId);
    store.selectNodes([]);
  }, [store]);

  const onRenameGroup = useCallback((groupId: string, name: string) => {
    const now = Date.now();
    const updatedNodes = canvas.nodes.map((n) => {
      if (n.id === groupId && (n as any).type === 'group') {
        const trimmed = (name || '').trim();
        const content = n.content || '';
        const idx = content.indexOf('\n');
        const rest = idx === -1 ? '' : content.slice(idx);
        // 移除遗留的 title 字段
        const { title: _omit, ...restNode } = (n as any);
        return { ...restNode, content: trimmed + (rest || ''), updatedAt: now } as CanvasNode;
      }
      return n;
    });
    updateCanvas({ ...canvas, nodes: updatedNodes, updatedAt: now });
  }, [canvas, updateCanvas]);

  const onGroupDragStart = useCallback((e: React.MouseEvent, groupId: string) => {
    const nodes = canvas.nodes || [];
    const group = nodes.find((n) => n.id === groupId && (n as any).type === 'group') as any;
    if (!group) return;

    // 建立索引，便于 O(1) 查找
    const byId = new Map<string, CanvasNode>();
    for (const n of nodes) byId.set(n.id, n);

    // 递归收集：包含所有子群组的后代“叶子节点”，以及所有 column 与其 children
    const collected = new Set<string>();
    const visiting = new Set<string>();

    const isGroup = (n: CanvasNode | undefined): boolean => !!n && (n as any).type === 'group';
    const isColumn = (n: CanvasNode | undefined): boolean => !!n && n.type === 'column';

    const collectColumnClosure = (col: CanvasNode) => {
      collected.add(col.id);
      const children: string[] = Array.isArray((col as any).children) ? ((col as any).children as string[]) : [];
      for (const cid of children) {
        if (!cid || collected.has(cid)) continue;
        collected.add(cid);
      }
    };

    const collectGroupClosure = (gid: string) => {
      if (!gid || visiting.has(gid)) return;
      visiting.add(gid);
      const g = byId.get(gid);
      if (!g) return;
      // 可选：将群组节点本身也加入，提升拖拽时的即时反馈（几何会由叶子回写）
      collected.add(gid);
      const children: string[] = Array.isArray((g as any).children) ? ((g as any).children as string[]) : [];
      for (const cid of children) {
        if (!cid) continue;
        const cn = byId.get(cid);
        if (!cn) continue;
        if (isGroup(cn)) {
          collectGroupClosure(cn.id);
        } else if (isColumn(cn)) {
          collectColumnClosure(cn);
        } else {
          collected.add(cn.id);
        }
      }
    };

    // 从被点击的“永久群组”开始，递归收集深度闭包
    collectGroupClosure(groupId);

    // 构建临时群组：将收集到的 id 对应的节点传入，交由 useTemporaryGroup 计算边界（仅叶子参与）
    const selectedNodesForTemp = nodes.filter((n) => collected.has(n.id));
    const temp = createGroup(Array.from(collected), selectedNodesForTemp);
    if (temp) startGroupDrag(e, temp, true, groupId);
  }, [canvas, createGroup, startGroupDrag]);

  const onUngroup = useCallback((groupId: string) => {
    const now = Date.now();
    const group = canvas.nodes.find((n) => n.id === groupId && (n as any).type === 'group') as any;
    const childIds: string[] = group?.children || [];
    const cleanedNodes = canvas.nodes
      .filter((n) => n.id !== groupId)
      .map((n) => {
        if (childIds.includes(n.id)) {
          const { parentGroupId: _omit, ...rest } = n as any;
          return { ...rest, updatedAt: now } as any;
        }
        return n;
      });
    updateCanvas({ ...canvas, nodes: cleanedNodes, updatedAt: now });
    if (selectedGroupId === groupId) store.selectGroup(null);
  }, [canvas, updateCanvas, selectedGroupId, store]);

  return { onSelectGroup, onRenameGroup, onGroupDragStart, onUngroup };
}
