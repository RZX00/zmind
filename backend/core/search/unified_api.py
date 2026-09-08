from __future__ import annotations

import base64
from datetime import datetime
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core.services.supabase import DBConnection
from core.utils.auth_utils import resolve_user_and_workspace
from core.utils.logger import logger

from .ai_suggestion_service import build_link_suggestions
from .indexer import rebuild_canvas_search_index, rebuild_workspace_search_index
from .ranker import compose_score, graph_affinity_score, now_ms, recency_score, token_overlap_score


router = APIRouter(prefix="/search", tags=["search"])


MAX_INDEX_SCAN = 600
MAX_CANVAS_RPC_LIMIT = 120


class UnifiedSearchRequest(BaseModel):
    query: str = Field(default="")
    limit: int = Field(default=20, ge=1, le=50)
    cursor: Optional[str] = None
    includeDebug: bool = False


class UnifiedSearchDebug(BaseModel):
    lexicalScore: float = 0.0
    recencyScore: float = 0.0
    graphScore: float = 0.0
    interactionScore: float = 0.0
    finalScore: float = 0.0


class UnifiedSearchResult(BaseModel):
    id: str
    resultType: Literal["doc", "canvas_node", "reference"]
    itemId: Optional[str] = None
    title: str
    snippet: str = ""
    canvasId: Optional[str] = None
    nodeId: Optional[str] = None
    targetType: Optional[str] = None
    targetItemId: Optional[str] = None
    targetCanvasId: Optional[str] = None
    targetAnchor: Optional[str] = None
    mode: Optional[str] = None
    updatedAt: int = 0
    score: float = 0.0
    debug: UnifiedSearchDebug = Field(default_factory=UnifiedSearchDebug)


class UnifiedSearchResponse(BaseModel):
    results: list[UnifiedSearchResult]
    facets: dict[str, int]
    nextCursor: Optional[str] = None
    debug: dict[str, float]


class SuggestLinksRequest(BaseModel):
    contextItemId: Optional[str] = None
    contextText: str = Field(default="")
    limit: int = Field(default=5, ge=1, le=20)


class LinkSuggestion(BaseModel):
    targetType: str
    targetItemId: str
    targetCanvasId: Optional[str] = None
    targetAnchor: Optional[str] = None
    confidence: float
    reason: str
    evidence: list[str] = Field(default_factory=list)


class SuggestLinksResponse(BaseModel):
    suggestions: list[LinkSuggestion]


class ReindexRequest(BaseModel):
    scope: Literal["workspace", "canvas"] = "workspace"
    canvasId: Optional[str] = None


class IndexStatusResponse(BaseModel):
    workspaceId: str
    canvasesTotal: int
    canvasesIndexed: int
    docsTotal: int
    referencesTotal: int
    pendingCanvases: int
    health: Literal["ready", "rebuilding"]


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


