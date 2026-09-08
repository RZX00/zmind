import type { Canvas, CanvasConnection, CanvasNode } from "../types/canvas";
import { getConnectionSettings } from "../stores/settings.store";
import { anchorFromParams, computeAnchorParams } from "../utils/dynamicConnectionRenderer";
import { getNodeTypeSpecificDefaults } from "../components/core/systems/NodeDefaults";

const cloneThemeConfig = (theme?: any) => (theme ? JSON.parse(JSON.stringify(theme)) : undefined);
const DEFAULT_MERMAID_THEME = (() => {
  const defaults = getNodeTypeSpecificDefaults("code", "mermaid") as any;
  return {
    mermaidThemeId: defaults?.mermaidThemeId || "professional",
    mermaidTheme: cloneThemeConfig(defaults?.mermaidTheme),
  };
})();

const getDefaultMermaidThemePayload = () => ({
  mermaidThemeId: DEFAULT_MERMAID_THEME.mermaidThemeId,
  mermaidTheme: cloneThemeConfig(DEFAULT_MERMAID_THEME.mermaidTheme),
});

const isMermaidNode = (node?: CanvasNode | null) =>
  Boolean(node && node.type === "code" && (node as any).codeType === "mermaid");

const resolveLatestMermaidTheme = (nodes: CanvasNode[] = []) => {
  let latest: { themeId?: string; theme?: any; ts: number } | null = null;
  nodes.forEach((node) => {
    if (!isMermaidNode(node)) return;
    const themeId = (node as any).mermaidThemeId as string | undefined;
    const themeConfig = (node as any).mermaidTheme;
    if (!themeId && !themeConfig) return;
    const ts = typeof node.updatedAt === "number" ? node.updatedAt : 0;
    if (!latest || ts >= latest.ts) {
      latest = { themeId, theme: themeConfig, ts };
    }
  });
  if (latest) {
    return {
      mermaidThemeId: latest.themeId || DEFAULT_MERMAID_THEME.mermaidThemeId,
      mermaidTheme: cloneThemeConfig(latest.theme || DEFAULT_MERMAID_THEME.mermaidTheme),
    };
  }
  return getDefaultMermaidThemePayload();
};

export const ensureMermaidThemeForNode = (node: CanvasNode, existingNodes: CanvasNode[]) => {
  if (!isMermaidNode(node)) return node;
  const hasTheme = Boolean((node as any).mermaidThemeId || (node as any).mermaidTheme);
  if (hasTheme) return node;
  const payload = resolveLatestMermaidTheme(existingNodes);
  return {
    ...node,
    mermaidThemeId: payload.mermaidThemeId,
    mermaidTheme: cloneThemeConfig(payload.mermaidTheme),
  };
};

export const applyMermaidThemeDefaults = (canvas: Canvas): Canvas => {
  if (!canvas || !Array.isArray(canvas.nodes) || canvas.nodes.length === 0) {
    return canvas;
  }
  const payload = resolveLatestMermaidTheme(canvas.nodes);
  let mutated = false;
  const nextNodes = canvas.nodes.map((node) => {
    if (!isMermaidNode(node)) {
      return node;
    }
    const hasTheme = Boolean((node as any).mermaidThemeId || (node as any).mermaidTheme);
    if (hasTheme) {
      return node;
    }
    mutated = true;
    return {
      ...node,
      mermaidThemeId: payload.mermaidThemeId,
      mermaidTheme: cloneThemeConfig(payload.mermaidTheme),
    };
  });
  return mutated ? { ...canvas, nodes: nextNodes } : canvas;
};

export const applyMetadataToCanvas = (input: Canvas): Canvas => {
  if (!input) return input;
  const meta = ((input as any).metadata || {}) as {
    connectionAnchors?: Record<string, { x: number; y: number }>;
    connectionAnchorParams?: Record<string, { u: number; v: number }>;
    connectionStyles?: Record<string, any>;
    groupAttachments?: Record<string, string[]>;
  };
  const anchors = meta.connectionAnchors || {};
  const anchorParams = meta.connectionAnchorParams || {};
  const styles = meta.connectionStyles || {};
  const attachments = meta.groupAttachments || {};
  const nodes = (input.nodes || []).map((node) => {
    if (
      (node as any)?.type === "group" &&
      Array.isArray(attachments[node.id]) &&
      (!Array.isArray((node as any).attachedConnections) || !(node as any).attachedConnections.length)
    ) {
      return {
        ...(node as any),
        attachedConnections: [...attachments[node.id]],
      } as CanvasNode;
    }
    return node;
  });
  const connections = (input.connections || []).map((connection) => {
    const base = { ...(connection as any) } as CanvasConnection & Record<string, any>;
    const anchor = anchors[connection.id];
    const params = anchorParams[connection.id];
    const style = styles[connection.id];
    if (!base.curveAnchor && anchor) {
      base.curveAnchor = { x: anchor.x, y: anchor.y };
    }
    if (!base.anchorParams && params) {
      base.anchorParams = { u: params.u, v: params.v };
    }
    if (!base.appearance && style) {
      base.appearance = style;
    }
    return base;
  });
  return { ...input, nodes, connections };
};

export const shouldMigrateAnchors = (canvas: Canvas): boolean => {
  return (canvas.connections || []).some((c: any) => {
    if (!c) return false;
    if (c.fromPoint || c.toPoint) return false;
    if (!c.curveAnchor) return false;
    const params = c.anchorParams;
    return !params || typeof params.u !== "number" || typeof params.v !== "number";
  });
};

export const migrateAnchorParams = (
  canvasIn: Canvas,
): { out: Canvas; migrated: number } => {
  const nodesById = new Map<string, CanvasNode>((canvasIn.nodes || []).map((n) => [n.id, n]));
  const settings = getConnectionSettings();
  const nodes = canvasIn.nodes || [];
  const migratedConnections = (canvasIn.connections || []).map((conn) => {
    if (!conn || conn.fromPoint || conn.toPoint || !conn.curveAnchor) {
      return conn;
    }
    const fromNode = conn.from ? nodesById.get(conn.from) : undefined;
    const toNode = conn.to ? nodesById.get(conn.to) : undefined;
    if (!fromNode || !toNode) {
      return conn;
    }
    const fromPos = { x: fromNode.x + fromNode.width / 2, y: fromNode.y + fromNode.height / 2 };
    const toPos = { x: toNode.x + toNode.width / 2, y: toNode.y + toNode.height / 2 };
    const params = computeAnchorParams(fromPos, toPos, conn.curveAnchor);
    return {
      ...conn,
      anchorParams: params,
      anchor: anchorFromParams(fromPos, toPos, params),
    };
  });

  return {
    out: {
      ...canvasIn,
      nodes,
      connections: migratedConnections,
    },
    migrated: migratedConnections.length,
  };
};
