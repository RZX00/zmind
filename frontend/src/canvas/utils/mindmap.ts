import type { Canvas, CanvasNode } from '../types/canvas';
import { isMindmapGroup as _isMindmapGroup } from './groupUtils';
import { findMindmapGroupForNode } from './mindmapLayout';

export function isMindmapGroup(node: CanvasNode): boolean {
  return _isMindmapGroup(node as any);
}

export function getMindmapGroupForNode(canvas: Canvas, nodeId: string): CanvasNode | null {
  return findMindmapGroupForNode(canvas, nodeId);
}

export function isNodeInMindmap(canvas: Canvas, nodeId: string): boolean {
  return Boolean(getMindmapGroupForNode(canvas, nodeId));
}

export function areNodesInSameMindmapGroup(canvas: Canvas, aId: string, bId: string): boolean {
  const ga = getMindmapGroupForNode(canvas, aId) as any;
  const gb = getMindmapGroupForNode(canvas, bId) as any;
  return !!(ga && gb && ga.id === gb.id && ga.mindmap);
}

