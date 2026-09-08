"""
Canvas as Code - 工具实现

标准工具：
- workspace_list_canvases → 枚举工作区画布
- canvas_read             → 读取画布内容
- canvas_write            → 创建新内容
- canvas_edit             → 修改/删除现有内容
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from dataclasses import dataclass

from core.tools.base import Tool, ToolResult, openapi_schema, usage_example
from core.services.supabase import DBConnection
from core.canvas.write_service import CanvasWriteService
from core.canvas.id_utils import generate_canvas_entity_id
from core.canvas.agent_context import (
    evaluate_cross_canvas_write_guard,
    normalize_selection_context_payload,
)
from core.utils.logger import logger
from core.utils.config import config

from .engine import CaCEngine
from .types import (
    CanvasReadPayload,
    CanvasReadResult,
    CanvasWritePayload,
    CanvasWriteResult,
    CanvasEditPayload,
    CanvasEditResult,
    NodeInput,
    ConnectionInput,
)


# Read projection (the AI's "eyes") lives in a dependency-light module so it is
# unit-testable in isolation and reusable by any read path (CaC tools now, HTTP read later).
from core.canvas.read_projection import (
    FULL_NODE_CAP,
    budget_read_result,
    children_subtree,
    count_free_edges,
    find_connections,
    find_nodes,
    nodes_in_viewport,
    outline_canvas_connections,
    outline_canvas_nodes,
    outline_containers,
    scope_edges,
    simplify_canvas_connections,
    simplify_canvas_nodes,
)
from core.canvas.errors import normalize_canvas_error, canvas_error_suffix

# NOTE (schema authority): the @openapi_schema decorators below are NOT the schema the
# agent sees. The tool registry builds the advertised schema from each tool's args_model
# (CaCReadArgs / CaCWriteArgs / CaCEditArgs in
# core/langgraph_engine/tools/adapters/native_tool_adapter.py) and validates calls against
# it. Those args models are AUTHORITATIVE — edit them for any agent-facing schema/doc
# change. The blocks here are retained as in-code reference only; do not rely on them
# reaching the model (DEAD-OPENAPI).


async def _get_latest_user_metadata(db: DBConnection, thread_id: str) -> Dict[str, Any]:
    try:
        client = await db.client
        rows = (
            await client.table("messages")
            .select("type, metadata, created_at")
            .eq("thread_id", thread_id)
            .eq("type", "user")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if rows and rows.data:
            md = rows.data[0].get("metadata") or {}
            if isinstance(md, str):
                try:
                    md = json.loads(md)
                except Exception:
                    md = {}
            if isinstance(md, dict):
                return md
    except Exception:
        return {}
    return {}


def _parse_tool_output_dict(output: Any) -> Dict[str, Any]:
    if isinstance(output, dict):
        return output
    if isinstance(output, str):
        try:
            parsed = json.loads(output)
        except Exception:
            return {}
        if isinstance(parsed, dict):
            return parsed
    return {}


# ============================================================
# workspace_list_canvases
# ============================================================

@dataclass
class WorkspaceListCanvasesTool(Tool):
    """workspace_list_canvases - 列出当前工作区画布"""

    thread_id: str
    db_connection: Optional[DBConnection] = None
    thread_manager: object | None = None

    def __post_init__(self) -> None:
        super().__init__()
        self.db = self.db_connection or DBConnection()

    async def _get_account_id(self) -> Optional[str]:
        try:
            client = await self.db.client
            res = await client.table("threads").select("account_id").eq("thread_id", self.thread_id).limit(1).execute()
            if res.data:
                return res.data[0].get("account_id")
        except Exception as e:
            logger.error(f"workspace_list_canvases: failed to get account_id: {e}")
        return None

    async def _fetch_canvases(
        self,
        account_id: str,
        *,
        query: Optional[str],
        limit: int,
        offset: int,
        include_deleted: bool,
    ) -> List[Dict[str, Any]]:
        client = await self.db.client
        q = client.table("canvases").select("id,title,version,created_at,updated_at,is_deleted").eq("account_id", account_id)
        if not include_deleted:
            q = q.eq("is_deleted", False)
        if query and query.strip():
            q = q.ilike("title", f"%{query.strip()}%")
        end = offset + max(limit, 1) - 1
        res = await q.order("updated_at", desc=True).range(offset, end).execute()
        rows = res.data or []
        canvases: List[Dict[str, Any]] = []
        for row in rows:
            canvases.append(
                {
                    "id": row.get("id"),
                    "title": row.get("title"),
                    "version": row.get("version"),
                    "createdAt": row.get("created_at"),
                    "updatedAt": row.get("updated_at"),
                    "isDeleted": bool(row.get("is_deleted")),
                }
            )
        return canvases

    @openapi_schema(
        {
            "type": "function",
            "function": {
                "name": "workspace_list_canvases",
                "description": "List canvases in the current workspace (across folders).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Optional title keyword filter.",
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum canvases to return (1-200, default 50).",
                        },
                        "offset": {
                            "type": "integer",
                            "description": "Pagination offset (default 0).",
                        },
                        "include_deleted": {
                            "type": "boolean",
                            "description": "Whether to include soft-deleted canvases (default false).",
                        },
                    },
                },
            },
        }
    )
    @usage_example(
        '''
    {
      "tool_calls": [
        {
          "type": "function",
          "function": {
            "name": "workspace_list_canvases",
            "arguments": { "query": "roadmap", "limit": 20 }
          }
        }
      ]
    }
    '''
    )
    async def workspace_list_canvases(
        self,
        query: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        include_deleted: bool = False,
    ) -> ToolResult:
        try:
            account_id = await self._get_account_id()
            if not account_id:
                return self.fail_response("Unable to determine workspace for this thread")
            safe_limit = min(max(int(limit or 50), 1), 200)
            safe_offset = max(int(offset or 0), 0)
            canvases = await self._fetch_canvases(
                account_id,
                query=query,
                limit=safe_limit,
                offset=safe_offset,
                include_deleted=bool(include_deleted),
            )
            return self.success_response(
                {
                    "canvases": canvases,
                    "count": len(canvases),
                    "limit": safe_limit,
                    "offset": safe_offset,
                }
            )
        except Exception as e:
            logger.exception("workspace_list_canvases failed")
            return self.fail_response(f"Failed to list canvases: {e}")


# ============================================================
# canvas_read
# ============================================================

@dataclass
class CanvasReadTool(Tool):
    """canvas_read - 读取画布内容"""

    thread_id: str
    canvas_id: Optional[str] = None
    db_connection: Optional[DBConnection] = None
    thread_manager: object | None = None

    def __post_init__(self) -> None:
        super().__init__()
        self.db = self.db_connection or DBConnection()
        self._write_service = CanvasWriteService()

    async def _get_account_id(self) -> Optional[str]:
        try:
            client = await self.db.client
            res = await client.table("threads").select("account_id").eq("thread_id", self.thread_id).limit(1).execute()
            if res.data:
                return res.data[0].get("account_id")
        except Exception as e:
            logger.error(f"canvas_read: failed to get account_id: {e}")
        return None

    async def _get_canvas_id(self) -> Optional[str]:
        if self.canvas_id:
            return self.canvas_id
        try:
            client = await self.db.client
            res = await client.table("threads").select("canvas_id, metadata").eq("thread_id", self.thread_id).limit(1).execute()
            if res.data:
                row = res.data[0]
                cid = row.get("canvas_id")
                if cid:
                    return cid
                meta = row.get("metadata") or {}
                if isinstance(meta, str):
                    try:
                        meta = json.loads(meta)
                    except Exception:
                        meta = {}
                if isinstance(meta, dict):
                    return meta.get("canvas_id") or meta.get("canvasId")
        except Exception as e:
            logger.error(f"canvas_read: failed to get canvas_id: {e}")
        return None

    async def _get_selection_context(self) -> Optional[Dict[str, Any]]:
        """获取选中内容上下文"""
        try:
            client = await self.db.client
            rows = await client.table("messages").select("type, metadata, created_at") \
                .eq("thread_id", self.thread_id).eq("type", "user") \
                .order("created_at", desc=True).limit(1).execute()
            if rows and rows.data:
                md = rows.data[0].get("metadata") or {}
                if isinstance(md, str):
                    try:
                        md = json.loads(md)
                    except Exception:
                        md = {}
                return md.get("selection_context")
        except Exception as e:
            logger.debug(f"canvas_read: selection_context lookup failed: {e}")
        return None

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "canvas_read",
            "description": "Read canvas content. Returns the current canvas state including nodes and connections.",
            "parameters": {
                "type": "object",
                "properties": {
                    "scope": {
                        "type": "string",
                        "enum": ["all", "selection", "viewport"],
                        "description": "What to read: 'all' (default), 'selection' (only selected nodes), 'viewport' (nodes intersecting the visible rect — requires a camera; see the camera param)"
                    },
                    "canvas_id": {
                        "type": "string",
                        "description": "Optional target canvas id. Defaults to the canvas bound to this thread."
                    },
                    "where": {
                        "type": "object",
                        "description": "Filter conditions. E.g. { \"type\": \"text\", \"content\": { \"$contains\": \"keyword\" } }"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of nodes to return"
                    },
                    "full": {
                        "type": "boolean",
                        "description": "DEPRECATED — use detail='full'. Kept as an alias."
                    },
                    "detail": {
                        "type": "string",
                        "enum": ["outline", "structure", "full"],
                        "description": "Read depth: 'outline' (ids + labels + topology, for orienting on large canvases), 'structure' (default: topology + geometry + budgeted content), 'full' (raw node objects; capped unless narrowed by where/limit/scope)."
                    },
                    "children_of": {
                        "type": "string",
                        "description": "Limit the read to the subtree of this container node id (group/column): its ordered children plus any node whose parentGroupId points at it, recursively."
                    },
                    "camera": {
                        "type": "object",
                        "description": "Viewport camera {x,y,zoom,vw,vh} (canvas coords of the top-left + screen size + scale). With scope='viewport', the read is filtered to nodes whose box intersects the visible rect. Normally supplied by the frontend, not the model."
                    }
                }
            }
        }
    })
    @usage_example('''
    {
      "tool_calls": [
        { "type": "function", "function": { "name": "canvas_read", "arguments": {} } },
        { "type": "function", "function": { "name": "canvas_read", "arguments": { "scope": "selection" } } },
        { "type": "function", "function": { "name": "canvas_read", "arguments": { "where": { "type": "text" } } } }
      ]
    }
    ''')
    async def read(
        self,
        scope: Optional[str] = None,
        canvas_id: Optional[str] = None,
        where: Optional[Dict[str, Any]] = None,
        limit: Optional[int] = None,
        full: Optional[bool] = None,
        detail: Optional[str] = None,
        children_of: Optional[str] = None,
        camera: Optional[Dict[str, Any]] = None,
    ) -> ToolResult:
        try:
            account_id = await self._get_account_id()
            target_canvas_id = canvas_id or await self._get_canvas_id()

            if not account_id or not target_canvas_id:
                return self.fail_response("No canvas bound to this thread; provide canvas_id explicitly for cross-canvas access")

            # 获取画布数据
            canvas_doc = await self._fetch_canvas(account_id, target_canvas_id)
            if not canvas_doc:
                return self.fail_response("Canvas not found")

            # 获取选中内容
            raw_selection_ctx = await self._get_selection_context()
            selection_ctx, selection_warnings = normalize_selection_context_payload(
                raw_selection_ctx,
                target_canvas_id=target_canvas_id,
            )
            selection_ids: List[str] = []
            if selection_ctx:
                for n in selection_ctx.get("nodes", []):
                    if isinstance(n, dict) and n.get("id"):
                        selection_ids.append(str(n["id"]))
                    elif isinstance(n, str) and n:
                        selection_ids.append(n)
            # De-dup while preserving order (deterministic for the model).
            selection_ids = list(dict.fromkeys(selection_ids))

            # 过滤节点
            nodes = canvas_doc.get("nodes", [])
            connections = canvas_doc.get("connections", [])

            # scope 过滤
            meta: Dict[str, Any] = {}
            if selection_warnings:
                meta["selectionWarnings"] = selection_warnings
            if scope == "selection" and selection_ctx:
                selection_meta = selection_ctx.get("meta") if isinstance(selection_ctx, dict) else {}
                selection_canvas_id = selection_meta.get("canvas_id") if isinstance(selection_meta, dict) else None
                if selection_canvas_id and str(selection_canvas_id) != str(target_canvas_id):
                    selection_ids = []
                    meta["warning"] = (
                        "scope='selection' context points to a different canvas. "
                        "Selection was ignored for safety."
                    )
            if scope == "selection":
                if selection_ids:
                    selected_ids = set(selection_ids)
                    nodes = [n for n in nodes if n.get("id") in selected_ids]
                    # 过滤连接 — keep cross-boundary edges (REL-7); an explicit node selection
                    # does NOT pull in unrelated free-floating edges (include_free=False).
                    node_ids = set(n.get("id") for n in nodes)
                    connections, _boundary = scope_edges(connections, node_ids, include_free=False)
                    if _boundary:
                        meta["boundaryEdges"] = _boundary
                else:
                    # Safety: never fall back to full-canvas when the caller explicitly requests selection.
                    nodes = []
                    connections = []
                    meta["warning"] = "scope='selection' requested, but no selection_context was found"
            elif scope == "viewport":
                # Camera comes from the frontend (param override, else the selection-context channel).
                cam = camera if isinstance(camera, dict) else (
                    selection_ctx.get("camera") if isinstance(selection_ctx, dict) else None
                )
                if isinstance(cam, dict):
                    nodes = nodes_in_viewport(nodes, cam)
                else:
                    # No camera available: do NOT silently grab a fixed slice — say so and read
                    # the full canvas (budgeted). Provide camera {x,y,zoom,vw,vh} or use where/limit.
                    meta["warning"] = (
                        "scope='viewport' requested but no camera was provided; viewport filtering "
                        "was skipped. Provide camera {x,y,zoom,vw,vh} or use where/limit."
                    )

            # children_of：限定到某容器（组/收集栏）的子树（双向：children[] + parentGroupId），递归。
            if children_of:
                nodes = children_subtree(nodes, children_of, recursive=True)

            # where / find 过滤（find_nodes/match_predicate 是 flat where 的向后兼容超集，支持 parentId 等谓词）。
            # 边形谓词(rel/relation/directed/from/to)路由到 find_connections —— find(rel=…) 返回边(E3)，
            # 此时节点保持为上下文不被该谓词清空。
            if where:
                _edge_pred_keys = {"rel", "relation", "directed", "from", "to"}
                if any(k in _edge_pred_keys for k in where):
                    connections = find_connections(connections, where)
                else:
                    nodes = find_nodes(nodes, where)

            # limit
            if limit and limit > 0:
                nodes = nodes[:limit]

            # For the viewport fallback, return only connections that relate to returned nodes,
            # plus free connections (fromPoint/toPoint) which don't depend on node endpoints.
            if scope == "viewport":
                node_ids = set(n.get("id") for n in nodes if isinstance(n, dict) and n.get("id"))
                connections, _boundary = scope_edges(connections, node_ids)
                if _boundary:
                    meta["boundaryEdges"] = _boundary

            # 详情级别：outline（最轻，定位用）| structure（默认：拓扑+几何+预算化内容）| full（原始，必须限量）
            level = (detail or ("full" if full else "structure")).strip().lower()
            if level not in ("outline", "structure", "full"):
                level = "structure"

            if level == "outline":
                proj_nodes = outline_canvas_nodes(nodes)
                proj_connections = outline_canvas_connections(connections)
                # L1 orientation block (§2.2): container roster + free-edge tally.
                _containers = outline_containers(nodes)
                if _containers:
                    meta["containers"] = _containers
                meta["freeEdges"] = count_free_edges(connections)
            elif level == "full":
                # full = 原始节点，但绝不整画布返回：未用 where/limit/selection 收窄时按 FULL_NODE_CAP 截断。
                if not where and scope != "selection" and not (limit and limit > 0) and len(nodes) > FULL_NODE_CAP:
                    nodes = nodes[:FULL_NODE_CAP]
                    meta["warning"] = (
                        (meta.get("warning", "") + " ").strip()
                        + f"detail='full' capped to first {FULL_NODE_CAP} nodes; "
                        "use where/limit/scope=selection for targeted full reads."
                    ).strip()
                proj_nodes = nodes
                proj_connections = connections
            else:
                proj_nodes = simplify_canvas_nodes(nodes)
                proj_connections = simplify_canvas_connections(connections)

            # Deterministic structural diagnostics over the WHOLE canvas (cycle / orphan /
            # unsupported-claim / MECE-overlap) — ground truth attached to meta so the model
            # doesn't error-prone re-derive structure from the raw edge list. Only on
            # whole-canvas reads (scope=all, no where/children_of) to stay coherent.
            if scope == "all" and not where and not children_of:
                try:
                    from core.canvas.inference.diagnostics import run_diagnostics

                    _diag = run_diagnostics({
                        "nodes": canvas_doc.get("nodes", []),
                        "connections": canvas_doc.get("connections", []),
                    })
                    if _diag:
                        meta["diagnostics"] = _diag
                except Exception:
                    logger.debug("canvas_read diagnostics skipped", exc_info=True)

                # Deterministic PRESENTATION critic — a readability scalar + findings so the
                # model can SEE (via the channel it already trusts) that its layout is an
                # unreadable column, instead of judging readability blind.
                try:
                    from core.canvas.inference.layout_critic import score_layout

                    _crit = score_layout({
                        "nodes": canvas_doc.get("nodes", []),
                        "connections": canvas_doc.get("connections", []),
                    })
                    if _crit.get("findings") or _crit.get("below_floor"):
                        meta["presentation"] = _crit
                except Exception:
                    logger.debug("canvas_read layout critic skipped", exc_info=True)

            # 构建结果
            result = {
                "canvas": {
                    "id": target_canvas_id,
                    "title": canvas_doc.get("title", ""),
                    "detail": level,
                    "nodes": proj_nodes,
                    "connections": proj_connections,
                },
                "selection": selection_ids,
            }
            if canvas_id:
                meta["crossCanvas"] = True
            if meta:
                result["meta"] = meta

            # 自预算：保证序列化后始终是合法 JSON 且不超预算（画布读已豁免字节级截断）。
            # 'full' reads keep complete content (no per-node shrink); only the trailing-node
            # drop guards the size, so detail='full' honors its "raw / complete" contract.
            result = budget_read_result(result, level=level)

            return self.success_response(result)

        except Exception as e:
            logger.exception("canvas_read failed")
            return self.fail_response(f"Failed to read canvas: {e}")

    async def _fetch_canvas(self, account_id: str, canvas_id: str) -> Optional[Dict[str, Any]]:
        """获取画布文档"""
        # 优先从 Realtime 获取最新快照
        if config.CANVAS_REALTIME_WRITE_ENABLED:
            try:
                snap = await self._write_service.fetch_canvas_snapshot(
                    canvas_id=canvas_id,
                    workspace_id=account_id,
                    user_id=None,
                )
                if isinstance(snap, dict) and snap.get("canvas"):
                    return snap["canvas"]
            except Exception as e:
                logger.warning(f"canvas_read: realtime snapshot failed: {e}")

        # 回退到数据库
        try:
            client = await self.db.client
            res = await client.table("canvases").select("*").eq("id", canvas_id).eq("account_id", account_id).limit(1).execute()
            if res.data:
                doc = res.data[0].get("doc") or {}
                doc.setdefault("nodes", [])
                doc.setdefault("connections", [])
                return doc
        except Exception as e:
            logger.error(f"canvas_read: db fetch failed: {e}")

        return None

    # Node filtering / predicate matching moved to module-level pure functions in
    # core.canvas.read_projection: match_predicate / find_nodes / children_subtree.

    # Read projection moved to module-level pure functions (top of file):
    # simplify_canvas_nodes / simplify_canvas_connections / compact_mindmap_tree /
    # budget_read_result — pure, DB-free, unit-testable, reusable by any read path.


# ============================================================
# canvas_write
# ============================================================

@dataclass
class CanvasWriteTool(Tool):
    """canvas_write - 创建新内容"""

    thread_id: str
    canvas_id: Optional[str] = None
    db_connection: Optional[DBConnection] = None
    thread_manager: object | None = None

    def __post_init__(self) -> None:
        super().__init__()
        self.db = self.db_connection or DBConnection()
        self._write_service = CanvasWriteService()

    async def _get_account_id(self) -> Optional[str]:
        try:
            client = await self.db.client
            res = await client.table("threads").select("account_id").eq("thread_id", self.thread_id).limit(1).execute()
            if res.data:
                return res.data[0].get("account_id")
        except Exception as e:
            logger.error(f"canvas_write: failed to get account_id: {e}")
        return None

    async def _get_canvas_id(self) -> Optional[str]:
        if self.canvas_id:
            return self.canvas_id
        try:
            client = await self.db.client
            res = await client.table("threads").select("canvas_id, metadata").eq("thread_id", self.thread_id).limit(1).execute()
            if res.data:
                row = res.data[0]
                cid = row.get("canvas_id")
                if cid:
                    return cid
                meta = row.get("metadata") or {}
                if isinstance(meta, str):
                    try:
                        meta = json.loads(meta)
                    except Exception:
                        meta = {}
                if isinstance(meta, dict):
                    return meta.get("canvas_id") or meta.get("canvasId")
        except Exception as e:
            logger.error(f"canvas_write: failed to get canvas_id: {e}")
        return None

    async def _cross_canvas_write_guard(
        self,
        *,
        bound_canvas_id: Optional[str],
        target_canvas_id: Optional[str],
    ) -> Optional[str]:
        md = await _get_latest_user_metadata(self.db, self.thread_id)
        return evaluate_cross_canvas_write_guard(
            md,
            bound_canvas_id=bound_canvas_id,
            target_canvas_id=target_canvas_id,
        )

    async def _get_selection_context(self) -> Optional[Dict[str, Any]]:
        """获取选中内容上下文"""
        try:
            client = await self.db.client
            rows = await client.table("messages").select("type, metadata, created_at") \
                .eq("thread_id", self.thread_id).eq("type", "user") \
                .order("created_at", desc=True).limit(1).execute()
            if rows and rows.data:
                md = rows.data[0].get("metadata") or {}
                if isinstance(md, str):
                    try:
                        md = json.loads(md)
                    except Exception:
                        md = {}
                return md.get("selection_context")
        except Exception as e:
            logger.debug(f"canvas_write: selection_context lookup failed: {e}")
        return None

    async def _fetch_canvas(self, account_id: str, canvas_id: str) -> Optional[Dict[str, Any]]:
        """获取画布文档"""
        if config.CANVAS_REALTIME_WRITE_ENABLED:
            try:
                snap = await self._write_service.fetch_canvas_snapshot(
                    canvas_id=canvas_id,
                    workspace_id=account_id,
                    user_id=None,
                )
                if isinstance(snap, dict) and snap.get("canvas"):
                    return snap["canvas"]
            except Exception:
                pass

        try:
            client = await self.db.client
            res = await client.table("canvases").select("*").eq("id", canvas_id).eq("account_id", account_id).limit(1).execute()
            if res.data:
                doc = res.data[0].get("doc") or {}
                doc.setdefault("nodes", [])
                doc.setdefault("connections", [])
                return doc
        except Exception:
            pass

        return None

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "canvas_write",
            "description": "Create new content on the canvas. Add nodes, create mind maps, or build structured content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "layout": {
                        "type": "string",
                        "enum": ["stack", "row", "grid", "mindmap", "tree", "freeform"],
                        "description": "Layout mode: 'stack' (vertical), 'row' (horizontal), 'grid', 'mindmap', 'tree'"
                    },
                    "anchor": {
                        "oneOf": [
                            {
                                "type": "string",
                                "description": "Anchor keyword (e.g. 'selection.right', 'viewport.center', 'node:id.below')"
                            },
                            {
                                "type": "object",
                                "properties": {
                                    "x": { "type": "number" },
                                    "y": { "type": "number" }
                                },
                                "required": ["x", "y"]
                            }
                        ],
                        "description": "Starting position: keyword or {x, y}"
                    },
                    "spacing": {
                        "oneOf": [
                            { "type": "number" },
                            {
                                "type": "object",
                                "properties": {
                                    "x": { "type": "number" },
                                    "y": { "type": "number" }
                                }
                            }
                        ],
                        "description": "Space between nodes (default: 20). Use {x,y} for asymmetric spacing."
                    },
                    "canvas_id": {
                        "type": "string",
                        "description": "Optional target canvas id. Defaults to the canvas bound to this thread."
                    },
                    "columns": {
                        "type": "integer",
                        "description": "Number of columns for grid layout (default: 3)"
                    },
                    "nodes": {
                        "type": "array",
                        "description": "Nodes to create. Each node: { type, content, $id? }",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": { "type": "string", "enum": ["text", "todo", "table", "code", "media", "group", "column", "canvas-link"] },
                                "content": { "type": "string" },
                                "$id": { "type": "string", "description": "Temporary ID for referencing in connections (e.g. '$1')" },
                                "codeType": { "type": "string", "enum": ["mermaid", "svg", "html"] },
                                "title": { "type": "string" },
                                "data": { "type": "object" },
                                "style": { "type": "object" },
                                "children": { "type": "array", "items": { "type": "string" } },
                                "groupMode": { "type": "string", "enum": ["normal", "mindmap"] },
                                "targetCanvasId": { "type": "string" }
                            },
                            "required": ["type"]
                        }
                    },
                    "connections": {
                        "type": "object",
                        "properties": {
                            "preset": { "type": "string", "enum": ["none", "chain", "star", "tree"] },
                            "items": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "from": { "type": "string" },
                                        "to": { "type": "string" },
                                        "label": { "type": "string" }
                                    },
                                    "required": ["from", "to"]
                                }
                            }
                        },
                        "description": "Connections via preset or explicit items list"
                    },
                    "tree": {
                        "type": "object",
                        "description": "Tree structure for mindmap/tree. { content, children: [...] }",
                        "properties": {
                            "$id": { "type": "string" },
                            "type": { "type": "string", "enum": ["text", "todo", "table", "code", "media", "group", "column", "canvas-link"] },
                            "content": { "type": "string" },
                            "style": { "type": "object" },
                            "children": { "type": "array" }
                        }
                    }
                }
            }
        }
    })
    @usage_example('''
    {
      "tool_calls": [
        {
          "type": "function",
          "function": {
            "name": "canvas_write",
            "arguments": {
              "layout": "stack",
              "anchor": "selection.right",
              "nodes": [
                { "type": "text", "content": "Idea 1" },
                { "type": "text", "content": "Idea 2" },
                { "type": "todo", "content": "Action item" }
              ]
            }
          }
        },
        {
          "type": "function",
          "function": {
            "name": "canvas_write",
            "arguments": {
              "layout": "mindmap",
              "tree": {
                "content": "Main Topic",
                "children": [
                  { "content": "Branch 1", "children": [{ "content": "Leaf 1" }] },
                  { "content": "Branch 2" }
                ]
              }
            }
          }
        }
      ]
    }
    ''')
    async def write(
        self,
        layout: Optional[str] = None,
        anchor: Optional[Any] = None,
        spacing: Optional[Any] = None,
        canvas_id: Optional[str] = None,
        columns: Optional[int] = None,
        nodes: Optional[List[Dict[str, Any]]] = None,
        connections: Optional[Any] = None,
        tree: Optional[Dict[str, Any]] = None,
    ) -> ToolResult:
        try:
            account_id = await self._get_account_id()
            bound_canvas_id = await self._get_canvas_id()
            target_canvas_id = canvas_id or bound_canvas_id

            if not account_id or not target_canvas_id:
                return self.fail_response("No canvas bound to this thread; provide canvas_id explicitly for cross-canvas access")

            cross_canvas_guard_error = await self._cross_canvas_write_guard(
                bound_canvas_id=bound_canvas_id,
                target_canvas_id=target_canvas_id,
            )
            if cross_canvas_guard_error:
                return self.fail_response(cross_canvas_guard_error)

            # 获取当前画布状态
            canvas_doc = await self._fetch_canvas(account_id, target_canvas_id)
            if not canvas_doc:
                return self.fail_response("Canvas not found")

            # 获取选中内容
            raw_selection_ctx = await self._get_selection_context()
            selection_ctx, selection_warnings = normalize_selection_context_payload(
                raw_selection_ctx,
                target_canvas_id=target_canvas_id,
            )

            # 创建引擎
            engine = CaCEngine(
                canvas_doc=canvas_doc,
                selection_context=selection_ctx,
            )

            # 解析锚点
            anchor_pos = engine.resolve_anchor(anchor)

            # 处理节点
            created_nodes: List[Dict[str, Any]] = []
            created_connections: List[Dict[str, Any]] = []
            id_map: Dict[str, str] = {}
            created_group_id: Optional[str] = None
            warnings: List[str] = []
            if selection_warnings:
                warnings.extend(selection_warnings)

            if tree:
                # Level 3: 树形结构
                from .types import TreeNodeInput as TreeInput
                tree_input = TreeInput.from_dict(tree)
                created_nodes, created_connections = engine.flatten_tree(
                    tree_input,
                    layout,
                    anchor_pos,
                    spacing,
                )
                # Preserve temp-id mapping for later references ($1, $2, ...)
                id_map = engine.build_id_map(created_nodes)
            elif nodes:
                # Level 1-2: 直接添加节点
                node_inputs = [NodeInput.from_dict(n) for n in nodes]
                created_nodes = engine.calculate_layout(
                    node_inputs,
                    layout,
                    anchor_pos,
                    spacing,
                    columns,
                )

                # 处理连接
                # Preserve temp-id mapping for later references ($1, $2, ...)
                id_map = engine.build_id_map(created_nodes)

                if connections:
                    normalized_connections: Any = connections
                    # Canonical CaC shape (from args model): {preset, items}
                    if isinstance(connections, dict):
                        items = connections.get("items")
                        preset = connections.get("preset")
                        if isinstance(items, list):
                            normalized_connections = items
                        elif isinstance(preset, str):
                            normalized_connections = preset
                        else:
                            normalized_connections = None

                    if isinstance(normalized_connections, str):
                        if normalized_connections != "none":
                            created_connections = engine.create_connections(normalized_connections, created_nodes, id_map)
                    elif isinstance(normalized_connections, list):
                        conn_inputs = [ConnectionInput.from_dict(c) for c in normalized_connections if isinstance(c, dict)]
                        created_connections = engine.create_connections(conn_inputs, created_nodes, id_map)
            else:
                return self.fail_response("canvas_write requires 'nodes' or 'tree'")

            # Resolve temp-id references inside container fields (children, parentGroupId) before applying ops.
            # This enables one-call creation of groups/columns that reference freshly created nodes via $id.
            if id_map and created_nodes:
                for n in created_nodes:
                    try:
                        if isinstance(n.get("children"), list):
                            n["children"] = [
                                id_map.get(str(cid), str(cid)) if isinstance(cid, str) else cid
                                for cid in n["children"]
                            ]
                        if isinstance(n.get("parentGroupId"), str):
                            n["parentGroupId"] = id_map.get(n["parentGroupId"], n["parentGroupId"])
                    except Exception:
                        continue

            # If the user requested a mindmap tree, create a mindmap group container automatically.
            # This turns "layout='mindmap' + tree" into a real mindmap group with children + parentGroupId.
            if tree and str(layout or "").strip().lower() == "mindmap" and created_nodes:
                try:
                    used_ids = {str(n.get("id")) for n in created_nodes if n.get("id")}
                    gid = generate_canvas_entity_id()
                    while gid in used_ids:
                        gid = generate_canvas_entity_id()
                    created_group_id = gid

                    # Derive group title from root content.
                    group_title = ""
                    try:
                        group_title = str(created_nodes[0].get("content") or "").strip()
                    except Exception:
                        group_title = ""
                    if not group_title:
                        group_title = "Mindmap"

                    # Compute a loose bounding box around member nodes.
                    min_x = min(float(n.get("x", 0)) for n in created_nodes)
                    min_y = min(float(n.get("y", 0)) for n in created_nodes)
                    max_x = max(float(n.get("x", 0)) + float(n.get("width", 0)) for n in created_nodes)
                    max_y = max(float(n.get("y", 0)) + float(n.get("height", 0)) for n in created_nodes)
                    pad = 80.0
                    gx = min_x - pad
                    gy = min_y - pad
                    gw = max(200.0, (max_x - min_x) + pad * 2)
                    gh = max(120.0, (max_y - min_y) + pad * 2)

                    # Spacing defaults mirror the tree layout defaults.
                    spacing_x = 96.0
                    spacing_y = 30.0
                    if isinstance(spacing, dict):
                        spacing_x = float(spacing.get("x", spacing_x))
                        spacing_y = float(spacing.get("y", spacing_y))
                    elif spacing is not None:
                        try:
                            spacing_x = spacing_y = float(spacing)
                        except Exception:
                            pass

                    root_id = str(created_nodes[0].get("id") or "")
                    member_ids = [str(n.get("id")) for n in created_nodes if n.get("id")]
                    group_node = {
                        "id": created_group_id,
                        "type": "group",
                        "x": gx,
                        "y": gy,
                        "width": gw,
                        "height": gh,
                        "content": group_title,
                        "children": member_ids,
                        "groupMode": "mindmap",
                        "mindmap": {
                            "rootId": root_id,
                            "spacingX": spacing_x,
                            "spacingY": spacing_y,
                            "orientation": "right",
                        },
                    }
                    created_nodes.append(group_node)
                except Exception as e:
                    return self.fail_response(f"Failed to create mindmap group: {e}")

            # Enforce container invariants locally to avoid silent partial state:
            # - group.children must reference existing nodes
            # - group children get parentGroupId auto-filled when created in the same call
            try:
                existing_ids = set()
                for n in canvas_doc.get("nodes", []):
                    if isinstance(n, dict) and n.get("id"):
                        existing_ids.add(str(n["id"]))
                created_by_id = {str(n.get("id")): n for n in created_nodes if isinstance(n, dict) and n.get("id")}
                known_ids = existing_ids | set(created_by_id.keys())

                for n in created_nodes:
                    if not isinstance(n, dict):
                        continue
                    if n.get("type") == "group" and isinstance(n.get("children"), list):
                        children = [str(cid) for cid in n.get("children") if isinstance(cid, str) and cid.strip()]
                        # De-dup while preserving order.
                        seen = set()
                        cleaned = []
                        for cid in children:
                            if cid in seen or cid == str(n.get("id")):
                                continue
                            seen.add(cid)
                            cleaned.append(cid)
                        n["children"] = cleaned

                        unknown = [cid for cid in cleaned if cid not in known_ids]
                        if unknown:
                            return self.fail_response(
                                f"group.children contains unknown node id(s): {unknown}. "
                                "Tip: if referencing newly created nodes, use $id in canvas_write and rely on idMap."
                            )

                        # Auto-fill parentGroupId for nodes created in this call.
                        gid = str(n.get("id") or "")
                        if gid:
                            for cid in cleaned:
                                child = created_by_id.get(cid)
                                if child and not child.get("parentGroupId"):
                                    child["parentGroupId"] = gid

                    if n.get("type") == "column" and isinstance(n.get("children"), list):
                        # Drop unknown child ids (columns render from children list; unknown ids are always noise).
                        children = [str(cid) for cid in n.get("children") if isinstance(cid, str) and cid.strip()]
                        seen = set()
                        cleaned = []
                        for cid in children:
                            if cid in seen:
                                continue
                            seen.add(cid)
                            if cid not in known_ids:
                                warnings.append(f"Dropped unknown child id in column.children: {cid}")
                                continue
                            cleaned.append(cid)
                        n["children"] = cleaned
            except Exception:
                pass

            # 过滤非法连接（group 或不存在的节点）
            if created_connections:
                node_type_by_id: Dict[str, Any] = {}
                for n in canvas_doc.get("nodes", []):
                    if isinstance(n, dict) and n.get("id"):
                        node_type_by_id[str(n["id"])] = n.get("type")
                for n in created_nodes:
                    if isinstance(n, dict) and n.get("id"):
                        node_type_by_id[str(n["id"])] = n.get("type")

                filtered_connections: List[Dict[str, Any]] = []
                for conn in created_connections:
                    frm = conn.get("from")
                    to = conn.get("to")
                    if frm and node_type_by_id.get(str(frm)) == "group":
                        warnings.append(f"Skipped connection from group node: {frm}")
                        continue
                    if to and node_type_by_id.get(str(to)) == "group":
                        warnings.append(f"Skipped connection to group node: {to}")
                        continue
                    if frm and str(frm) not in node_type_by_id:
                        warnings.append(f"Skipped connection from missing node: {frm}")
                        continue
                    if to and str(to) not in node_type_by_id:
                        warnings.append(f"Skipped connection to missing node: {to}")
                        continue
                    filtered_connections.append(conn)
                created_connections = filtered_connections

            # 构建操作列表
            operations = []
            for node in created_nodes:
                operations.append({"op": "add_node", "node": node})

            for conn in created_connections:
                operations.append({"op": "add_connection", **conn})

            # 应用操作
            if not operations:
                return self.fail_response("No nodes to create")

            result = await self._apply_operations(account_id, target_canvas_id, operations)

            if not result.get("success", False):
                raw_err = result.get("error", "Failed to apply operations")
                msg = raw_err.get("error") if isinstance(raw_err, dict) else raw_err
                return self.fail_response(f"{msg}{canvas_error_suffix(result.get('canvasError') or {})}")

            runtime_payload = result.get("payload")
            if isinstance(runtime_payload, dict):
                runtime_id_map = runtime_payload.get("id_map") or runtime_payload.get("idMap")
                if isinstance(runtime_id_map, dict):
                    merged_id_map: Dict[str, str] = {}
                    for key, value in id_map.items():
                        if isinstance(key, str) and isinstance(value, str):
                            merged_id_map[key] = value
                    for key, value in runtime_id_map.items():
                        if isinstance(key, str) and isinstance(value, str):
                            merged_id_map[key] = value
                    id_map = merged_id_map
                runtime_warnings = runtime_payload.get("warnings")
                if isinstance(runtime_warnings, list):
                    warnings.extend([str(item) for item in runtime_warnings if str(item).strip()])
            if warnings:
                warnings = list(dict.fromkeys(warnings))

            response_payload = {
                "success": True,
                "canvasId": target_canvas_id,
                "idMap": id_map,
                "applied": {
                    "nodesAdded": len(created_nodes),
                    "connectionsAdded": len(created_connections),
                },
                # Echo real ids + final geometry so the agent can reference / position what
                # it just created without a re-read (ID-6; serves accurate "where is it").
                "created": {
                    "nodes": [
                        {
                            "id": n.get("id"),
                            "type": n.get("type"),
                            "x": n.get("x"),
                            "y": n.get("y"),
                            "width": n.get("width"),
                            "height": n.get("height"),
                        }
                        for n in created_nodes
                        if isinstance(n, dict) and n.get("id")
                    ],
                    "connections": [
                        c.get("id") for c in created_connections if isinstance(c, dict) and c.get("id")
                    ],
                },
            }
            if created_group_id:
                response_payload["groupId"] = created_group_id
            if warnings:
                response_payload["warnings"] = warnings
            _pres = await self._presentation_for(account_id, target_canvas_id)
            if _pres:
                response_payload["presentation"] = _pres
            return self.success_response(response_payload)

        except Exception as e:
            logger.exception("canvas_write failed")
            return self.fail_response(f"Failed to write canvas: {e}")

    async def _presentation_for(self, account_id: str, canvas_id: str) -> Optional[Dict[str, Any]]:
        """Score the POST-write canvas; if it is an unreadable dead column of SAFELY-MOVABLE
        (free, unpinned) nodes, deterministically reflow it into a grid server-side — no LLM
        turn, no agent retry — and re-score. Returns the (possibly now-improved) critic dict,
        or None when there is nothing to flag. Grouped/pinned piles can't be auto-moved safely,
        so they stay below_floor and the agent-steer loop handles them. Best-effort: never
        breaks a successful write."""
        try:
            from core.canvas.inference.layout_critic import score_layout
            from core.canvas.inference.autolayout import plan_reflow

            doc = await self._fetch_canvas(account_id, canvas_id)
            if not isinstance(doc, dict):
                return None
            payload = {"nodes": doc.get("nodes", []), "connections": doc.get("connections", [])}
            crit = score_layout(payload)
            auto = False
            if crit.get("below_floor"):
                ops = plan_reflow(payload)
                if ops:
                    res = await self._apply_operations(account_id, canvas_id, ops)
                    if isinstance(res, dict) and res.get("success", False):
                        auto = True
                        doc2 = await self._fetch_canvas(account_id, canvas_id)
                        if isinstance(doc2, dict):
                            crit = score_layout({
                                "nodes": doc2.get("nodes", []),
                                "connections": doc2.get("connections", []),
                            })
            if auto:
                crit["auto_relayout_applied"] = True
            # Only surface at WRITE time when actionable (below floor, or we auto-reflowed) so the
            # agent does not over-react to minor warn-level findings on small edits. Full findings
            # remain available at read time (canvas_read meta).
            if crit.get("below_floor") or auto:
                return crit
        except Exception:
            logger.debug("post-write layout critic/relayout skipped", exc_info=True)
        return None

    async def _apply_operations(
        self,
        account_id: str,
        canvas_id: str,
        operations: List[Dict[str, Any]],
        expected_version: Optional[str] = None,
    ) -> Dict[str, Any]:
        """应用操作到画布"""
        from core.tools.canvas_edit_tool import CanvasEditTool

        tool = CanvasEditTool(
            thread_manager=self.thread_manager,
            thread_id=self.thread_id,
            canvas_id=canvas_id,
            db_connection=self.db,
        )

        result = await tool.edit(
            canvas_id=canvas_id,
            operations=operations,
            expected_version=expected_version,
            broadcast_canvas_ws=True,
        )

        if result.success:
            payload = _parse_tool_output_dict(result.output)
            return {
                "success": True,
                "payload": payload,
            }
        else:
            raw = result.output
            msg = raw.get("error") if isinstance(raw, dict) else raw
            envelope = normalize_canvas_error(msg if isinstance(msg, str) else str(msg))
            return {"success": False, "error": raw, "canvasError": envelope}


# ============================================================
# canvas_edit
# ============================================================

@dataclass
class CanvasEditTool(Tool):
    """canvas_edit - 修改/删除现有内容"""

    thread_id: str
    canvas_id: Optional[str] = None
    db_connection: Optional[DBConnection] = None
    thread_manager: object | None = None

    def __post_init__(self) -> None:
        super().__init__()
        self.db = self.db_connection or DBConnection()
        self._write_service = CanvasWriteService()

    async def _get_account_id(self) -> Optional[str]:
        try:
            client = await self.db.client
            res = await client.table("threads").select("account_id").eq("thread_id", self.thread_id).limit(1).execute()
            if res.data:
                return res.data[0].get("account_id")
        except Exception as e:
            logger.error(f"canvas_edit: failed to get account_id: {e}")
        return None

    async def _get_canvas_id(self) -> Optional[str]:
        if self.canvas_id:
            return self.canvas_id
        try:
            client = await self.db.client
            res = await client.table("threads").select("canvas_id, metadata").eq("thread_id", self.thread_id).limit(1).execute()
            if res.data:
                row = res.data[0]
                cid = row.get("canvas_id")
                if cid:
                    return cid
                meta = row.get("metadata") or {}
                if isinstance(meta, str):
                    try:
                        meta = json.loads(meta)
                    except Exception:
                        meta = {}
                if isinstance(meta, dict):
                    return meta.get("canvas_id") or meta.get("canvasId")
        except Exception as e:
            logger.error(f"canvas_edit: failed to get canvas_id: {e}")
        return None

    async def _cross_canvas_write_guard(
        self,
        *,
        bound_canvas_id: Optional[str],
        target_canvas_id: Optional[str],
    ) -> Optional[str]:
        md = await _get_latest_user_metadata(self.db, self.thread_id)
        return evaluate_cross_canvas_write_guard(
            md,
            bound_canvas_id=bound_canvas_id,
            target_canvas_id=target_canvas_id,
        )

    async def _fetch_canvas(self, account_id: str, canvas_id: str) -> Optional[Dict[str, Any]]:
        """获取画布文档"""
        if config.CANVAS_REALTIME_WRITE_ENABLED:
            try:
                snap = await self._write_service.fetch_canvas_snapshot(
                    canvas_id=canvas_id,
                    workspace_id=account_id,
                    user_id=None,
                )
                if isinstance(snap, dict) and snap.get("canvas"):
                    return snap["canvas"]
            except Exception:
                pass

        try:
            client = await self.db.client
            res = await client.table("canvases").select("*").eq("id", canvas_id).eq("account_id", account_id).limit(1).execute()
            if res.data:
                doc = res.data[0].get("doc") or {}
                doc.setdefault("nodes", [])
                doc.setdefault("connections", [])
                return doc
        except Exception:
            pass

        return None

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "canvas_edit",
            "description": "Edit or delete existing content on the canvas. Modify node properties, delete nodes, or batch update.",
            "parameters": {
                "type": "object",
                "properties": {
                    "$delete": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Node IDs to delete"
                    },
                    "$select": {
                        "type": "string",
                        "description": "CSS-style selector for batch operations. E.g. '.text', '[content*=TODO]'"
                    },
                    "$set": {
                        "type": "object",
                        "description": "Properties to set on selected nodes (use with $select)"
                    },
                    "$canvas": {
                        "type": "object",
                        "description": "Canvas properties to update (title, backgroundColor, etc.)"
                    },
                    "$connections": {
                        "type": "object",
                        "description": "Update/delete/add connections. Use { \"$delete\": [\"conn-1\"] } to remove, or { \"$add\": [{\"from\":\"n1\",\"to\":\"n2\",\"label\":\"...\"}] } to create."
                    },
                    "$operations": {
                        "type": "array",
                        "description": "Advanced operations list (optional)."
                    },
                    "canvas_id": {
                        "type": "string",
                        "description": "Optional target canvas id. Defaults to the canvas bound to this thread."
                    },
                    "$transform": {
                        "type": "object",
                        "description": "Transform operations for matched nodes (optional)."
                    }
                },
                "additionalProperties": {
                    "type": "object",
                    "description": "Node ID as key, patch object as value. E.g. { \"n1\": { \"content\": \"new content\" } }"
                }
            }
        }
    })
    @usage_example('''
    {
      "tool_calls": [
        {
          "type": "function",
          "function": {
            "name": "canvas_edit",
            "arguments": {
              "n1": { "content": "Updated content" },
              "n2": { "x": 300, "y": 200 }
            }
          }
        },
        {
          "type": "function",
          "function": {
            "name": "canvas_edit",
            "arguments": {
              "$delete": ["n1", "n2", "n3"]
            }
          }
        },
        {
          "type": "function",
          "function": {
            "name": "canvas_edit",
            "arguments": {
              "$select": ".text[content*='TODO']",
              "$set": { "type": "todo" }
            }
          }
        }
      ]
    }
    ''')
    async def edit(self, **kwargs) -> ToolResult:
        try:
            target_canvas_id = kwargs.pop("canvas_id", None) or kwargs.pop("canvasId", None)
            # Optimistic concurrency (WRITE-4): a serverVersion pin the executor checks; a
            # stale pin -> STALE_RELOAD so the agent re-reads instead of clobbering a concurrent edit.
            expected_version = kwargs.pop("expected_version", None) or kwargs.pop("expectedVersion", None)
            account_id = await self._get_account_id()
            bound_canvas_id = await self._get_canvas_id()
            canvas_id = target_canvas_id or bound_canvas_id

            if not account_id or not canvas_id:
                return self.fail_response("No canvas bound to this thread; provide canvas_id explicitly for cross-canvas access")

            cross_canvas_guard_error = await self._cross_canvas_write_guard(
                bound_canvas_id=bound_canvas_id,
                target_canvas_id=canvas_id,
            )
            if cross_canvas_guard_error:
                return self.fail_response(cross_canvas_guard_error)

            # 获取当前画布状态
            canvas_doc = await self._fetch_canvas(account_id, canvas_id)
            if not canvas_doc:
                return self.fail_response("Canvas not found")

            # 解析输入
            payload = CanvasEditPayload.from_dict(dict(kwargs))

            # 创建引擎
            engine = CaCEngine(canvas_doc=canvas_doc)

            # 构建操作列表
            operations = []
            stats = {
                "nodesUpdated": 0,
                "nodesDeleted": 0,
                "connectionsAdded": 0,
                "connectionsUpdated": 0,
                "connectionsDeleted": 0,
            }
            warnings: List[str] = []

            # 处理删除
            if payload.delete:
                for node_id in payload.delete:
                    operations.append({"op": "delete_node", "id": node_id})
                    stats["nodesDeleted"] += 1

            # 处理通过 ID 修改
            if payload.updates:
                for node_id, patch in payload.updates.items():
                    # 转换字段名
                    normalized_patch = self._normalize_patch(patch)
                    operations.append({"op": "update_node", "id": node_id, "patch": normalized_patch})
                    stats["nodesUpdated"] += 1

            # 处理选择器模式（$select + $set/$transform）
            if payload.transform and not payload.select:
                warnings.append("$transform requires $select; ignored")

            if payload.select and (payload.set_values or payload.transform):
                matched_nodes = engine.match_selector(payload.select)
                base_patch = self._normalize_patch(payload.set_values) if payload.set_values else {}
                for node in matched_nodes:
                    patch = dict(base_patch)
                    if payload.transform:
                        transformed, transform_warnings = self._apply_transform(node, payload.transform)
                        if transform_warnings:
                            warnings.extend(transform_warnings)
                        patch.update(transformed)
                    if not patch:
                        continue
                    operations.append({"op": "update_node", "id": node["id"], "patch": patch})
                    stats["nodesUpdated"] += 1

            # 处理连接
            if payload.connections:
                def _normalize_connection(conn: Dict[str, Any]) -> Optional[Dict[str, Any]]:
                    if not isinstance(conn, dict):
                        return None
                    normalized = dict(conn)
                    if "from" not in normalized:
                        normalized["from"] = (
                            normalized.pop("source", None)
                            or normalized.pop("from_id", None)
                            or normalized.pop("fromId", None)
                        )
                    if "to" not in normalized:
                        normalized["to"] = (
                            normalized.pop("target", None)
                            or normalized.pop("to_id", None)
                            or normalized.pop("toId", None)
                        )
                    if not normalized.get("from") or not normalized.get("to"):
                        return None
                    return normalized

                conn_data = payload.connections
                if isinstance(conn_data, list):
                    for conn in conn_data:
                        normalized = _normalize_connection(conn) if isinstance(conn, dict) else None
                        if not normalized:
                            continue
                        operations.append({"op": "add_connection", **normalized})
                        stats["connectionsAdded"] += 1
                elif isinstance(conn_data, dict):
                    conn_data = dict(conn_data)
                    conn_delete = conn_data.pop("$delete", None)
                    if conn_delete:
                        for conn_id in conn_delete:
                            operations.append({"op": "delete_connection", "id": conn_id})
                            stats["connectionsDeleted"] += 1

                    conn_add = conn_data.pop("$add", None) or conn_data.pop("add", None)
                    if conn_add:
                        for conn in conn_add:
                            normalized = _normalize_connection(conn) if isinstance(conn, dict) else None
                            if not normalized:
                                continue
                            operations.append({"op": "add_connection", **normalized})
                            stats["connectionsAdded"] += 1

                    for conn_id, patch in conn_data.items():
                        if not conn_id.startswith("$"):
                            operations.append({"op": "update_connection", "id": conn_id, "patch": patch})
                            stats["connectionsUpdated"] += 1

            # 处理画布属性
            if payload.canvas:
                operations.append({"op": "update_canvas", "patch": payload.canvas})

            if payload.operations:
                if isinstance(payload.operations, dict):
                    operations.append(payload.operations)
                elif isinstance(payload.operations, list):
                    for op in payload.operations:
                        if isinstance(op, dict):
                            operations.append(op)

            # 应用操作
            if not operations:
                response: Dict[str, Any] = {"success": True, "applied": stats}
                if warnings:
                    response["warnings"] = list(dict.fromkeys(warnings))
                else:
                    response["warnings"] = ["No operations to apply"]
                return self.success_response(response)

            result = await self._apply_operations(account_id, canvas_id, operations, expected_version=expected_version)

            if not result.get("success", False):
                raw_err = result.get("error", "Failed to apply operations")
                msg = raw_err.get("error") if isinstance(raw_err, dict) else raw_err
                return self.fail_response(f"{msg}{canvas_error_suffix(result.get('canvasError') or {})}")

            runtime_payload = result.get("payload")
            if isinstance(runtime_payload, dict):
                runtime_warnings = runtime_payload.get("warnings")
                if isinstance(runtime_warnings, list):
                    warnings.extend([str(item) for item in runtime_warnings if str(item).strip()])
            if warnings:
                warnings = list(dict.fromkeys(warnings))

            response: Dict[str, Any] = {"success": True, "canvasId": canvas_id, "applied": stats}
            if warnings:
                response["warnings"] = warnings
            _pres = await self._presentation_for(account_id, canvas_id)
            if _pres:
                response["presentation"] = _pres
            return self.success_response(response)

        except Exception as e:
            logger.exception("canvas_edit failed")
            return self.fail_response(f"Failed to edit canvas: {e}")

    def _normalize_patch(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        """规范化 patch 字段名"""
        normalized = {}
        for key, value in patch.items():
            # 转换 snake_case 到 camelCase
            if key == "code_type":
                normalized["codeType"] = value
            elif key == "group_mode":
                normalized["groupMode"] = value
            elif key == "target_canvas_id":
                normalized["targetCanvasId"] = value
            elif key == "parent_group_id":
                normalized["parentGroupId"] = value
            else:
                normalized[key] = value
        return normalized

    def _apply_transform(
        self,
        node: Dict[str, Any],
        transform: Dict[str, Any],
    ) -> tuple[Dict[str, Any], List[str]]:
        """Apply a minimal transform spec to a node and return (patch, warnings).

        Supported:
          { "content": { "$replace": ["old", "new"] } }

        Notes:
        - Transform runs only in selector mode ($select).
        - Unsupported transform operations are ignored with warnings to avoid accidental writes.
        """
        if not isinstance(transform, dict):
            return ({}, ["$transform must be an object; ignored"])

        patch: Dict[str, Any] = {}
        warnings: List[str] = []
        for key, spec in transform.items():
            if not isinstance(key, str) or not key.strip():
                continue

            if isinstance(spec, dict) and "$replace" in spec:
                repl = spec.get("$replace")
                if not (isinstance(repl, list) and len(repl) == 2):
                    warnings.append(f"$transform.{key}.$replace must be [from, to]; ignored")
                    continue
                src, dst = repl[0], repl[1]
                current = node.get(key)
                if not isinstance(current, str):
                    # Don't coerce non-strings; that tends to surprise users.
                    continue
                patch[key] = current.replace(str(src), str(dst))
                continue

            warnings.append(f"Unsupported $transform operation for '{key}'; use $set instead")

        return patch, warnings

    async def _presentation_for(self, account_id: str, canvas_id: str) -> Optional[Dict[str, Any]]:
        """Score the POST-write canvas; if it is an unreadable dead column of SAFELY-MOVABLE
        (free, unpinned) nodes, deterministically reflow it into a grid server-side — no LLM
        turn, no agent retry — and re-score. Returns the (possibly now-improved) critic dict,
        or None when there is nothing to flag. Grouped/pinned piles can't be auto-moved safely,
        so they stay below_floor and the agent-steer loop handles them. Best-effort: never
        breaks a successful write."""
        try:
            from core.canvas.inference.layout_critic import score_layout
            from core.canvas.inference.autolayout import plan_reflow

            doc = await self._fetch_canvas(account_id, canvas_id)
            if not isinstance(doc, dict):
                return None
            payload = {"nodes": doc.get("nodes", []), "connections": doc.get("connections", [])}
            crit = score_layout(payload)
            auto = False
            if crit.get("below_floor"):
                ops = plan_reflow(payload)
                if ops:
                    res = await self._apply_operations(account_id, canvas_id, ops)
                    if isinstance(res, dict) and res.get("success", False):
                        auto = True
                        doc2 = await self._fetch_canvas(account_id, canvas_id)
                        if isinstance(doc2, dict):
                            crit = score_layout({
                                "nodes": doc2.get("nodes", []),
                                "connections": doc2.get("connections", []),
                            })
            if auto:
                crit["auto_relayout_applied"] = True
            # Only surface at WRITE time when actionable (below floor, or we auto-reflowed) so the
            # agent does not over-react to minor warn-level findings on small edits. Full findings
            # remain available at read time (canvas_read meta).
            if crit.get("below_floor") or auto:
                return crit
        except Exception:
            logger.debug("post-write layout critic/relayout skipped", exc_info=True)
        return None

    async def _apply_operations(
        self,
        account_id: str,
        canvas_id: str,
        operations: List[Dict[str, Any]],
        expected_version: Optional[str] = None,
    ) -> Dict[str, Any]:
        """应用操作到画布"""
        from core.tools.canvas_edit_tool import CanvasEditTool as OriginalCanvasEditTool

        tool = OriginalCanvasEditTool(
            thread_manager=self.thread_manager,
            thread_id=self.thread_id,
            canvas_id=canvas_id,
            db_connection=self.db,
        )

        result = await tool.edit(
            canvas_id=canvas_id,
            operations=operations,
            expected_version=expected_version,
            broadcast_canvas_ws=True,
        )

        if result.success:
            payload = _parse_tool_output_dict(result.output)
            return {
                "success": True,
                "payload": payload,
            }
        else:
            raw = result.output
            msg = raw.get("error") if isinstance(raw, dict) else raw
            envelope = normalize_canvas_error(msg if isinstance(msg, str) else str(msg))
            return {"success": False, "error": raw, "canvasError": envelope}
