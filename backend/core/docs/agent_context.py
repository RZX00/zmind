from __future__ import annotations

import json
from typing import Any, Optional, Tuple


MAX_DOC_TITLE_CHARS = 200
MAX_SELECTION_MARKDOWN_CHARS = 8_000
MAX_DOCUMENT_EXCERPT_CHARS = 12_000


def _parse_dict(value: Any) -> Optional[dict]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return None
        if isinstance(parsed, dict):
            return parsed
    return None


def _coalesce_str(payload: dict, keys: tuple[str, ...]) -> Optional[str]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str):
            text = value.strip()
            if text:
                return text
    return None


def _truncate_text(value: Optional[str], *, limit: int) -> tuple[Optional[str], bool]:
    if not value:
        return (None, False)
    text = value.strip()
    if not text:
        return (None, False)
    if len(text) <= limit:
        return (text, False)
    return (text[:limit], True)


def normalize_doc_context_payload(payload: Any) -> Tuple[Optional[dict], list[str]]:
    warnings: list[str] = []

    root = _parse_dict(payload)
    if not root:
        return (None, ["doc_context_invalid"])

    nested = _parse_dict(root.get("doc_context") or root.get("docContext"))
    if nested:
        root = nested

    marker = _coalesce_str(root, ("surface", "mode"))
    has_doc_shape = any(
        key in root
        for key in (
            "doc_item_id",
            "docItemId",
            "item_id",
            "itemId",
            "selection",
            "selection_markdown",
            "document",
            "document_excerpt",
        )
    )
    if not has_doc_shape and marker not in ("doc", "document", "selection", "document_selection"):
        return (None, ["doc_context_missing_shape"])

    doc_item_id = _coalesce_str(root, ("doc_item_id", "docItemId", "item_id", "itemId"))
    if not doc_item_id:
        return (None, ["doc_context_missing_doc_item_id"])
    if len(doc_item_id) > 128:
        doc_item_id = doc_item_id[:128]
        warnings.append("doc_context_doc_item_id_truncated")

    doc_title_raw = _coalesce_str(root, ("doc_title", "docTitle", "title", "name"))
    doc_title, title_truncated = _truncate_text(doc_title_raw, limit=MAX_DOC_TITLE_CHARS)
    if title_truncated:
        warnings.append("doc_context_doc_title_truncated")

    selection_root = _parse_dict(root.get("selection")) or {}
    selection_raw = _coalesce_str(
        selection_root,
        ("markdown", "text", "content"),
    ) or _coalesce_str(
        root,
        ("selection_markdown", "selectionMarkdown", "selected_markdown", "selectedMarkdown"),
    )
    selection_markdown, selection_truncated = _truncate_text(
        selection_raw,
        limit=MAX_SELECTION_MARKDOWN_CHARS,
    )
    if selection_truncated:
        warnings.append("doc_context_selection_truncated")

    document_root = _parse_dict(root.get("document")) or {}
    document_raw = _coalesce_str(
        document_root,
        ("excerpt", "markdown", "text", "content"),
    ) or _coalesce_str(
        root,
        ("document_excerpt", "documentExcerpt", "document_markdown", "documentMarkdown"),
    )
    document_excerpt, document_truncated = _truncate_text(
        document_raw,
        limit=MAX_DOCUMENT_EXCERPT_CHARS,
    )
    if document_truncated:
        warnings.append("doc_context_document_truncated")

    normalized: dict[str, Any] = {
        "surface": "doc",
        "doc_item_id": doc_item_id,
    }
    if doc_title:
        normalized["doc_title"] = doc_title

    if selection_markdown:
        normalized["selection"] = {
            "markdown": selection_markdown,
            "char_count": len(selection_markdown),
            "truncated": bool(selection_truncated),
        }

    if document_excerpt:
        normalized["document"] = {
            "excerpt": document_excerpt,
            "char_count": len(document_excerpt),
            "truncated": bool(document_truncated),
        }

    if selection_markdown:
        normalized["mode"] = "selection"
    elif document_excerpt:
        normalized["mode"] = "document"
    else:
        normalized["mode"] = "doc"
        warnings.append("doc_context_empty")

    return (normalized, warnings)
