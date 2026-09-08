// Markdown → Mindmap lightweight parser and builder
// Converts structured Markdown (headings, nested lists, task items, code blocks, tables as text)
// into mindmap nodes + connections + a mindmap group, with immediate auto-sizing.

import type { CanvasNode, CanvasConnection } from '../types/canvas';
import { DEFAULT_NODE_SIZES } from '../types/canvas';
import { createNodeAtPosition } from '../components/core/systems/NodeFactory';
import { NodeIds } from './nodeIdUtils';
import { calculateOptimalNodeSize } from './canvasUtils';
import { useSettingsStore } from '../stores/settings.store';

export interface BuildMindmapResult {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  group: CanvasNode; // group node with mindmap metadata
  rootId: string;
  truncated: boolean;
  totalNodes: number;
}

// Heuristic: consider text as mindmap candidate if it contains
// - 2+ heading levels (e.g., # / ##), or
// - nested lists (ordered/unordered) with at least 2 levels, or
// - 8+ list items overall
export function isMarkdownMindmapCandidate(text: string): boolean {
  const lines = text.split(/\r?\n/);
  let headingCount = 0;
  let listCount = 0;
  let maxIndent = 0;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const h = line.match(/^\s*(#{1,6})\s+\S/);
    if (h) headingCount++;
    const m = line.match(/^\s*(?:[-*+]\s+|\d+\.\s+)/);
    if (m) {
      listCount++;
      const indentSpaces = countIndentSpaces(raw);
      const level = Math.floor(indentSpaces / 2); // 2 spaces = 1 level
      if (level > maxIndent) maxIndent = level;
    }
  }

  if (headingCount >= 2) return true;
  if (maxIndent >= 1 && listCount >= 3) return true; // nested lists present
  if (listCount >= 8) return true;
  return false;
}

// Core builder: returns null when text is not a suitable candidate.
export function buildMindmapFromMarkdown(
  text: string,
  canvasId: string,
  base: { x: number; y: number },
  maxNodes = 180
): BuildMindmapResult | null {
  if (!isMarkdownMindmapCandidate(text)) return null;

  const blocks = tokenizeMarkdown(text);
  if (blocks.length === 0) return null;

  // Build a simple tree using depth (headings define absolute depths, lists are relative)
  const tree = buildTree(blocks);
  if (tree.nodes.length === 0) return null;

  // Pick root: first top-level node
  const rootIndex = tree.nodes.findIndex(n => n.depth === 1);
  const root = tree.nodes[rootIndex >= 0 ? rootIndex : 0];

  // Create group first to know groupId for parentGroupId assignment
  const group: CanvasNode = createNodeAtPosition('group' as any, { x: Math.max(base.x - 40, 0), y: Math.max(base.y - 40, 0) }, canvasId, {
    title: '思维导图',
    children: [],
    groupStyles: { bgOpacity: 0 },
    accentColor: '#60a5fa',
    groupMode: 'mindmap',
    mindmap: {
      rootId: '',
      spacingX: 96,
      spacingY: 30,
      orientation: 'right',
      showCrossLinks: true,
      collapsed: {}
    }
  } as any);

  const createdNodes: CanvasNode[] = [];
  const connections: CanvasConnection[] = [];
  const indexToId = new Map<number, string>();
  let count = 0;
  let truncated = false;

  const defaultWidth: number = Number(DEFAULT_NODE_SIZES.text.width);
  const defaultHeight: number = Number(DEFAULT_NODE_SIZES.text.height);

  // Create nodes depth-first preserving order; initial position = base
  for (let i = 0; i < tree.nodes.length; i++) {
    const t = tree.nodes[i];
    if (count >= maxNodes) { truncated = true; break; }

    const nodeType = t.kind === 'todo' ? 'todo' : 'text';
    const content = t.content.trim();

    // Auto size immediately for text/todo (width based on content, clamp to [min, 2x])
    let targetWidth: number = defaultWidth;
    let targetHeight: number = defaultHeight;
    // Mindmap nodes: estimate width prioritizing width up to 450, then height grows
    try {
      const autoMode = (() => { try { return useSettingsStore.getState().mindmap?.autoWidthMode === 'auto'; } catch { return false; } })();
      const { estimateAutoTextWidth, calculateOptimalNodeSize, getTextLayoutPreset, DEFAULT_TEXT_LAYOUT_PRESET } = require('./canvasUtils');
      const presetId = undefined;
      const layout = getTextLayoutPreset ? getTextLayoutPreset(presetId ?? DEFAULT_TEXT_LAYOUT_PRESET) : undefined;
      targetWidth = autoMode ? estimateAutoTextWidth(content, { layoutPreset: layout, nodeType: nodeType as any, clamp: { min: 150, max: 450 } }) : defaultWidth;
    } catch {}
    try {
      const { calculateTextNodeHeight, getTextLayoutPreset, DEFAULT_TEXT_LAYOUT_PRESET } = require('./canvasUtils');
      const presetId = undefined;
      const layout = getTextLayoutPreset ? getTextLayoutPreset(presetId ?? DEFAULT_TEXT_LAYOUT_PRESET) : undefined;
      targetHeight = Math.max(defaultHeight, calculateTextNodeHeight(content, targetWidth, { layoutPreset: layout }));
    } catch {}

    const isRoot = i === root.index;
    const nodeX = isRoot ? (base.x - targetWidth / 2) : base.x;
    const nodeY = isRoot ? (base.y - targetHeight / 2) : base.y;
    const node = createNodeAtPosition(nodeType as any, { x: nodeX, y: nodeY }, canvasId, {
      content,
      completed: t.kind === 'todo' ? !!t.completed : undefined,
      width: targetWidth,
      height: targetHeight,
      parentGroupId: group.id, // ensure factory knows we're in a mindmap group
    } as any);

    createdNodes.push(node);
    indexToId.set(i, node.id);
    count++;
  }

  // Root id must be an existing created node
  const rootIdx = Math.min(root.index, createdNodes.length - 1);
  const rootId = createdNodes[rootIdx]?.id || createdNodes[0]?.id;

  // Create connections for created nodes only
  for (const edge of tree.edges) {
    if (edge.child >= createdNodes.length || edge.parent >= createdNodes.length) continue;
    const from = indexToId.get(edge.parent);
    const to = indexToId.get(edge.child);
    if (!from || !to) continue;
    connections.push({
      id: NodeIds.generateConnectionId(canvasId),
      from, to,
      createdAt: Date.now(),
      label: ''
    });
  }

  // Finalize group children and metadata
  (group as any).children = createdNodes.map(n => n.id);
  (group as any).mindmap = { ...((group as any).mindmap || {}), rootId };

  return {
    nodes: createdNodes,
    connections,
    group,
    rootId,
    truncated,
    totalNodes: tree.nodes.length
  };
}

// ===== helpers =====

function countIndentSpaces(s: string): number {
  // Treat tab as 2 spaces for consistency
  let count = 0;
  for (const ch of s) {
    if (ch === ' ') count++;
    else if (ch === '\t') count += 2;
    else break;
  }
  return count;
}

type BlockKind = 'heading' | 'list' | 'todo' | 'code' | 'table';

interface Block {
  kind: BlockKind;
  depth: number; // for headings: absolute level; for list/code/table: relative within current heading
  text: string;  // content
}

function tokenizeMarkdown(text: string): Block[] {
  const lines = text.split(/\r?\n/);
  const blocks: Block[] = [];
  let inCode = false;
  let codeLang: string | null = null;
  let codeBuf: string[] = [];
  let currentHeadingDepth = 0; // absolute base for lists/tables/code

  // table block accumulator
  let inTable = false;
  let tableBuf: string[] = [];

  const flushTable = (indentDepth: number) => {
    if (inTable && tableBuf.length > 0) {
      blocks.push({ kind: 'table', depth: Math.max(1, currentHeadingDepth + 1 + indentDepth), text: tableBuf.join('\n') });
    }
    inTable = false;
    tableBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\t/g, '  '); // normalize
    const trimmed = line.trim();

    // Code fences
    const fence = trimmed.match(/^```\s*(\w+)?\s*$/);
    if (fence) {
      // entering or leaving
      if (!inCode) {
        // flush any pending table
        flushTable(0);
        inCode = true;
        codeLang = fence[1] || null;
        codeBuf = [];
      } else {
        inCode = false;
        const codeText = codeBuf.join('\n');
        const indentDepth = 0;
        // treat code block as plain text node under current heading/list
        blocks.push({ kind: 'code', depth: Math.max(1, currentHeadingDepth + 1 + indentDepth), text: codeText });
        codeBuf = [];
        codeLang = null;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }

    // Skip empty lines unless in table accumulation
    if (!trimmed) {
      flushTable(0);
      continue;
    }

    // Headings
    const hm = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      flushTable(0);
      const level = hm[1].length;
      currentHeadingDepth = level; // absolute base for subsequent blocks
      blocks.push({ kind: 'heading', depth: level, text: hm[2].trim() });
      continue;
    }

    // List / Task item
    const listm = line.match(/^\s*(?:([-*+])\s+|(\d+)\.\s+)([\s\S]*)$/);
    if (listm) {
      flushTable(0);
      const indentSpaces = countIndentSpaces(line);
      const indentLevel = Math.floor(indentSpaces / 2);
      const content = (listm[3] || '').trim();
      const todoMatch = content.match(/^\[( |x|X)\]\s+([\s\S]*)$/);
      if (todoMatch) {
        const checked = todoMatch[1].toLowerCase() === 'x';
        const blk: Block = { kind: 'todo', depth: Math.max(1, currentHeadingDepth + 1 + indentLevel), text: (todoMatch[2] || '').trim() } as any;
        (blk as any).completed = checked;
        blocks.push(blk);
      } else {
        blocks.push({ kind: 'list', depth: Math.max(1, currentHeadingDepth + 1 + indentLevel), text: content });
      }
      continue;
    }

    // Table-like lines (pipe rows). Accumulate consecutive pipe lines.
    if (trimmed.includes('|')) {
      const indentSpaces = countIndentSpaces(line);
      const indentLevel = Math.floor(indentSpaces / 2);
      // Start or continue table accumulation
      if (!inTable) {
        inTable = true;
        tableBuf = [trimmed];
        (tableBuf as any)._indent = indentLevel;
      } else {
        tableBuf.push(trimmed);
      }
      // Peek next to decide flush later
      const next = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
      if (!next || !next.includes('|')) {
        const ind = (tableBuf as any)._indent || 0;
        flushTable(ind);
      }
      continue;
    }

    // Plain paragraph under current heading → ignore (avoid flooding mindmap)
    // Users asked to convert structured content; paragraphs are not included.
    flushTable(0);
  }

  // Flush tail
  if (inCode && codeBuf.length) {
    const codeText = codeBuf.join('\n');
    blocks.push({ kind: 'code', depth: Math.max(1, currentHeadingDepth + 1), text: codeText });
  }
  if (inTable && tableBuf.length) {
    const ind = (tableBuf as any)._indent || 0;
    blocks.push({ kind: 'table', depth: Math.max(1, currentHeadingDepth + 1 + ind), text: tableBuf.join('\n') });
  }

  return blocks;
}

interface TreeBlock {
  index: number;       // sequential index
  depth: number;       // 1-based depth
  kind: 'text' | 'todo';
  content: string;
  completed?: boolean;
}

function buildTree(blocks: Block[]): { nodes: TreeBlock[]; edges: Array<{ parent: number; child: number }>; } {
  const nodes: TreeBlock[] = [];
  const edges: Array<{ parent: number; child: number }> = [];

  // Convert block kinds to final node kinds
  const toNodeKind = (b: Block): { kind: 'text' | 'todo'; content: string; completed?: boolean } => {
    if (b.kind === 'todo') {
      // completed was attached dynamically; attempt to read
      const anyb = b as any;
      return { kind: 'todo', content: b.text, completed: !!anyb.completed };
    }
    // heading/list/code/table → text nodes
    return { kind: 'text', content: b.text };
  };

  // We maintain a stack of last node index for each depth.
  const stack: number[] = []; // node index at each depth-1
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const d = Math.max(1, Math.floor(b.depth));
    const nk = toNodeKind(b);
    const nodeIndex = nodes.length;
    nodes.push({ index: nodeIndex, depth: d, kind: nk.kind, content: nk.content, completed: nk.completed });

    // Maintain parent by depth
    while (stack.length >= d) stack.pop();
    if (stack.length > 0) {
      const parentIdx = stack[stack.length - 1];
      edges.push({ parent: parentIdx, child: nodeIndex });
    }
    stack.push(nodeIndex);
  }

  return { nodes, edges };
}
