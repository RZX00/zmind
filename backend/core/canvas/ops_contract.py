from __future__ import annotations

from typing import Final


ALLOWED_OPS: Final[tuple[str, ...]] = (
    "add_node",
    "update_node",
    "delete_node",
    "move_node",
    "apply_style",
    "add_connection",
    "update_connection",
    "delete_connection",
    "update_canvas",
    "relayout_mindmap",
    "update_table_cell",
    "table_row_op",
    "table_col_op",
    "set_collapsed",
    "group_nodes",
    "ungroup",
)

ALLOWED_OPS_SET: Final[frozenset[str]] = frozenset(ALLOWED_OPS)

OP_ALIASES: Final[dict[str, str]] = {
    "addnode": "add_node",
    "updatenode": "update_node",
    "deletenode": "delete_node",
    "movenode": "move_node",
    "applystyle": "apply_style",
    "addconnection": "add_connection",
    "updateconnection": "update_connection",
    "deleteconnection": "delete_connection",
    "updatecanvas": "update_canvas",
    "relayoutmindmap": "relayout_mindmap",
    "updatetablecell": "update_table_cell",
    "tablerowop": "table_row_op",
    "tablecolop": "table_col_op",
    "setcollapsed": "set_collapsed",
    "groupnodes": "group_nodes",
}

CANVAS_PATCH_KEYS: Final[tuple[str, ...]] = (
    "title",
    "cornerStyle",
    "fontStyle",
    "textOpacityPreset",
    "textLayoutPreset",
    "folderId",
    "backgroundColor",
    "backgroundStyleId",
    "patternColor",
    "metadata",
)

CANVAS_PATCH_KEYS_SET: Final[frozenset[str]] = frozenset(CANVAS_PATCH_KEYS)

