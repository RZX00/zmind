import { useCallback, useEffect, useRef, useState } from 'react';
import type { Canvas, CanvasNode } from '../../../../types/canvas';
import { updateNode } from '../../../utils/canvasUtils';

export interface CanvasOption { id: string; title: string; lastUpdated: number }
export interface CanvasSelectionResult { id: string; title: string; thumbnailUrl?: string }

export interface UseCanvasLinkWorkflowParams {
  canvas: Canvas;
  updateCanvas: (canvas: Canvas) => void;
  onGetAvailableCanvases?: () => Promise<Array<{ id: string; title: string; lastUpdated: number }>>;
  onCanvasExists?: (canvasId: string) => Promise<boolean>;
  onCreateCanvas?: (name: string) => Promise<string>;
}

export interface UseCanvasLinkWorkflowResult {
  // modal state
  modal: {
    isVisible: boolean;
    availableCanvases: CanvasOption[];
    loading: boolean;
    currentNodeTitle?: string;
  };
  // modal handlers
  onSelect: (result: CanvasSelectionResult) => void;
  onCancel: () => void;
  onCreate: (name: string) => Promise<string>;

  // APIs
  getAvailableCanvases: () => Promise<CanvasOption[]>;
  showCanvasSelection: (currentTitle?: string) => Promise<CanvasSelectionResult | null>;
  updateCanvasLinkTitle: (nodeId: string, title: string) => void;
}

export default function useCanvasLinkWorkflow(params: UseCanvasLinkWorkflowParams): UseCanvasLinkWorkflowResult {
  const { canvas, updateCanvas, onGetAvailableCanvases, onCanvasExists, onCreateCanvas } = params;

  const canvasRef = useRef(canvas);
  useEffect(() => { canvasRef.current = canvas; }, [canvas]);

  const [modal, setModal] = useState<{
    isVisible: boolean;
    availableCanvases: CanvasOption[];
    resolvePromise?: (result: CanvasSelectionResult | null) => void;
    loading: boolean;
    currentNodeTitle?: string;
  }>({ isVisible: false, availableCanvases: [], loading: false });

  const getAvailableCanvases = useCallback(async (): Promise<CanvasOption[]> => {
    if (onGetAvailableCanvases) {
      try {
        const items = await onGetAvailableCanvases();
        return items.map((c) => ({ id: c.id, title: String(c.title || '未命名画布'), lastUpdated: c.lastUpdated }));
      } catch (e) {
        console.error('获取画布列表失败:', e);
        throw e;
      }
    }
    return [];
  }, [onGetAvailableCanvases]);

  const showCanvasSelection = useCallback(async (currentTitle?: string): Promise<CanvasSelectionResult | null> => {
    try {
      const options = await getAvailableCanvases();
      return new Promise<CanvasSelectionResult | null>((resolve) => {
        setModal({ isVisible: true, availableCanvases: options, resolvePromise: resolve, loading: false, currentNodeTitle: currentTitle || '' });
      });
    } catch (e) {
      console.error('❌ 画布选择失败:', e);
      return null;
    }
  }, [getAvailableCanvases]);

  const onSelect = useCallback((result: CanvasSelectionResult) => {
    setModal((prev) => {
      prev.resolvePromise?.(result);
      return { isVisible: false, availableCanvases: [], loading: false } as any;
    });
  }, []);

  const onCancel = useCallback(() => {
    setModal((prev) => {
      prev.resolvePromise?.(null);
      return { isVisible: false, availableCanvases: [], loading: false } as any;
    });
  }, []);

  const onCreate = useCallback(async (name: string): Promise<string> => {
    if (!onCreateCanvas) throw new Error('无法创建新画布：缺少创建函数');
    setModal((prev) => ({ ...prev, loading: true }));
    try {
      const newId = await onCreateCanvas(name);
      return newId;
    } catch (e) {
      console.error('❌ 在弹窗中创建画布失败:', e);
      throw e;
    } finally {
      setModal((prev) => ({ ...prev, loading: false }));
    }
  }, [onCreateCanvas]);

  const updateCanvasLinkTitle = useCallback((nodeId: string, title: string) => {
    const currentCanvas = canvasRef.current;
    const nodeIndex = currentCanvas.nodes.findIndex((n) => n.id === nodeId);
    if (nodeIndex === -1) return;
    const nodeToUpdate = currentCanvas.nodes[nodeIndex];
    if (!nodeToUpdate) return;
    const updatedNode = updateNode(nodeToUpdate, { title });
    const newCanvas: Canvas = {
      ...currentCanvas,
      nodes: currentCanvas.nodes.map((n, idx) => (idx === nodeIndex ? updatedNode : n)),
      updatedAt: Date.now(),
    };
    updateCanvas(newCanvas);
  }, [updateCanvas]);

  return {
    modal: { isVisible: modal.isVisible, availableCanvases: modal.availableCanvases, loading: modal.loading, currentNodeTitle: modal.currentNodeTitle },
    onSelect,
    onCancel,
    onCreate,
    getAvailableCanvases,
    showCanvasSelection,
    updateCanvasLinkTitle,
  };
}

