export const ALLOWED_OPS = Object.freeze([
  'add_node',
  'update_node',
  'delete_node',
  'move_node',
  'apply_style',
  'add_connection',
  'update_connection',
  'delete_connection',
  'update_canvas',
  'relayout_mindmap',
  'update_table_cell',
  'table_row_op',
  'table_col_op',
]);

export const OP_ALIASES = Object.freeze({
  addnode: 'add_node',
  updatenode: 'update_node',
  deletenode: 'delete_node',
  movenode: 'move_node',
  applystyle: 'apply_style',
  addconnection: 'add_connection',
  updateconnection: 'update_connection',
  deleteconnection: 'delete_connection',
  updatecanvas: 'update_canvas',
  relayoutmindmap: 'relayout_mindmap',
  updatetablecell: 'update_table_cell',
  tablerowop: 'table_row_op',
  tablecolop: 'table_col_op',
});

export const CANVAS_PATCH_KEYS = Object.freeze([
  'title',
  'cornerStyle',
  'fontStyle',
  'textOpacityPreset',
  'textLayoutPreset',
  'folderId',
  'backgroundColor',
  'backgroundStyleId',
  'patternColor',
  'metadata',
]);

const ALLOWED_OP_SET = new Set(ALLOWED_OPS);

const normalizeOpValue = (value: unknown): string | null => {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (ALLOWED_OP_SET.has(raw)) return raw;
  const rawSnake = raw.replace(/[-\s]+/g, '_');
  if (ALLOWED_OP_SET.has(rawSnake)) return rawSnake;
  const camel = rawSnake.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  if (ALLOWED_OP_SET.has(camel)) return camel;
  const compact = raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return OP_ALIASES[compact as keyof typeof OP_ALIASES] ?? null;
};

const normalizeKey = (
  target: Record<string, any>,
  src: string,
  dst: string,
  ctx: string,
  warnings: string[],
) => {
  if (
    target &&
    Object.prototype.hasOwnProperty.call(target, src) &&
    !Object.prototype.hasOwnProperty.call(target, dst)
  ) {
    target[dst] = target[src];
    warnings.push(`normalized ${ctx}.${src} -> ${dst}`);
  }
};

