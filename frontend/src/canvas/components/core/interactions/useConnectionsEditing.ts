import { useCallback, useEffect, useRef, useState } from 'react';
import type { Canvas, CanvasNode } from '../../../../types/canvas';
import { useCanvasStore } from '../../../stores/canvas.store';

export interface UseConnectionsEditingParams {
  canvas: Canvas;
  updateCanvas: (canvas: Canvas) => void;
  editMode: 'none' | 'node' | 'connection';
  editingEntityId: string | null;
  selectedConnectionIds: Set<string>;
  clearSelectedNodes: () => void;
}

export interface UseConnectionsEditingResult {
  connectionInputRef: React.RefObject<HTMLInputElement>;
  connectionLabelInput: string;
  setConnectionLabelInput: (value: string) => void;
  handleLabelEdit: (connectionId: string) => void;
  handleLabelSave: () => void;
  handleLabelCancel: () => void;
  handleLabelKeyDown: (event: React.KeyboardEvent) => void;
  handleConnectionClick: (connectionId: string, e: React.MouseEvent) => void;
}

const useConnectionsEditing = (params: UseConnectionsEditingParams): UseConnectionsEditingResult => {
  const { canvas, updateCanvas, editMode, editingEntityId, selectedConnectionIds, clearSelectedNodes } = params;
  const store = useCanvasStore();

  const connectionInputRef = useRef<HTMLInputElement>(null);
  const editingStartTimeRef = useRef<number>(0);
  const [connectionLabelInput, setConnectionLabelInput] = useState<string>('');

  const handleLabelEdit = useCallback((connectionId: string) => {
    const connection = canvas.connections?.find((c) => c.id === connectionId);
    if (!connection) return;
    editingStartTimeRef.current = Date.now();
    store.enterEditMode('connection', connectionId, connection.label || '');
    setConnectionLabelInput(connection.label || '');
  }, [canvas.connections, store]);

  const handleLabelSave = useCallback(() => {
    if (editMode !== 'connection' || !editingEntityId) return;
    const trimmed = connectionLabelInput.trim();
    const updatedConnections = (canvas.connections || []).map((c) =>
      c.id === editingEntityId ? (trimmed ? { ...c, label: trimmed } : { ...c, label: '' }) : c
    );
    const updated: Canvas = { ...canvas, connections: updatedConnections, updatedAt: Date.now() };
    updateCanvas(updated);
    store.cancelEdit();
    setConnectionLabelInput('');
  }, [editMode, editingEntityId, connectionLabelInput, canvas, updateCanvas, store]);

  const handleLabelCancel = useCallback(() => {
    store.cancelEdit();
    setConnectionLabelInput('');
  }, [store]);

  const handleLabelKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleLabelSave();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleLabelCancel();
    }
  }, [handleLabelSave, handleLabelCancel]);

  // 自动聚焦到输入框
  useEffect(() => {
    if (editMode === 'connection' && editingEntityId && connectionInputRef.current) {
      const t = setTimeout(() => {
        connectionInputRef.current?.focus();
        connectionInputRef.current?.select();
      }, 100);
      return () => clearTimeout(t);
    }
  }, [editMode, editingEntityId]);

  const handleConnectionClick = useCallback((connectionId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (editMode === 'connection') return;

    if (event.ctrlKey || event.metaKey) {
      const currentSelected = Array.from(selectedConnectionIds);
      if (currentSelected.includes(connectionId)) {
        store.selectConnections(currentSelected.filter((id) => id !== connectionId));
      } else {
        store.selectConnections([...currentSelected, connectionId]);
      }
    } else {
      store.selectConnections([connectionId]);
    }
    clearSelectedNodes();
  }, [editMode, selectedConnectionIds, clearSelectedNodes, store]);

  return {
    connectionInputRef,
    connectionLabelInput,
    setConnectionLabelInput,
    handleLabelEdit,
    handleLabelSave,
    handleLabelCancel,
    handleLabelKeyDown,
    handleConnectionClick,
  };
};

export default useConnectionsEditing;

