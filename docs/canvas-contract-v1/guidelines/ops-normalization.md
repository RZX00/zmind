# Canvas Ops Normalization (v1)

This document defines canonical field names and alias normalization rules for
canvas operation batches before validation and execution.

Why this exists:
- Keep Python tools and realtime apply behavior consistent.
- Reduce LLM write failures due to minor naming drift.

## General Rules
- Normalization only adds canonical keys when the alias is present.
- Original values are preserved; aliases are not removed at this stage.
- Unknown keys are ignored by downstream validators.

## Operation Name (op)
Aliases accepted for the operation field:
- `type`, `operation`, `action` -> `op` (when `op` is missing)

Value normalization:
- Accepts `camelCase`/`kebab-case`/`spaced` variants, e.g. `addNode`, `add-node`, `Add Node` -> `add_node`.

## Operation ID Aliases
- Node ops (`update_node/delete_node/move_node/apply_style`):
  - `node_id`, `nodeId` -> `id`
- Connection ops (`add_connection/update_connection/delete_connection`):
  - `connection_id`, `connectionId` -> `id`
- Mindmap relayout:
  - `group_id`, `groupId` -> `id`

## Node (add_node.node)
Aliases mapped to canonical keys:
- node_type -> type
- nodeType -> type
- code_type -> codeType
- group_mode -> groupMode
- target_canvas_id -> targetCanvasId
- targetCanvasID -> targetCanvasId
- parent_group_id -> parentGroupId
- parentGroupID -> parentGroupId
- children_ids -> children
- childrenIds -> children

## Patch (update_node.patch / apply_style.patch)
Aliases mapped to canonical keys:
- node_type -> type
- nodeType -> type
- code_type -> codeType
- group_mode -> groupMode
- target_canvas_id -> targetCanvasId
- targetCanvasID -> targetCanvasId
- parent_group_id -> parentGroupId
- parentGroupID -> parentGroupId
- children_ids -> children
- childrenIds -> children
- curve_anchor -> curveAnchor
- anchor_params -> anchorParams
- curve_mode -> curveMode

## Canvas Patch (update_canvas.patch)
Aliases mapped to canonical keys:
- background_color -> backgroundColor
- background_style_id -> backgroundStyleId
- pattern_color -> patternColor
- corner_style -> cornerStyle
- font_style -> fontStyle
- text_opacity_preset -> textOpacityPreset
- text_layout_preset -> textLayoutPreset
- folder_id -> folderId

## Connection (add_connection / update_connection)
Aliases mapped to canonical keys:
- from_point -> fromPoint
- to_point -> toPoint
- curve_anchor -> curveAnchor
- anchor_params -> anchorParams
- curve_mode -> curveMode
- from_id / fromId / source / sourceId -> from
- to_id / toId / target / targetId -> to

## Connection Patch (update_connection.patch)
Aliases mapped to canonical keys:
- from_point -> fromPoint
- to_point -> toPoint
- curve_anchor -> curveAnchor
- anchor_params -> anchorParams
- curve_mode -> curveMode
- from_id / fromId / source / sourceId -> from
- to_id / toId / target / targetId -> to

## Apply-Time Safe Defaults
These are applied during op execution to avoid brittle failures:
- Missing `content` defaults to an empty string.
- `group`/`column` nodes: if `content` missing but `title` provided, `content` is derived from `title`.
- `canvas-link` nodes: if `title` missing, derive from `content` first line (or fallback to `Canvas Link`).
- `media` nodes: missing metadata fields are filled with safe defaults (e.g., `fileType`, `fileSize`, `mediaType`, `uploadStatus`).