export const normalizeCanvasOps = (
  operations: Record<string, any>[],
): { operations: Record<string, any>[]; warnings: string[] } => {
  const warnings: string[] = [];
  if (!Array.isArray(operations)) {
    return { operations, warnings };
  }

  operations.forEach((op) => {
    if (!op || typeof op !== 'object') return;

    const rawOp = op.op;
    const normalizedOp = normalizeOpValue(rawOp);
    if (normalizedOp && normalizedOp !== rawOp) {
      op.op = normalizedOp;
      warnings.push(`normalized op value ${rawOp} -> ${normalizedOp}`);
    }

    if (!op.op) {
      for (const key of ['type', 'operation', 'action']) {
        const candidate = op[key];
        const normalized = normalizeOpValue(candidate);
        if (!normalized) continue;
        op.op = normalized;
        warnings.push(`normalized op.${key} -> op`);
        if (candidate !== normalized) {
          warnings.push(`normalized op value ${candidate} -> ${normalized}`);
        }
        break;
      }
    }

    const kind = op.op;
    if (!kind) return;

    if (['update_node', 'delete_node', 'move_node', 'apply_style'].includes(kind)) {
      normalizeKey(op, 'node_id', 'id', kind, warnings);
      normalizeKey(op, 'nodeId', 'id', kind, warnings);
    }
    if (['update_table_cell', 'table_row_op', 'table_col_op'].includes(kind)) {
      normalizeKey(op, 'node_id', 'id', kind, warnings);
      normalizeKey(op, 'nodeId', 'id', kind, warnings);
    }
    if (['add_connection', 'update_connection', 'delete_connection'].includes(kind)) {
      normalizeKey(op, 'connection_id', 'id', kind, warnings);
      normalizeKey(op, 'connectionId', 'id', kind, warnings);
    }
    if (kind === 'relayout_mindmap') {
      normalizeKey(op, 'group_id', 'id', kind, warnings);
      normalizeKey(op, 'groupId', 'id', kind, warnings);
    }
    if (['add_connection', 'update_connection'].includes(kind)) {
      normalizeKey(op, 'from_id', 'from', kind, warnings);
      normalizeKey(op, 'fromId', 'from', kind, warnings);
      normalizeKey(op, 'source', 'from', kind, warnings);
      normalizeKey(op, 'sourceId', 'from', kind, warnings);
      normalizeKey(op, 'to_id', 'to', kind, warnings);
      normalizeKey(op, 'toId', 'to', kind, warnings);
      normalizeKey(op, 'target', 'to', kind, warnings);
      normalizeKey(op, 'targetId', 'to', kind, warnings);
    }

    if (kind === 'add_node' && op.node && typeof op.node === 'object') {
      const node = op.node;
      normalizeKey(node, 'node_type', 'type', 'node', warnings);
      normalizeKey(node, 'nodeType', 'type', 'node', warnings);
      normalizeKey(node, 'code_type', 'codeType', 'node', warnings);
      normalizeKey(node, 'group_mode', 'groupMode', 'node', warnings);
      normalizeKey(node, 'target_canvas_id', 'targetCanvasId', 'node', warnings);
      normalizeKey(node, 'targetCanvasID', 'targetCanvasId', 'node', warnings);
      normalizeKey(node, 'parent_group_id', 'parentGroupId', 'node', warnings);
      normalizeKey(node, 'parentGroupID', 'parentGroupId', 'node', warnings);
      normalizeKey(node, 'children_ids', 'children', 'node', warnings);
      normalizeKey(node, 'childrenIds', 'children', 'node', warnings);
    } else if (['update_node', 'apply_style'].includes(kind) && op.patch && typeof op.patch === 'object') {
      const patch = op.patch;
      normalizeKey(patch, 'node_type', 'type', 'patch', warnings);
      normalizeKey(patch, 'nodeType', 'type', 'patch', warnings);
      normalizeKey(patch, 'code_type', 'codeType', 'patch', warnings);
      normalizeKey(patch, 'group_mode', 'groupMode', 'patch', warnings);
      normalizeKey(patch, 'target_canvas_id', 'targetCanvasId', 'patch', warnings);
      normalizeKey(patch, 'targetCanvasID', 'targetCanvasId', 'patch', warnings);
      normalizeKey(patch, 'parent_group_id', 'parentGroupId', 'patch', warnings);
      normalizeKey(patch, 'parentGroupID', 'parentGroupId', 'patch', warnings);
      normalizeKey(patch, 'children_ids', 'children', 'patch', warnings);
      normalizeKey(patch, 'childrenIds', 'children', 'patch', warnings);
      normalizeKey(patch, 'curve_anchor', 'curveAnchor', 'patch', warnings);
      normalizeKey(patch, 'anchor_params', 'anchorParams', 'patch', warnings);
      normalizeKey(patch, 'curve_mode', 'curveMode', 'patch', warnings);
    } else if (kind === 'update_canvas' && op.patch && typeof op.patch === 'object') {
      const patch = op.patch;
      normalizeKey(patch, 'background_color', 'backgroundColor', 'patch', warnings);
      normalizeKey(patch, 'background_style_id', 'backgroundStyleId', 'patch', warnings);
      normalizeKey(patch, 'pattern_color', 'patternColor', 'patch', warnings);
      normalizeKey(patch, 'corner_style', 'cornerStyle', 'patch', warnings);
      normalizeKey(patch, 'font_style', 'fontStyle', 'patch', warnings);
      normalizeKey(patch, 'text_opacity_preset', 'textOpacityPreset', 'patch', warnings);
      normalizeKey(patch, 'text_layout_preset', 'textLayoutPreset', 'patch', warnings);
      normalizeKey(patch, 'folder_id', 'folderId', 'patch', warnings);
    } else if (['add_connection', 'update_connection'].includes(kind)) {
      normalizeKey(op, 'from_point', 'fromPoint', kind, warnings);
      normalizeKey(op, 'to_point', 'toPoint', kind, warnings);
      normalizeKey(op, 'curve_anchor', 'curveAnchor', kind, warnings);
      normalizeKey(op, 'anchor_params', 'anchorParams', kind, warnings);
      normalizeKey(op, 'curve_mode', 'curveMode', kind, warnings);
      if (kind === 'update_connection' && op.patch && typeof op.patch === 'object') {
        const patch = op.patch;
        normalizeKey(patch, 'from_point', 'fromPoint', 'patch', warnings);
        normalizeKey(patch, 'to_point', 'toPoint', 'patch', warnings);
        normalizeKey(patch, 'from_id', 'from', 'patch', warnings);
        normalizeKey(patch, 'fromId', 'from', 'patch', warnings);
        normalizeKey(patch, 'source', 'from', 'patch', warnings);
        normalizeKey(patch, 'sourceId', 'from', 'patch', warnings);
        normalizeKey(patch, 'to_id', 'to', 'patch', warnings);
        normalizeKey(patch, 'toId', 'to', 'patch', warnings);
        normalizeKey(patch, 'target', 'to', 'patch', warnings);
        normalizeKey(patch, 'targetId', 'to', 'patch', warnings);
        normalizeKey(patch, 'curve_anchor', 'curveAnchor', 'patch', warnings);
        normalizeKey(patch, 'anchor_params', 'anchorParams', 'patch', warnings);
        normalizeKey(patch, 'curve_mode', 'curveMode', 'patch', warnings);
      }
    }
  });

  return { operations, warnings };
};
