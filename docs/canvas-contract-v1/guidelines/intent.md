# Canvas Intent (v1)

Canvas Intent is a high-level payload that describes *what* should appear on
the canvas, letting the backend compiler decide *how* to translate it into
low-level ops. This reduces LLM failures caused by missing fields, IDs, and
layout math.

## Top-Level Shape
- nodes[]: core content blocks
- connections[]: relationships between nodes
- groups[]: semantic grouping
- layout: optional global layout hints

## Nodes
Each node can include:
- id (optional, otherwise compiler assigns tmp ids)
- type (text|todo|code|table|media|column|group|canvas-link)
- content (for text/todo/code)
- title (for canvas-link)
- code_type (mermaid|html|svg)
- x, y, width, height (optional; compiler fills when missing)
- data (table payload or custom data)
- metadata (custom extensions)
- side/column (left|right) when layout.mode=two_column

## Connections
Each connection can include:
- from / to (node ids) OR from_index / to_index (node order)
- label, style, dashed, curveAnchor, anchorParams, curveMode, tension
- fromPoint / toPoint for free lines (optional)

## Groups
Each group can include:
- title (group label shown in content first line)
- node_ids or node_indices (members)

## Layout
Supported modes:
- stack (default): vertical list with row_spacing
- two_column: left/right columns with row_spacing

Layout fields:
- mode: "stack" | "two_column"
- x, y, row_spacing (stack)
- left_x, right_x, y, row_spacing (two_column)
