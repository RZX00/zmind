import type { Canvas, CanvasConnection, CanvasNode } from '../../types/canvas';
import type {
  OutlineNodeRelationDetails,
  OutlineNodeRelationMap,
  OutlineNodeRelationSummary,
  OutlineRelationLink,
} from '../../types/outline';

function firstLine(text: string): string {
  if (!text) return '';
  const idx = text.indexOf('\n');
  const ln = idx === -1 ? text : text.slice(0, idx);
  return ln.trim();
}

function getDisplayTitle(node: CanvasNode): string {
  const t = node.title && node.title.trim();
  const c = firstLine(node.content || '');
  if (node.type === 'canvas-link') {
    return (t || c || '').trim();
  }
  if (node.type === 'column' || node.type === 'group') {
    const columnText = c || (t || '');
    return columnText.trim();
  }
  return c;
}

function fallbackTitle(node: CanvasNode): string {
  return getDisplayTitle(node) || node.id;
}

function createEmptySummary(nodeId: string): OutlineNodeRelationSummary {
  return {
    nodeId,
    inboundCount: 0,
    outboundCount: 0,
    crossContainerCount: 0,
    danglingInboundCount: 0,
    danglingOutboundCount: 0,
  };
}

function createEmptyDetails(node: CanvasNode): OutlineNodeRelationDetails {
  return {
    nodeId: node.id,
    nodeTitle: fallbackTitle(node),
    inbound: [],
    outbound: [],
    summary: createEmptySummary(node.id),
  };
}

function createOutboundLink(
  connection: CanvasConnection,
  fromNode: CanvasNode,
  toNode?: CanvasNode,
): OutlineRelationLink {
  const crossContainer = !!toNode && ((fromNode.parentGroupId || null) !== (toNode.parentGroupId || null));
  return {
    edgeId: connection.id,
    label: (connection.label || '').trim() || undefined,
    otherNodeId: toNode?.id || connection.to || undefined,
    otherNodeTitle: toNode ? fallbackTitle(toNode) : `[Missing: ${connection.to || 'unknown'}]`,
    crossContainer,
    dangling: !toNode,
    otherNodeType: toNode?.type,
  };
}

function createInboundLink(
  connection: CanvasConnection,
  toNode: CanvasNode,
  fromNode?: CanvasNode,
): OutlineRelationLink {
  const crossContainer = !!fromNode && ((fromNode.parentGroupId || null) !== (toNode.parentGroupId || null));
  return {
    edgeId: connection.id,
    label: (connection.label || '').trim() || undefined,
    otherNodeId: fromNode?.id || connection.from || undefined,
    otherNodeTitle: fromNode ? fallbackTitle(fromNode) : `[Missing: ${connection.from || 'unknown'}]`,
    crossContainer,
    dangling: !fromNode,
    otherNodeType: fromNode?.type,
  };
}

function updateSummary(details: OutlineNodeRelationDetails): OutlineNodeRelationDetails {
  const crossContainerEdgeIds = new Set<string>();
  const inboundCross = details.inbound.filter((edge) => edge.crossContainer);
  const outboundCross = details.outbound.filter((edge) => edge.crossContainer);
  inboundCross.forEach((edge) => crossContainerEdgeIds.add(edge.edgeId));
  outboundCross.forEach((edge) => crossContainerEdgeIds.add(edge.edgeId));

  details.summary = {
    nodeId: details.nodeId,
    inboundCount: details.inbound.length,
    outboundCount: details.outbound.length,
    crossContainerCount: crossContainerEdgeIds.size,
    danglingInboundCount: details.inbound.filter((edge) => edge.dangling).length,
    danglingOutboundCount: details.outbound.filter((edge) => edge.dangling).length,
  };

  return details;
}

export function buildNodeRelationSummary(canvas: Canvas): OutlineNodeRelationMap {
  const nodes = canvas.nodes || [];
  const connections = canvas.connections || [];
  const nodesById = new Map<string, CanvasNode>();
  const relationMap: OutlineNodeRelationMap = new Map<string, OutlineNodeRelationDetails>();

  nodes.forEach((node) => {
    nodesById.set(node.id, node);
    relationMap.set(node.id, createEmptyDetails(node));
  });

  connections.forEach((connection) => {
    const fromNode = connection.from ? nodesById.get(connection.from) : undefined;
    const toNode = connection.to ? nodesById.get(connection.to) : undefined;

    if (fromNode) {
      const details = relationMap.get(fromNode.id);
      if (details) {
        details.outbound.push(createOutboundLink(connection, fromNode, toNode));
      }
    }

    if (toNode) {
      const details = relationMap.get(toNode.id);
      if (details) {
        details.inbound.push(createInboundLink(connection, toNode, fromNode));
      }
    }
  });

  relationMap.forEach((details, nodeId) => {
    relationMap.set(nodeId, updateSummary(details));
  });

  return relationMap;
}
