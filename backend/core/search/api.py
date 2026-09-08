from __future__ import annotations

import base64
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core.services.supabase import DBConnection
from core.search.maintenance import maybe_schedule_search_index_backfill
from core.utils.auth_utils import resolve_user_and_workspace
from core.utils.logger import logger


router = APIRouter(prefix="/search", tags=["search"])


class SearchRequest(BaseModel):
    query: str = Field(default="")
    limit: int = Field(default=20, ge=1, le=50)
    cursor: Optional[str] = None
    scope: str = Field(default="workspace")
    node_types: Optional[List[str]] = None
    canvas_ids: Optional[List[str]] = None
    folder_ids: Optional[List[str]] = None
    include_archived: bool = False


def _decode_cursor(cursor: Optional[str]) -> int:
    if not cursor:
        return 0
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("utf-8")).decode("utf-8")
        return max(0, int(raw))
    except Exception:
        return 0


def _encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(str(max(0, int(offset))).encode("utf-8")).decode("utf-8")


def _build_snippet(text: str, query: str, max_len: int = 120, context: int = 40, max_fragments: int = 2) -> tuple[str, List[Dict[str, int]]]:
    clean_text = (text or "").strip()
    if not clean_text:
        return "", []
    q = (query or "").strip()
    if not q:
        snippet = clean_text[:max_len]
        return snippet, []

    lower_text = clean_text.lower()
    lower_q = q.lower()
    matches: List[tuple[int, int]] = []
    start = 0
    while True:
        idx = lower_text.find(lower_q, start)
        if idx == -1:
            break
        matches.append((idx, idx + len(q)))
        start = idx + len(q)
        if len(matches) >= 6:
            break

    if not matches:
        snippet = clean_text[:max_len]
        return snippet, []

    windows: List[tuple[int, int]] = []
    for match in matches:
        win_start = max(0, match[0] - context)
        win_end = min(len(clean_text), match[1] + context)
        if windows and win_start <= windows[-1][1] + 10:
            windows[-1] = (windows[-1][0], max(windows[-1][1], win_end))
        else:
            windows.append((win_start, win_end))
        if len(windows) >= max_fragments:
            break

    snippet_parts: List[str] = []
    ranges: List[Dict[str, int]] = []
    cursor = 0
    for idx, (win_start, win_end) in enumerate(windows):
        if idx > 0:
            snippet_parts.append(" … ")
            cursor += 3
        fragment = clean_text[win_start:win_end].strip()
        fragment_start = cursor
        snippet_parts.append(fragment)
        for match in matches:
            if match[0] >= win_start and match[1] <= win_end:
                ranges.append({
                    "start": fragment_start + (match[0] - win_start),
                    "end": fragment_start + (match[1] - win_start),
                })
        cursor += len(fragment)

    snippet = "".join(snippet_parts)
    if len(snippet) > max_len:
        snippet = snippet[:max_len].rstrip()
        ranges = [r for r in ranges if r["end"] <= len(snippet)]
    return snippet, ranges


@router.post("/nodes")
async def search_nodes(payload: SearchRequest, request: Request):
    user_id, workspace_id = await resolve_user_and_workspace(request)

    query = (payload.query or "").strip()

    scope = payload.scope or "workspace"
    if scope not in ("workspace", "canvas"):
        raise HTTPException(status_code=400, detail="Invalid scope")

    canvas_ids = payload.canvas_ids or None
    if scope == "canvas" and not canvas_ids:
        raise HTTPException(status_code=400, detail="canvas_ids required for canvas scope")

    offset = _decode_cursor(payload.cursor)
    limit = min(max(payload.limit or 20, 1), 50)

    db = DBConnection()
    client = await db.client

    start_time = time.monotonic()
    try:
        params = {
            "p_account_id": workspace_id,
            "p_query": query,
            "p_limit": limit + 1,
            "p_offset": offset,
            "p_scope": scope,
            "p_canvas_ids": canvas_ids,
            "p_node_types": payload.node_types or None,
            "p_folder_ids": payload.folder_ids or None,
            "p_include_archived": bool(payload.include_archived),
        }
        result = await client.rpc("search_canvas_nodes", params).execute()
        rows = result.data or []
    except Exception as e:
        logger.error(f"[search] query failed user={user_id}: {e}")
        raise HTTPException(status_code=500, detail="Search failed")

    has_more = len(rows) > limit
    rows = rows[:limit]

    results: List[Dict[str, Any]] = []
    for row in rows:
        search_text = row.get("search_text") or row.get("preview_text") or ""
        snippet, ranges = _build_snippet(search_text, query)
        results.append({
            "canvas_id": row.get("canvas_id"),
            "canvas_title": row.get("canvas_title"),
            "folder_id": row.get("folder_id"),
            "node_id": row.get("node_id"),
            "node_type": row.get("node_type"),
            "node_subtype": row.get("node_subtype"),
            "title_text": row.get("title_text"),
            "preview_text": snippet or row.get("preview_text"),
            "highlight_ranges": ranges,
            "node_x": row.get("node_x"),
            "node_y": row.get("node_y"),
            "node_width": row.get("node_width"),
            "node_height": row.get("node_height"),
            "node_updated_at": row.get("node_updated_at"),
        })

    next_cursor = _encode_cursor(offset + limit) if has_more else None
    took_ms = int((time.monotonic() - start_time) * 1000)

    await maybe_schedule_search_index_backfill(workspace_id)

    return {
        "results": results,
        "next_cursor": next_cursor,
        "took_ms": took_ms,
    }
