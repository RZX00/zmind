from __future__ import annotations

from typing import Final


# Doc surface is intentionally strict: only doc-native tools and minimal
# messaging/control tools are exposed.
DOC_SURFACE_ALLOWED_TOOL_NAMES: Final[frozenset[str]] = frozenset(
    {
        "ask",
        "cta",
        "complete",
        "wait",
        "expand_message",
        "doc_read_context",
        "doc_list_blocks",
        "doc_apply_ops",
        "doc_generate_image_and_insert",
        "doc_undo_revision",
        "doc_get_revision",
        "doc_update_title",
    }
)


def is_doc_surface_tool_allowed(tool_name: str) -> bool:
    normalized = str(tool_name or "").strip()
    if not normalized:
        return False
    return normalized in DOC_SURFACE_ALLOWED_TOOL_NAMES