def _parse_ms(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    try:
        text = str(value)
        if text.endswith("Z"):
            text = text.replace("Z", "+00:00")
        return int(datetime.fromisoformat(text).timestamp() * 1000)
    except Exception:
        return 0


def _build_snippet(text: str, query: str, max_len: int = 160) -> str:
    content = (text or "").strip()
    if not content:
        return ""
    q = (query or "").strip()
    if not q:
        return content[:max_len]

    lower_content = content.lower()
    lower_q = q.lower()
    idx = lower_content.find(lower_q)
    if idx < 0:
        return content[:max_len]

    left = max(0, idx - 60)
    right = min(len(content), idx + len(q) + 60)
    snippet = content[left:right].strip()
    if left > 0:
        snippet = f"... {snippet}"
    if right < len(content):
        snippet = f"{snippet} ..."
    return snippet[:max_len]


def _chunked(items: list[str], size: int = 200):
    for idx in range(0, len(items), size):
        yield items[idx : idx + size]


async def _load_items(client, workspace_id: str) -> list[dict[str, Any]]:
    result = (
        await client.table("items")
        .select("id,type,title,source_id,updated_at,is_deleted")
        .eq("account_id", workspace_id)
        .eq("is_deleted", False)
        .limit(MAX_INDEX_SCAN)
        .execute()
    )
    return result.data or []


async def _load_doc_rows(client, doc_item_ids: list[str]) -> list[dict[str, Any]]:
    if not doc_item_ids:
        return []
    rows: list[dict[str, Any]] = []
    for chunk in _chunked(doc_item_ids):
        result = await client.table("docs").select("item_id,content_md,updated_at,version").in_("item_id", chunk).execute()
        rows.extend(result.data or [])
    return rows


async def _load_reference_rows(client, workspace_id: str) -> list[dict[str, Any]]:
    result = (
        await client.table("references")
        .select("id,source_item_id,target_item_id,source_anchor,target_anchor,target_type,mode,updated_at,is_deleted")
        .eq("account_id", workspace_id)
        .eq("is_deleted", False)
        .limit(MAX_INDEX_SCAN)
        .execute()
    )
    return result.data or []


def _graph_maps(reference_rows: list[dict[str, Any]]) -> tuple[dict[str, int], dict[str, int], int]:
    inbound: dict[str, int] = {}
    outbound: dict[str, int] = {}
    for row in reference_rows:
        source_item_id = row.get("source_item_id")
        target_item_id = row.get("target_item_id")
        if source_item_id:
            outbound[source_item_id] = outbound.get(source_item_id, 0) + 1
        if target_item_id:
            inbound[target_item_id] = inbound.get(target_item_id, 0) + 1
    max_degree = 0
    for item_id in set(inbound.keys()) | set(outbound.keys()):
        degree = int(inbound.get(item_id, 0)) + int(outbound.get(item_id, 0))
        if degree > max_degree:
            max_degree = degree
    return inbound, outbound, max_degree


async def _collect_unified_candidates(
    *,
    client,
    workspace_id: str,
    query: str,
    limit_hint: int,
) -> list[dict[str, Any]]:
    now_ts = now_ms()
    q = (query or "").strip()

    items = await _load_items(client, workspace_id)
    item_by_id = {row.get("id"): row for row in items if row.get("id")}
    doc_item_ids = [row.get("id") for row in items if row.get("type") == "doc" and row.get("id")]
    canvas_item_by_source = {
        row.get("source_id"): row
        for row in items
        if row.get("type") == "canvas" and row.get("source_id")
    }

    doc_rows = await _load_doc_rows(client, doc_item_ids)
    reference_rows = await _load_reference_rows(client, workspace_id)
    inbound, outbound, max_degree = _graph_maps(reference_rows)

    candidates: list[dict[str, Any]] = []

    # Docs candidates.
    for doc_row in doc_rows:
        item_id = doc_row.get("item_id")
        item = item_by_id.get(item_id) or {}
        title = str(item.get("title") or "Untitled Doc")
        content = str(doc_row.get("content_md") or "")
        search_text = f"{title}\n{content}"
        lexical = token_overlap_score(q, search_text) if q else 0.0
        if q and lexical <= 0:
            continue
        updated_at = _parse_ms(doc_row.get("updated_at") or item.get("updated_at"))
        recency = recency_score(updated_at, now_ts=now_ts)
        graph = graph_affinity_score(
            item_id,
            inbound_count_by_item=inbound,
            outbound_count_by_item=outbound,
            max_degree=max_degree,
        )
        final = compose_score(
            lexical_score=lexical,
            recency_score_value=recency,
            graph_affinity_score_value=graph,
            interaction_score=0.0,
        )
        candidates.append(
            {
                "id": f"doc:{item_id}",
                "resultType": "doc",
                "itemId": item_id,
                "title": title,
                "snippet": _build_snippet(content, q),
                "updatedAt": updated_at,
                "score": final,
                "debug": {
                    "lexicalScore": lexical,
                    "recencyScore": recency,
                    "graphScore": graph,
                    "interactionScore": 0.0,
                    "finalScore": final,
                },
            }
        )

    # Canvas node candidates.
    if q:
        try:
            rpc_limit = min(MAX_CANVAS_RPC_LIMIT, max(limit_hint * 4, 40))
            params = {
                "p_account_id": workspace_id,
                "p_query": q,
                "p_limit": rpc_limit,
                "p_offset": 0,
                "p_scope": "workspace",
                "p_canvas_ids": None,
                "p_node_types": None,
                "p_folder_ids": None,
                "p_include_archived": False,
            }
            canvas_search = await client.rpc("search_canvas_nodes", params).execute()
            canvas_rows = canvas_search.data or []
        except Exception as exc:
            logger.warning(f"[search] unified canvas query failed workspace={workspace_id}: {exc}")
            canvas_rows = []

        for row in canvas_rows:
            canvas_id = row.get("canvas_id")
            node_id = row.get("node_id")
            if not canvas_id or not node_id:
                continue
            canvas_item = canvas_item_by_source.get(canvas_id) or {}
            item_id = canvas_item.get("id")
            search_text = str(row.get("search_text") or row.get("preview_text") or "")
            lexical = token_overlap_score(q, search_text)
            recency = recency_score(_parse_ms(row.get("node_updated_at")), now_ts=now_ts)
            graph = graph_affinity_score(
                item_id,
                inbound_count_by_item=inbound,
                outbound_count_by_item=outbound,
                max_degree=max_degree,
            )
            final = compose_score(
                lexical_score=lexical,
                recency_score_value=recency,
                graph_affinity_score_value=graph,
                interaction_score=0.0,
            )
            candidates.append(
                {
                    "id": f"canvas_node:{canvas_id}:{node_id}",
                    "resultType": "canvas_node",
                    "itemId": item_id,
                    "title": str(row.get("title_text") or row.get("canvas_title") or "Canvas node"),
                    "snippet": str(row.get("preview_text") or ""),
                    "canvasId": str(canvas_id),
                    "nodeId": str(node_id),
                    "updatedAt": _parse_ms(row.get("node_updated_at")),
                    "score": final,
                    "debug": {
                        "lexicalScore": lexical,
                        "recencyScore": recency,
                        "graphScore": graph,
                        "interactionScore": 0.0,
                        "finalScore": final,
                    },
                }
            )

    # Reference candidates.
    for ref in reference_rows:
        source_item_id = ref.get("source_item_id")
        target_item_id = ref.get("target_item_id")
        source_title = str((item_by_id.get(source_item_id) or {}).get("title") or "Source")
        target_item = item_by_id.get(target_item_id) or {}
        target_title = str(target_item.get("title") or "Target")
        source_anchor = str(ref.get("source_anchor") or "")
        target_anchor = str(ref.get("target_anchor") or "")
        mode = str(ref.get("mode") or "reference")
        searchable = f"{source_title} {target_title} {source_anchor} {target_anchor} {mode}"
        lexical = token_overlap_score(q, searchable) if q else 0.0
        if q and lexical <= 0:
            continue

        updated_at = _parse_ms(ref.get("updated_at"))
        recency = recency_score(updated_at, now_ts=now_ts)
        graph = graph_affinity_score(
            target_item_id,
            inbound_count_by_item=inbound,
            outbound_count_by_item=outbound,
            max_degree=max_degree,
        )
        final = compose_score(
            lexical_score=lexical,
            recency_score_value=recency,
            graph_affinity_score_value=graph,
            interaction_score=0.0,
        )
        target_canvas_id = target_item.get("source_id") if target_item.get("type") == "canvas" else None

        candidates.append(
            {
                "id": str(ref.get("id")),
                "resultType": "reference",
                "itemId": target_item_id,
                "title": f"{source_title} -> {target_title}",
                "snippet": _build_snippet(f"{source_anchor} {target_anchor}".strip(), q),
                "targetType": ref.get("target_type"),
                "targetItemId": target_item_id,
                "targetCanvasId": target_canvas_id,
                "targetAnchor": target_anchor or None,
                "mode": mode,
                "updatedAt": updated_at,
                "score": final,
                "debug": {
                    "lexicalScore": lexical,
                    "recencyScore": recency,
                    "graphScore": graph,
                    "interactionScore": 0.0,
                    "finalScore": final,
                },
            }
        )

    candidates.sort(key=lambda row: (float(row.get("score", 0.0)), int(row.get("updatedAt", 0))), reverse=True)
    return candidates


@router.post("/unified", response_model=UnifiedSearchResponse)
async def unified_search(payload: UnifiedSearchRequest, request: Request):
    user_id, workspace_id = await resolve_user_and_workspace(request)
    _ = user_id

    db = DBConnection()
    client = await db.client

    try:
        candidates = await _collect_unified_candidates(
            client=client,
            workspace_id=workspace_id,
            query=payload.query,
            limit_hint=payload.limit,
        )
    except Exception as exc:
        logger.error(f"[search] unified search failed workspace={workspace_id}: {exc}")
        raise HTTPException(status_code=500, detail="Unified search failed")

    offset = _decode_cursor(payload.cursor)
    limit = min(max(payload.limit, 1), 50)
    page = candidates[offset : offset + limit]
    next_cursor = _encode_cursor(offset + limit) if offset + limit < len(candidates) else None

    facets = {"doc": 0, "canvas_node": 0, "reference": 0}
    for candidate in candidates:
        result_type = str(candidate.get("resultType"))
        facets[result_type] = facets.get(result_type, 0) + 1

    if page:
        lexical_avg = sum(float(row.get("debug", {}).get("lexicalScore", 0.0)) for row in page) / len(page)
        graph_avg = sum(float(row.get("debug", {}).get("graphScore", 0.0)) for row in page) / len(page)
        recency_avg = sum(float(row.get("debug", {}).get("recencyScore", 0.0)) for row in page) / len(page)
    else:
        lexical_avg = 0.0
        graph_avg = 0.0
        recency_avg = 0.0

    debug = {
        "lexicalScore": round(lexical_avg, 4),
        "graphScore": round(graph_avg, 4),
        "recencyScore": round(recency_avg, 4),
        "candidateCount": float(len(candidates)),
    }

    return UnifiedSearchResponse(results=[UnifiedSearchResult(**row) for row in page], facets=facets, nextCursor=next_cursor, debug=debug)


@router.post("/suggest-links", response_model=SuggestLinksResponse)
async def suggest_links(payload: SuggestLinksRequest, request: Request):
    user_id, workspace_id = await resolve_user_and_workspace(request)
    _ = user_id

    query = payload.contextText.strip()
    if not query:
        return SuggestLinksResponse(suggestions=[])

    db = DBConnection()
    client = await db.client

    try:
        candidates = await _collect_unified_candidates(
            client=client,
            workspace_id=workspace_id,
            query=query,
            limit_hint=max(payload.limit * 4, 20),
        )
    except Exception as exc:
        logger.error(f"[search] suggest-links failed workspace={workspace_id}: {exc}")
        raise HTTPException(status_code=500, detail="Suggest links failed")

    suggestions = build_link_suggestions(
        candidates=candidates,
        context_item_id=payload.contextItemId,
        limit=payload.limit,
    )
    return SuggestLinksResponse(suggestions=[LinkSuggestion(**row) for row in suggestions])


@router.post("/reindex")
async def reindex_workspace(payload: ReindexRequest, request: Request):
    user_id, workspace_id = await resolve_user_and_workspace(request)
    _ = user_id

    if payload.scope == "canvas":
        canvas_id = (payload.canvasId or "").strip()
        if not canvas_id:
            raise HTTPException(status_code=400, detail="canvasId is required when scope=canvas")
        await rebuild_canvas_search_index(canvas_id, workspace_id)
        return {"status": "ok", "scope": "canvas", "canvasId": canvas_id}

    await rebuild_workspace_search_index(workspace_id)
    return {"status": "ok", "scope": "workspace"}


@router.get("/index-status", response_model=IndexStatusResponse)
async def get_index_status(request: Request):
    user_id, workspace_id = await resolve_user_and_workspace(request)
    _ = user_id

    db = DBConnection()
    client = await db.client

    try:
        canvases_res = (
            await client.table("canvases")
            .select("id,search_indexed_at,is_deleted")
            .eq("account_id", workspace_id)
            .eq("is_deleted", False)
            .execute()
        )
        docs_res = (
            await client.table("items")
            .select("id")
            .eq("account_id", workspace_id)
            .eq("type", "doc")
            .eq("is_deleted", False)
            .execute()
        )
        refs_res = (
            await client.table("references")
            .select("id")
            .eq("account_id", workspace_id)
            .eq("is_deleted", False)
            .execute()
        )
    except Exception as exc:
        logger.error(f"[search] index-status failed workspace={workspace_id}: {exc}")
        raise HTTPException(status_code=500, detail="Failed to read index status")

    canvases = canvases_res.data or []
    canvases_total = len(canvases)
    canvases_indexed = sum(1 for row in canvases if row.get("search_indexed_at"))
    docs_total = len(docs_res.data or [])
    references_total = len(refs_res.data or [])
    pending = max(0, canvases_total - canvases_indexed)
    health = "ready" if pending == 0 else "rebuilding"

    return IndexStatusResponse(
        workspaceId=workspace_id,
        canvasesTotal=canvases_total,
        canvasesIndexed=canvases_indexed,
        docsTotal=docs_total,
        referencesTotal=references_total,
        pendingCanvases=pending,
        health=health,
    )
