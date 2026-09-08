from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse

from core.canvas.write_service import CanvasWriteService


def parse_deleted_flag(deleted: Optional[str]) -> bool:
    if deleted is None:
        return False
    try:
        return str(deleted).lower() in ("1", "true", "yes", "y")
    except Exception:
        return False


def calculate_days_remaining(
    deleted_at_iso: Optional[str],
    retention_days: int,
    *,
    now: Optional[datetime] = None,
) -> Optional[int]:
    if not deleted_at_iso:
        return None
    try:
        dt = datetime.fromisoformat(str(deleted_at_iso).replace("Z", "+00:00"))
        current = now or datetime.now(timezone.utc)
        elapsed = (current - dt).days
        return max(0, int(retention_days) - int(elapsed))
    except Exception:
        return None


def calculate_doc_counts(doc: Any) -> tuple[int, int]:
    payload = doc or {}
    if isinstance(payload, str):
        try:
            import json as _json

            payload = _json.loads(payload)
        except Exception:
            payload = {}
    if not isinstance(payload, dict):
        return 0, 0
    nodes = payload.get("nodes") or []
    connections = payload.get("connections") or []
    node_count = len(nodes) if isinstance(nodes, list) else 0
    connection_count = len(connections) if isinstance(connections, list) else 0
    return node_count, connection_count


@dataclass(frozen=True)
class CanvasQueryDependencies:
    resolve_user_workspace: Callable[[Request, Optional[str]], Awaitable[tuple[str, str]]]
    extract_invited_context: Callable[
        [Request, Optional[str], str],
        Awaitable[Optional[tuple[str, str]]],
    ]
    get_db_client: Callable[[], Awaitable[Any]]
    compose_doc: Callable[[dict[str, Any]], Any]
    compose_meta: Callable[[dict[str, Any]], Any]
    iso_to_ms: Callable[[Optional[str]], int]
    make_meta_etag: Callable[[str, int], str]
    make_canvas_etag: Callable[[str, Optional[str], Optional[int]], str]
    now_ts: Callable[[], int]
    backfill_media_storage_paths_from_file_ids: Callable[
        [Any, dict[str, Any], str],
        Awaitable[dict[str, Any]],
    ]
    set_cached_snapshot: Callable[[str, str, dict[str, Any]], Awaitable[Optional[str]]]
    get_cached_snapshot: Callable[[str, str], Awaitable[Optional[dict[str, Any]]]]
    doc_needs_media_backfill: Callable[[dict[str, Any]], bool]
    create_write_service: Callable[[], CanvasWriteService]
    canvas_doc_model: Any
    canvas_version_model: Any
    logger: Any
    realtime_write_enabled: bool
    snapshot_timeout_sec: float


