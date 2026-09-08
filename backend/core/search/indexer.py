from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

import orjson

from core.services.supabase import DBConnection
from core.utils.logger import logger


MAX_SEARCH_TEXT_LEN = 10000
PREVIEW_LEN = 120
INSERT_BATCH_SIZE = 500


async def _mark_canvas_indexed(client, canvas_id: str, account_id: str) -> None:
    try:
        await client.table("canvases").update(
            {"search_indexed_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", canvas_id).eq("account_id", account_id).execute()
    except Exception as e:
        logger.warning(f"[search] failed to update search_indexed_at for {canvas_id}: {e}")


def _collapse_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text or "")


def _first_line(text: str) -> str:
    if not text:
        return ""
    return (text.splitlines()[0] or "").strip()


def _flatten_table_rows(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    rows = data.get("rows")
    if not isinstance(rows, list):
        return ""
    parts: List[str] = []
    for row in rows:
        if not isinstance(row, list):
            continue
        for cell in row:
            if cell is None:
                continue
            cell_text = str(cell).strip()
            if cell_text:
                parts.append(cell_text)
    return " ".join(parts)


def _table_preview(data: Any, max_rows: int = 2, max_cells: int = 4) -> str:
    if not isinstance(data, dict):
        return ""
    rows = data.get("rows")
    if not isinstance(rows, list):
        return ""
    parts: List[str] = []
    for row in rows[:max_rows]:
        if not isinstance(row, list):
            continue
        cells = [str(c).strip() for c in row[:max_cells] if c is not None and str(c).strip()]
        if cells:
            parts.append(" | ".join(cells))
    return " / ".join(parts)


def _ms_to_iso(ms: Any) -> Optional[str]:
    try:
        if ms is None:
            return None
        ms_val = int(ms)
        if ms_val <= 0:
            return None
        return datetime.fromtimestamp(ms_val / 1000, tz=timezone.utc).isoformat()
    except Exception:
        return None


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _build_node_text(node: Dict[str, Any]) -> Dict[str, str]:
    node_type = node.get("type") or ""
    content = _safe_text(node.get("content"))
    title = _safe_text(node.get("title"))
    file_name = _safe_text(node.get("fileName"))
    external_url = _safe_text(node.get("externalUrl"))
    table_text = _flatten_table_rows(node.get("data"))
    table_preview = _table_preview(node.get("data"))

    if node_type == "canvas-link" and title:
        title_text = title
    else:
        title_text = _first_line(content)

    raw_parts = []
    if title_text:
        raw_parts.append(title_text)
    if content:
        raw_parts.append(content)
    if table_text:
        raw_parts.append(table_text)
    if file_name:
        raw_parts.append(file_name)
    if external_url:
        raw_parts.append(external_url)

    raw_text = _collapse_ws(" ".join(raw_parts))
    raw_text = _strip_html(raw_text)
    search_text = raw_text[:MAX_SEARCH_TEXT_LEN]

    if node_type == "table":
        preview = table_preview or _collapse_ws(content)
    else:
        preview = _collapse_ws(content) or title_text or ""

    preview = preview[:PREVIEW_LEN]

    return {
        "title_text": title_text,
        "search_text": search_text,
        "preview_text": preview,
    }


def _chunked(items: List[dict], size: int) -> Iterable[List[dict]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


async def rebuild_canvas_search_index(
    canvas_id: str,
    account_id: str,
    *,
    doc: Optional[Dict[str, Any]] = None,
    client=None,
) -> None:
    db = DBConnection()
    client = client or await db.client

    if not doc:
        try:
            res = await client.table("canvases").select("id,title,doc").eq("id", canvas_id).eq("account_id", account_id).limit(1).execute()
            if not res.data:
                return
            row = res.data[0]
            doc = row.get("doc") or {}
            if isinstance(doc, str):
                doc = orjson.loads(doc)
            if isinstance(doc, dict):
                doc.setdefault("id", row.get("id"))
                doc.setdefault("title", row.get("title"))
        except Exception as e:
            logger.warning(f"[search] failed to fetch canvas doc {canvas_id}: {e}")
            return

    if not isinstance(doc, dict):
        return

    canvas_title = _safe_text(doc.get("title"))
    folder_id = _safe_text(doc.get("folderId")) or None
    nodes = doc.get("nodes") or []
    if not isinstance(nodes, list):
        nodes = []

    rows: List[Dict[str, Any]] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = _safe_text(node.get("id"))
        node_type = _safe_text(node.get("type"))
        if not node_id or not node_type:
            continue
        text_parts = _build_node_text(node)
        search_text = text_parts.get("search_text", "").strip()
        if not search_text:
            continue
        title_text = text_parts.get("title_text") or None
        preview_text = text_parts.get("preview_text") or None
        node_subtype = node.get("codeType") or node.get("mediaType") or None
        node_updated_at = _ms_to_iso(node.get("updatedAt") or node.get("updated_at"))
        source_hash = hashlib.sha256(
            f"{node_id}:{search_text}:{node.get('x')}:{node.get('y')}:{node.get('width')}:{node.get('height')}:{node_updated_at}".encode("utf-8")
        ).hexdigest()

        rows.append({
            "account_id": account_id,
            "canvas_id": canvas_id,
            "node_id": node_id,
            "node_type": node_type,
            "node_subtype": node_subtype,
            "title_text": title_text,
            "search_text": search_text,
            "preview_text": preview_text,
            "folder_id": folder_id,
            "canvas_title": canvas_title or None,
            "node_x": node.get("x"),
            "node_y": node.get("y"),
            "node_width": node.get("width"),
            "node_height": node.get("height"),
            "node_updated_at": node_updated_at,
            "source_hash": source_hash,
            "is_active": True,
            "indexed_at": datetime.now(timezone.utc).isoformat(),
        })

    try:
        await client.table("canvas_node_search").delete().eq("canvas_id", canvas_id).eq("account_id", account_id).execute()
        if not rows:
            await _mark_canvas_indexed(client, canvas_id, account_id)
            return
        for batch in _chunked(rows, INSERT_BATCH_SIZE):
            await client.table("canvas_node_search").insert(batch).execute()
        await _mark_canvas_indexed(client, canvas_id, account_id)
    except Exception as e:
        logger.warning(f"[search] failed to rebuild index for {canvas_id}: {e}")


async def delete_canvas_search_index(
    canvas_id: str,
    account_id: str,
    *,
    client=None,
) -> None:
    db = DBConnection()
    client = client or await db.client
    try:
        await client.table("canvas_node_search").delete().eq("canvas_id", canvas_id).eq("account_id", account_id).execute()
    except Exception as e:
        logger.warning(f"[search] failed to delete index for {canvas_id}: {e}")


async def rebuild_workspace_search_index(account_id: str) -> None:
    db = DBConnection()
    client = await db.client
    try:
        res = await client.table("canvases").select("id,title,doc,is_deleted").eq("account_id", account_id).execute()
    except Exception as e:
        logger.warning(f"[search] failed to list canvases for workspace {account_id}: {e}")
        return
    for row in (res.data or []):
        if row.get("is_deleted"):
            continue
        doc = row.get("doc") or {}
        if isinstance(doc, str):
            try:
                doc = orjson.loads(doc)
            except Exception:
                doc = {}
        if isinstance(doc, dict):
            doc.setdefault("id", row.get("id"))
            doc.setdefault("title", row.get("title"))
        await rebuild_canvas_search_index(str(row.get("id")), account_id, doc=doc, client=client)