class CanvasQueryService:
    def __init__(self, *, deps: CanvasQueryDependencies) -> None:
        self._deps = deps

    async def _resolve_canvas_access_context(
        self,
        *,
        canvas_id: str,
        request: Request,
        token: Optional[str],
    ) -> tuple[str, str]:
        invited_ctx = await self._deps.extract_invited_context(request, token, canvas_id)
        if invited_ctx:
            return invited_ctx
        return await self._deps.resolve_user_workspace(request, token)

    async def list_canvases(
        self,
        *,
        request: Request,
        token: Optional[str],
        limit: int,
        offset: int,
        deleted: Optional[str],
    ) -> Any:
        user_id, workspace_id = await self._deps.resolve_user_workspace(request, token)
        self._deps.logger.debug(
            f"Listing canvases user={user_id} workspace={workspace_id} limit={limit} offset={offset}"
        )
        client = await self._deps.get_db_client()
        try:
            query = client.table("canvases").select("*").eq("account_id", workspace_id)
            if deleted is None:
                query = query.eq("is_deleted", False)
            else:
                query = query.eq("is_deleted", parse_deleted_flag(deleted))
            query = query.order("updated_at", desc=True)
            if offset:
                query = query.range(offset, offset + limit - 1)
            result = await query.execute()
            rows = result.data or []
            return [self._deps.compose_doc(r) for r in rows]
        except Exception as e:
            self._deps.logger.error(f"Error listing canvases: {e}")
            raise HTTPException(status_code=500, detail="Failed to list canvases")

    async def list_canvas_meta(
        self,
        *,
        request: Request,
        token: Optional[str],
        limit: int,
        offset: int,
    ) -> Any:
        user_id, workspace_id = await self._deps.resolve_user_workspace(request, token)
        self._deps.logger.debug(
            f"Listing canvas meta user={user_id} workspace={workspace_id} limit={limit} offset={offset}"
        )
        client = await self._deps.get_db_client()
        try:
            query = (
                client.table("canvases")
                .select("id,title,version,created_at,updated_at,doc")
                .eq("account_id", workspace_id)
                .eq("is_deleted", False)
                .order("updated_at", desc=True)
            )
            if limit and limit > 0:
                end = offset + max(limit, 1) - 1
                query = query.range(offset, end)
            result = await query.execute()
            rows = result.data or []
            metas = [self._deps.compose_meta(r) for r in rows]
            latest = 0
            for row in rows:
                latest = max(latest, self._deps.iso_to_ms(row.get("updated_at")))
            etag = self._deps.make_meta_etag(workspace_id, latest)
            client_tag = (request.headers.get("if-none-match") or "").strip()
            headers = {"ETag": etag}
            if client_tag and client_tag == etag:
                return Response(status_code=304, headers=headers)
            return JSONResponse(
                content=[m.model_dump(mode="json", by_alias=True) for m in metas],
                headers=headers,
            )
        except Exception as e:
            self._deps.logger.error(f"Error listing canvas meta: {e}")
            raise HTTPException(status_code=500, detail="Failed to list canvas metadata")

    async def list_deleted_canvases_with_meta(
        self,
        *,
        request: Request,
        token: Optional[str],
        limit: int,
        offset: int,
        retention_days: int,
        q: Optional[str],
        sort_by: Optional[str],
        sort_dir: Optional[str],
    ) -> Any:
        _user_id, workspace_id = await self._deps.resolve_user_workspace(request, token)
        client = await self._deps.get_db_client()
        try:
            qbuilder = (
                client.table("canvases")
                .select("id, title, doc, created_at, updated_at, deleted_at", count="exact")
                .eq("account_id", workspace_id)
                .eq("is_deleted", True)
            )

            if q:
                try:
                    qbuilder = qbuilder.ilike("title", f"%{q}%")
                except Exception:
                    pass

            sort_key = sort_by or "deleted_at"
            supports_post_fetch_sort = sort_key == "node_count"

            if not supports_post_fetch_sort:
                try:
                    qbuilder = qbuilder.order(sort_key, desc=(sort_dir != "asc"))
                except Exception:
                    qbuilder = qbuilder.order("deleted_at", desc=True)

                if offset or limit:
                    qbuilder = qbuilder.range(offset, offset + max(1, limit) - 1)

            res = await qbuilder.execute()
            items = []
            for row in (res.data or []):
                node_count, connection_count = calculate_doc_counts(row.get("doc"))
                items.append(
                    {
                        "id": row.get("id"),
                        "title": row.get("title"),
                        "created_at": row.get("created_at"),
                        "updated_at": row.get("updated_at"),
                        "deleted_at": row.get("deleted_at"),
                        "days_remaining": calculate_days_remaining(
                            row.get("deleted_at"),
                            retention_days,
                        ),
                        "node_count": node_count,
                        "connection_count": connection_count,
                    }
                )

            if supports_post_fetch_sort:
                reverse = sort_dir != "asc"
                items.sort(
                    key=lambda item: (
                        int(item.get("node_count") or 0),
                        str(item.get("deleted_at") or ""),
                    ),
                    reverse=reverse,
                )
                if limit:
                    items = items[offset : offset + max(1, limit)]
                elif offset:
                    items = items[offset:]

            total_count = 0
            try:
                total_count = int(res.count or 0)
            except Exception:
                total_count = len(items)
            return {"items": items, "retention_days": retention_days, "total_count": total_count}
        except Exception as e:
            self._deps.logger.error(f"Error listing deleted canvases with meta: {e}")
            raise HTTPException(status_code=500, detail="Failed to list deleted canvases")

    async def get_canvas(
        self,
        *,
        canvas_id: str,
        request: Request,
        token: Optional[str],
    ) -> Any:
        user_id, workspace_id = await self._resolve_canvas_access_context(
            canvas_id=canvas_id,
            request=request,
            token=token,
        )
        self._deps.logger.debug(f"Fetching canvas {canvas_id} user={user_id} workspace={workspace_id}")
        client = await self._deps.get_db_client()
        try:
            if self._deps.realtime_write_enabled:
                try:
                    write_service = self._deps.create_write_service()
                    snap = await asyncio.wait_for(
                        write_service.fetch_canvas_snapshot(
                            canvas_id=canvas_id,
                            workspace_id=workspace_id,
                            user_id=user_id,
                        ),
                        timeout=self._deps.snapshot_timeout_sec,
                    )
                    canvas_doc = snap.get("canvas") if isinstance(snap, dict) else None
                    if isinstance(canvas_doc, dict):
                        canvas_doc = await self._deps.backfill_media_storage_paths_from_file_ids(
                            client,
                            canvas_doc,
                            workspace_id,
                        )
                        etag = self._deps.make_canvas_etag(
                            canvas_id,
                            str(canvas_doc.get("version") or "1.0.0"),
                            int(canvas_doc.get("updatedAt") or self._deps.now_ts()),
                        )
                        try:
                            await self._deps.set_cached_snapshot(workspace_id, canvas_id, canvas_doc)
                        except Exception:
                            pass
                        return JSONResponse(content=canvas_doc, headers={"ETag": etag})
                except asyncio.TimeoutError:
                    self._deps.logger.warning(f"[canvas] realtime snapshot timed out for {canvas_id}")
                except Exception as e:
                    self._deps.logger.warning(f"[canvas] realtime snapshot failed for {canvas_id}: {e}")

            result = (
                await client.table("canvases")
                .select("*")
                .eq("id", canvas_id)
                .eq("account_id", workspace_id)
                .eq("is_deleted", False)
                .limit(1)
                .execute()
            )
            if not result.data:
                raise HTTPException(status_code=404, detail="Canvas not found")
            row = result.data[0]
            payload = self._deps.compose_doc(row)
            doc = payload.model_dump(mode="json", by_alias=True)
            doc = await self._deps.backfill_media_storage_paths_from_file_ids(client, doc, workspace_id)
            etag = self._deps.make_canvas_etag(payload.id, row.get("version") or payload.version, payload.updatedAt)
            headers = {"ETag": etag}
            try:
                await self._deps.set_cached_snapshot(workspace_id, canvas_id, doc)
            except Exception:
                pass
            return JSONResponse(content=doc, headers=headers)
        except HTTPException:
            raise
        except Exception as e:
            self._deps.logger.error(f"Error fetching canvas {canvas_id}: {e}")
            raise HTTPException(status_code=500, detail="Failed to fetch canvas")

    async def get_canvas_snapshot(
        self,
        *,
        canvas_id: str,
        request: Request,
        token: Optional[str],
    ) -> Any:
        user_id, workspace_id = await self._resolve_canvas_access_context(
            canvas_id=canvas_id,
            request=request,
            token=token,
        )
        client = await self._deps.get_db_client()
        try:
            doc: Optional[dict] = None
            etag: Optional[str] = None
            cached = await self._deps.get_cached_snapshot(workspace_id, canvas_id)
            if isinstance(cached, dict):
                doc = cached.get("doc")
                etag = cached.get("etag")
            if isinstance(doc, dict):
                if not etag:
                    etag = self._deps.make_canvas_etag(
                        canvas_id,
                        str(doc.get("version") or "1.0.0"),
                        int(doc.get("updatedAt") or self._deps.now_ts()),
                    )
                client_tag = (request.headers.get("if-none-match") or "").strip()
                headers = {"ETag": etag, "X-Snapshot-Source": "cache"}
                if self._deps.doc_needs_media_backfill(doc):
                    doc = await self._deps.backfill_media_storage_paths_from_file_ids(client, doc, workspace_id)
                    return JSONResponse(content=doc, headers=headers)
                if client_tag and client_tag == etag:
                    return Response(status_code=304, headers=headers)
                return JSONResponse(content=doc, headers=headers)

            source = "db"
            if self._deps.realtime_write_enabled:
                try:
                    write_service = self._deps.create_write_service()
                    snap = await asyncio.wait_for(
                        write_service.fetch_canvas_snapshot(
                            canvas_id=canvas_id,
                            workspace_id=workspace_id,
                            user_id=user_id,
                        ),
                        timeout=self._deps.snapshot_timeout_sec,
                    )
                    canvas_doc = snap.get("canvas") if isinstance(snap, dict) else None
                    if isinstance(canvas_doc, dict):
                        doc = canvas_doc
                        source = "realtime"
                except asyncio.TimeoutError:
                    self._deps.logger.warning(f"[canvas] snapshot realtime timed out for {canvas_id}")
                except Exception as e:
                    self._deps.logger.warning(f"[canvas] snapshot realtime failed for {canvas_id}: {e}")

            if doc is None:
                result = (
                    await client.table("canvases")
                    .select("*")
                    .eq("id", canvas_id)
                    .eq("account_id", workspace_id)
                    .eq("is_deleted", False)
                    .limit(1)
                    .execute()
                )
                if not result.data:
                    raise HTTPException(status_code=404, detail="Canvas not found")
                row = result.data[0]
                payload = self._deps.compose_doc(row)
                doc = payload.model_dump(mode="json", by_alias=True)

            if isinstance(doc, dict):
                doc = await self._deps.backfill_media_storage_paths_from_file_ids(client, doc, workspace_id)
            etag = self._deps.make_canvas_etag(
                canvas_id,
                str(doc.get("version") or "1.0.0"),
                int(doc.get("updatedAt") or self._deps.now_ts()),
            )
            try:
                cached_etag = await self._deps.set_cached_snapshot(workspace_id, canvas_id, doc)
                if cached_etag:
                    etag = cached_etag
            except Exception:
                pass
            return JSONResponse(content=doc, headers={"ETag": etag, "X-Snapshot-Source": source})
        except HTTPException:
            raise
        except Exception as e:
            self._deps.logger.error(f"Error fetching canvas snapshot {canvas_id}: {e}")
            raise HTTPException(status_code=500, detail="Failed to fetch canvas snapshot")

    async def head_canvas(
        self,
        *,
        canvas_id: str,
        request: Request,
        token: Optional[str],
    ) -> Any:
        invited_ctx = await self._deps.extract_invited_context(request, token, canvas_id)
        if invited_ctx:
            _, workspace_id = invited_ctx
        else:
            _, workspace_id = await self._deps.resolve_user_workspace(request, token)
        client = await self._deps.get_db_client()
        try:
            result = (
                await client.table("canvases")
                .select("id,version,updated_at")
                .eq("id", canvas_id)
                .eq("account_id", workspace_id)
                .eq("is_deleted", False)
                .limit(1)
                .execute()
            )
            if not result.data:
                return Response(status_code=404)
            row = result.data[0]
            updated_ms = self._deps.iso_to_ms(row.get("updated_at"))
            etag = self._deps.make_canvas_etag(row.get("id"), row.get("version"), updated_ms)
            client_tag = (request.headers.get("if-none-match") or "").strip()
            headers = {"ETag": etag}
            if client_tag and client_tag == etag:
                return Response(status_code=304, headers=headers)
            return Response(status_code=200, headers=headers)
        except Exception:
            return Response(status_code=404)

    async def list_canvas_versions(
        self,
        *,
        canvas_id: str,
        request: Request,
        token: Optional[str],
        limit: Optional[int],
        is_auto_save: Optional[bool],
        order_direction: Optional[str],
    ) -> Any:
        _user_id, workspace_id = await self._deps.resolve_user_workspace(request, token)
        client = await self._deps.get_db_client()
        try:
            cres = (
                await client.table("canvases")
                .select("id")
                .eq("id", canvas_id)
                .eq("account_id", workspace_id)
                .eq("is_deleted", False)
                .limit(1)
                .execute()
            )
            if not cres.data:
                raise HTTPException(status_code=404, detail="Canvas not found")

            q = client.table("canvas_versions").select("*").eq("canvas_id", canvas_id)
            if is_auto_save is not None:
                q = q.eq("is_auto_save", is_auto_save)
            q = q.order("created_at", desc=(order_direction != "asc"))
            if limit:
                q = q.range(0, max(0, limit - 1))
            res = await q.execute()
            versions = []
            for row in (res.data or []):
                vdoc = row.get("version_doc") or {}
                try:
                    doc = self._deps.canvas_doc_model.model_validate(vdoc)
                except Exception:
                    doc = self._deps.canvas_doc_model(
                        id=canvas_id,
                        title=vdoc.get("title", "Untitled"),
                        nodes=[],
                        connections=[],
                        createdAt=self._deps.now_ts(),
                        updatedAt=self._deps.now_ts(),
                        version=vdoc.get("version", "1.0.0"),
                    )
                versions.append(
                    self._deps.canvas_version_model(
                        id=str(row.get("id")),
                        canvas_id=canvas_id,
                        version_data=doc,
                        is_auto_save=bool(row.get("is_auto_save", False)),
                        description=row.get("description"),
                        created_at=self._deps.iso_to_ms(row.get("created_at")),
                    )
                )
            return versions
        except HTTPException:
            raise
        except Exception as e:
            self._deps.logger.error(f"Error listing versions for {canvas_id}: {e}")
            raise HTTPException(status_code=500, detail="Failed to retrieve canvas versions")

    async def get_canvas_thread(
        self,
        *,
        canvas_id: str,
        request: Request,
        token: Optional[str],
    ) -> Any:
        _user_id, workspace_id = await self._deps.resolve_user_workspace(request, token)
        client = await self._deps.get_db_client()
        try:
            cres = (
                await client.table("canvases")
                .select("id")
                .eq("id", canvas_id)
                .eq("account_id", workspace_id)
                .limit(1)
                .execute()
            )
            if not cres.data:
                raise HTTPException(status_code=404, detail="Canvas not found")
            try:
                tres = await client.table("threads").select("thread_id").eq("canvas_id", canvas_id).limit(1).execute()
                if tres.data:
                    return {"exists": True, "thread_id": tres.data[0]["thread_id"]}
                return {"exists": False}
            except Exception as sel_err:
                self._deps.logger.warning(
                    f"peek thread: threads.canvas_id select failed (missing column or RLS?): {sel_err}"
                )
                return {"exists": False}
        except HTTPException:
            raise
        except Exception as e:
            self._deps.logger.error(f"Error peeking thread for canvas {canvas_id}: {e}")
            raise HTTPException(status_code=500, detail={"message": f"Failed to peek thread: {str(e)}"})
