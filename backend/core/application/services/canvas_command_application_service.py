from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Optional, Protocol

from fastapi import HTTPException, Request
from pydantic import ValidationError

from core.application.event_bus import record_event
from core.application.use_cases.canvas.create_canvas import CreateCanvasUseCase
from core.application.use_cases.canvas.delete_canvas import DeleteCanvasUseCase
from core.application.use_cases.canvas.restore_canvas import RestoreCanvasUseCase
from core.application.use_cases.canvas.update_canvas import UpdateCanvasUseCase
from core.application.use_cases.collaboration.append_operations import (
    AppendCollaborationOperationsUseCase,
)
from core.canvas.api_models import CanvasDoc, CanvasUpdate
from core.canvas.request_contract import (
    build_invalid_expected_version_detail,
    build_version_conflict_detail,
    extract_idempotency_key,
    extract_request_id,
    extract_session_id,
    parse_expected_server_version,
)
from core.canvas.write_service import CanvasRealtimeError, CanvasWriteService
from core.domains.canvas import events as canvas_events
from core.domains.canvas.model import Canvas
from core.infrastructure.canvas.supabase_canvas_repository import SupabaseCanvasRepository
from core.infrastructure.collaboration.supabase_collaboration_repository import (
    SupabaseCollaborationRepository,
)
from core.services import metrics
from core.tools.canvas_edit_tool import CanvasEditTool
from core.utils.errors import is_unique_violation
from core.utils.idempotency import get_idempotency_key


Handler = Callable[..., Awaitable[Any]]


def _is_realtime_version_conflict(rt_result: Any) -> bool:
    if not isinstance(rt_result, dict):
        return False
    rt_error = rt_result.get("error")
    return bool(
        rt_error == "version_conflict"
        or (isinstance(rt_error, dict) and rt_error.get("code") == "version_conflict")
        or rt_result.get("status_code") == 409
    )


def _extract_server_version(rt_result: Any) -> Optional[int]:
    if not isinstance(rt_result, dict):
        return None
    raw_server_version = rt_result.get("serverVersion") or rt_result.get("server_version")
    try:
        if raw_server_version is not None:
            return int(raw_server_version)
    except Exception:
        return None
    return None


def _parse_workspace_list(raw_value: Optional[Any]) -> set[str]:
    if raw_value is None:
        return set()
    if isinstance(raw_value, str):
        stripped = raw_value.strip()
        if not stripped:
            return set()
        if stripped.startswith("["):
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, list):
                    return {str(item).strip() for item in parsed if str(item).strip()}
            except Exception:
                pass
        return {item.strip() for item in stripped.split(",") if item.strip()}
    if isinstance(raw_value, (list, tuple, set)):
        return {str(item).strip() for item in raw_value if str(item).strip()}
    return set()


def _realtime_write_enabled_for_workspace(cfg: Any, workspace_id: Optional[str]) -> bool:
    if not bool(getattr(cfg, "CANVAS_REALTIME_WRITE_ENABLED", False)):
        return False
    forced_legacy = _parse_workspace_list(
        getattr(cfg, "CANVAS_FORCE_LEGACY_WORKSPACES", None)
    )
    if workspace_id and workspace_id in forced_legacy:
        return False
    return True


@dataclass(frozen=True)
class CanvasCommandLegacyHandlers:
    save_canvas_version: Handler
    delete_canvas_version: Handler
    purge_deleted_canvases: Handler
    hard_delete_canvas: Handler
    restore_canvases_batch: Handler
    purge_canvases_by_ids: Handler
    ensure_thread_for_canvas: Handler


class CanvasCommandGateway(Protocol):
    config: Any
    logger: Any
    utils: Any
    cache_service: Any
    _resolve_user_workspace: Any
    _now_ts: Any
    _compose_doc: Any
    _ensure_unique_canvas_title: Any
    _clean_canvas_doc_dict: Any
    _clean_node_dict: Any
    _clean_connection_dict: Any
    _workspace_canvas_meta: Any
    _broadcast_canvas_update: Any
    _set_cached_snapshot: Any
    _sync_canvas_file_links: Any
    _snapshot_cache_key: Any
    bump_canvas_server_version: Any
    bump_workspace_version_and_broadcast: Any
    rebuild_canvas_search_index: Any
    delete_canvas_search_index: Any


@dataclass(frozen=True)
class CanvasCommandDependencies:
    gateway: CanvasCommandGateway


@dataclass
class CanvasCommandApplicationService:
    deps: CanvasCommandDependencies
    legacy_handlers: CanvasCommandLegacyHandlers

    async def create_canvas(
        self,
        *,
        payload: Any,
        request: Request,
        token: Optional[str],
        client_request_id: Optional[str],
    ) -> Any:
        canvas_gateway = self.deps.gateway
        user_id, workspace_id = await canvas_gateway._resolve_user_workspace(request, token)
        client = await canvas_gateway.utils.db.client
        now_ms = canvas_gateway._now_ts()
        idempotency_key = get_idempotency_key(request)

        if idempotency_key:
            stable_suffix = hashlib.sha256(
                f"{workspace_id}:{idempotency_key}".encode("utf-8")
            ).hexdigest()[:12]
            canvas_id = f"canvas_{stable_suffix}"
            try:
                existing = (
                    await client.table("canvases")
                    .select("*")
                    .eq("id", canvas_id)
                    .eq("account_id", workspace_id)
                    .limit(1)
                    .execute()
                )
                if existing.data:
                    return canvas_gateway._compose_doc(existing.data[0])
            except Exception:
                pass
        else:
            canvas_id = f"canvas_{uuid.uuid4().hex[:12]}"

        unique_title = await canvas_gateway._ensure_unique_canvas_title(client, workspace_id, payload.title)
        doc = CanvasDoc(
            id=canvas_id,
            title=unique_title,
            nodes=payload.nodes or [],
            connections=payload.connections or [],
            createdAt=now_ms,
            updatedAt=now_ms,
            version="1.0.0",
            backgroundColor=payload.backgroundColor,
            backgroundStyleId=payload.backgroundStyleId,
            patternColor=payload.patternColor,
            cornerStyle=payload.cornerStyle,
            fontStyle=payload.fontStyle,
            textOpacityPreset=payload.textOpacityPreset,
            textLayoutPreset=payload.textLayoutPreset,
            metadata=payload.metadata,
        )
        server_version = await canvas_gateway.bump_canvas_server_version(canvas_id, now_ms)
        doc.serverVersion = server_version
        clean_doc = canvas_gateway._clean_canvas_doc_dict(doc.model_dump(mode="json", by_alias=True))
        use_case = CreateCanvasUseCase(SupabaseCanvasRepository())

        try:
            await use_case.execute(
                canvas_id=canvas_id,
                workspace_id=workspace_id,
                title=doc.title,
                version=doc.version,
                doc=clean_doc,
                actor_id=user_id,
                event_payload={
                    "server_version": server_version,
                    "created_at": now_ms,
                },
            )
            try:
                payload_thread = {
                    "project_id": None,
                    "account_id": workspace_id,
                    "metadata": {"source": "canvas_auto"},
                    "canvas_id": doc.id,
                }
                await client.table("threads").insert(payload_thread).execute()
            except Exception as e:
                canvas_gateway.logger.warning(f"Failed to auto-create bound thread for canvas {doc.id}: {e}")

            try:
                change_data = canvas_gateway._workspace_canvas_meta(clean_doc)
                if client_request_id:
                    change_data["clientRequestId"] = client_request_id
                await canvas_gateway.bump_workspace_version_and_broadcast(
                    workspace_id,
                    changes=[{"entity": "canvas", "action": "create", "data": change_data}],
                    actor_id=user_id,
                    request_id=client_request_id,
                )
            except Exception as e:
                canvas_gateway.logger.warning(f"Failed to bump workspace version after canvas create: {e}")

            await canvas_gateway._broadcast_canvas_update(
                workspace_id,
                doc.id,
                user_id,
                status="created",
                updated_at=now_ms,
                server_version=server_version,
            )
            try:
                await canvas_gateway._set_cached_snapshot(workspace_id, doc.id, clean_doc)
            except Exception:
                pass
            try:
                await canvas_gateway.rebuild_canvas_search_index(
                    doc.id,
                    workspace_id,
                    doc=clean_doc,
                    client=client,
                )
            except Exception as e:
                canvas_gateway.logger.warning(f"[search] index rebuild failed for canvas {doc.id}: {e}")
            return canvas_gateway._compose_doc(
                {
                    "id": doc.id,
                    "title": doc.title,
                    "version": doc.version,
                    "doc": clean_doc,
                }
            )

        except Exception as e:
            if idempotency_key and is_unique_violation(e):
                try:
                    existing = (
                        await client.table("canvases")
                        .select("*")
                        .eq("id", canvas_id)
                        .eq("account_id", workspace_id)
                        .limit(1)
                        .execute()
                    )
                    if existing.data:
                        return canvas_gateway._compose_doc(existing.data[0])
                except Exception:
                    pass
            canvas_gateway.logger.error(f"Error creating canvas: {e}")
            raise HTTPException(status_code=500, detail="Failed to create canvas")

    async def update_canvas(
        self,
        *,
        canvas_id: str,
        request: Request,
        token: Optional[str],
        expected_version: Optional[str],
    ) -> Any:
        canvas_gateway = self.deps.gateway
        user_id, workspace_id = await canvas_gateway._resolve_user_workspace(request, token)
        request_id = extract_request_id(request.headers)
        idempotency_key = extract_idempotency_key(request.headers)
        client_session_id = extract_session_id(request.headers, fallback=f"rest:{user_id}")
        try:
            expected_server_version = parse_expected_server_version(expected_version)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=build_invalid_expected_version_detail(),
            )

        raw_body: bytes = b"{}"
        try:
            raw_body = await request.body()
        except Exception as e:
            canvas_gateway.logger.error(
                "[Canvas UPDATE] Error reading request body",
                canvas_id=canvas_id,
                workspace_id=workspace_id,
                request_id=request_id,
                error=str(e),
            )

        try:
            body_data = json.loads(raw_body)
            payload = CanvasUpdate.model_validate(body_data)
        except ValidationError as ve:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Canvas数据验证失败",
                    "errors": [f"{' -> '.join(map(str, err['loc']))}: {err['msg']}" for err in ve.errors()],
                    "raw_errors": ve.errors(),
                },
            )
        except Exception as e:
            canvas_gateway.logger.error(f"[Canvas UPDATE] Error parsing request: {e}")
            raise HTTPException(status_code=400, detail=f"请求格式错误: {str(e)}")

        client = await canvas_gateway.utils.db.client
        try:
            existing_res = (
                await client.table("canvases")
                .select("*")
                .eq("id", canvas_id)
                .eq("account_id", workspace_id)
                .eq("is_deleted", False)
                .limit(1)
                .execute()
            )
            if not existing_res.data:
                raise HTTPException(status_code=404, detail="Canvas not found")
            row = existing_res.data[0]
            current_doc = canvas_gateway._compose_doc(row).model_dump(mode="json", by_alias=True)
            base_doc = dict(current_doc)
            base_canvas = Canvas(
                id=canvas_id,
                workspace_id=workspace_id,
                title=base_doc.get("title") or row.get("title") or "Untitled",
                version=base_doc.get("version") or row.get("version") or "1.0.0",
                doc=base_doc,
            )
            update_use_case = UpdateCanvasUseCase(SupabaseCanvasRepository())

            if expected_server_version is not None:
                current_sv = current_doc.get("serverVersion")
                if current_sv is None or int(current_sv) != expected_server_version:
                    canvas_gateway.logger.info(
                        "Canvas update version conflict",
                        canvas_id=canvas_id,
                        workspace_id=workspace_id,
                        request_id=request_id,
                        expected_version=expected_server_version,
                        current_server_version=current_sv,
                    )
                    raise HTTPException(
                        status_code=409,
                        detail=build_version_conflict_detail(
                            expected_server_version=expected_server_version,
                            current_server_version=int(current_sv) if current_sv is not None else None,
                        ),
                    )

            if payload.title is not None:
                current_doc["title"] = payload.title
            if payload.nodes is not None:
                current_doc["nodes"] = [
                    canvas_gateway._clean_node_dict(n.model_dump(mode="json", by_alias=True, exclude_none=True))
                    for n in payload.nodes
                ]
            if payload.connections is not None:
                current_doc["connections"] = [
                    canvas_gateway._clean_connection_dict(c.model_dump(mode="json", by_alias=True, exclude_none=True))
                    for c in payload.connections
                ]
            if payload.version is not None:
                current_doc["version"] = payload.version
            try:
                if payload.backgroundColor is not None:
                    current_doc["backgroundColor"] = payload.backgroundColor
                if payload.backgroundStyleId is not None:
                    current_doc["backgroundStyleId"] = payload.backgroundStyleId
                if payload.patternColor is not None:
                    current_doc["patternColor"] = payload.patternColor
                if payload.cornerStyle is not None:
                    current_doc["cornerStyle"] = payload.cornerStyle
                if payload.fontStyle is not None:
                    current_doc["fontStyle"] = payload.fontStyle
            except Exception:
                pass
            if payload.textOpacityPreset is not None:
                current_doc["textOpacityPreset"] = payload.textOpacityPreset
            if payload.textLayoutPreset is not None:
                current_doc["textLayoutPreset"] = payload.textLayoutPreset
            if payload.metadata is not None and isinstance(payload.metadata, dict):
                current_doc["metadata"] = payload.metadata

            current_doc["updatedAt"] = canvas_gateway._now_ts()
            current_doc = canvas_gateway._clean_canvas_doc_dict(current_doc)
            is_patch_only = payload.nodes is None and payload.connections is None
            realtime_write_enabled = _realtime_write_enabled_for_workspace(
                canvas_gateway.config, workspace_id
            )
            write_path = "realtime" if realtime_write_enabled else "legacy"
            canvas_gateway.logger.info(
                "Canvas update write path selected",
                canvas_id=canvas_id,
                workspace_id=workspace_id,
                request_id=request_id,
                path_source=write_path,
                expected_version=expected_server_version,
                has_idempotency_key=bool(idempotency_key),
                client_session_id=client_session_id,
                patch_only=is_patch_only,
                workspace_legacy_override=(
                    bool(canvas_gateway.config.CANVAS_REALTIME_WRITE_ENABLED)
                    and not realtime_write_enabled
                ),
            )
            metrics.incr(
                "canvas.write.path_selected",
                1,
                operation="update",
                path_source=write_path,
            )

            if realtime_write_enabled:
                try:
                    write_service = CanvasWriteService()

                    if is_patch_only:
                        patch: dict[str, Any] = {}
                        if payload.title is not None:
                            patch["title"] = payload.title
                        if payload.backgroundColor is not None:
                            patch["backgroundColor"] = payload.backgroundColor
                        if payload.backgroundStyleId is not None:
                            patch["backgroundStyleId"] = payload.backgroundStyleId
                        if payload.patternColor is not None:
                            patch["patternColor"] = payload.patternColor
                        if payload.cornerStyle is not None:
                            patch["cornerStyle"] = payload.cornerStyle
                        if payload.fontStyle is not None:
                            patch["fontStyle"] = payload.fontStyle
                        if payload.textOpacityPreset is not None:
                            patch["textOpacityPreset"] = payload.textOpacityPreset
                        if payload.textLayoutPreset is not None:
                            patch["textLayoutPreset"] = payload.textLayoutPreset
                        if payload.metadata is not None and isinstance(payload.metadata, dict):
                            patch["metadata"] = payload.metadata

                        if patch:
                            rt_result = await write_service.apply_canvas_ops(
                                canvas_id=canvas_id,
                                workspace_id=workspace_id,
                                operations=[{"op": "update_canvas", "patch": patch}],
                                expected_version=expected_server_version,
                                user_id=user_id,
                                idempotency_key=idempotency_key,
                                client_request_id=request_id,
                                client_session_id=client_session_id,
                            )
                        else:
                            rt_result = {"status": "noop"}
                    else:
                        rt_result = await write_service.import_canvas_snapshot(
                            canvas_id=canvas_id,
                            workspace_id=workspace_id,
                            doc=current_doc,
                            expected_version=expected_server_version,
                            user_id=user_id,
                            idempotency_key=idempotency_key,
                            client_request_id=request_id,
                            client_session_id=client_session_id,
                        )

                    if _is_realtime_version_conflict(rt_result):
                        raise HTTPException(
                            status_code=409,
                            detail=build_version_conflict_detail(
                                expected_server_version=expected_server_version,
                                current_server_version=_extract_server_version(rt_result),
                            ),
                        )
                except HTTPException:
                    raise
                except CanvasRealtimeError as e:
                    canvas_gateway.logger.error(
                        "[Canvas UPDATE] Realtime import failed",
                        canvas_id=canvas_id,
                        workspace_id=workspace_id,
                        request_id=request_id,
                        expected_version=str(expected_server_version) if expected_server_version is not None else None,
                        error=str(e),
                        code=getattr(e, "code", None),
                    )
                    detail = e.detail if isinstance(e.detail, dict) and e.detail else {
                        "message": e.message,
                        "code": e.code,
                    }
                    status_code = e.status_code if isinstance(e.status_code, int) and e.status_code >= 400 else 502
                    raise HTTPException(status_code=status_code, detail=detail)
                except Exception as e:
                    canvas_gateway.logger.error(
                        "[Canvas UPDATE] Realtime import failed",
                        canvas_id=canvas_id,
                        workspace_id=workspace_id,
                        request_id=request_id,
                        expected_version=str(expected_server_version) if expected_server_version is not None else None,
                        error=str(e),
                    )
                    raise HTTPException(status_code=502, detail="Failed to update canvas")

                latest_res = (
                    await client.table("canvases")
                    .select("*")
                    .eq("id", canvas_id)
                    .eq("account_id", workspace_id)
                    .eq("is_deleted", False)
                    .limit(1)
                    .execute()
                )
                latest_row = latest_res.data[0] if latest_res.data else row
                updated_doc = canvas_gateway._compose_doc(latest_row)
                try:
                    await canvas_gateway._set_cached_snapshot(
                        workspace_id,
                        canvas_id,
                        updated_doc.model_dump(mode="json", by_alias=True),
                    )
                except Exception:
                    pass

                if bool(row.get("timeline_enabled", False)):
                    try:
                        ev = {
                            "canvas_id": canvas_id,
                            "account_id": workspace_id,
                            "user_id": user_id,
                            "batch_id": str(uuid.uuid4()),
                            "seq": 0,
                            "op_type": "put_update",
                            "op": {"type": "put_update"},
                            "doc_after": canvas_gateway._clean_canvas_doc_dict(
                                updated_doc.model_dump(mode="json", by_alias=True)
                            ),
                            "is_checkpoint": True,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }
                        try:
                            await client.table("canvas_events").insert(ev).execute()
                        except Exception as inner:
                            canvas_gateway.logger.debug(f"canvas_events insert skipped: {inner}")
                        try:
                            vrow = {
                                "canvas_id": canvas_id,
                                "version_doc": canvas_gateway._clean_canvas_doc_dict(
                                    updated_doc.model_dump(mode="json", by_alias=True)
                                ),
                                "is_auto_save": True,
                                "description": "AutoSave",
                                "created_at": datetime.now(timezone.utc).isoformat(),
                            }
                            await client.table("canvas_versions").insert(vrow).execute()
                        except Exception as inner2:
                            canvas_gateway.logger.debug(f"canvas_versions autosave skipped: {inner2}")
                    except Exception as e:
                        canvas_gateway.logger.warning(f"Timeline/version log failed for {canvas_id}: {e}")

                try:
                    await canvas_gateway._sync_canvas_file_links(
                        client,
                        canvas_id,
                        workspace_id,
                        updated_doc.model_dump(mode="json", by_alias=True),
                    )
                except Exception:
                    pass

                try:
                    await canvas_gateway.rebuild_canvas_search_index(
                        canvas_id,
                        workspace_id,
                        doc=updated_doc.model_dump(mode="json", by_alias=True),
                        client=client,
                    )
                except Exception as e:
                    canvas_gateway.logger.warning(f"[search] index rebuild failed for canvas {canvas_id}: {e}")

                await update_use_case.execute(
                    canvas=base_canvas,
                    updates=updated_doc.model_dump(mode="json", by_alias=True),
                    actor_id=user_id,
                    persist=False,
                    event_payload={
                        "server_version": updated_doc.serverVersion,
                        "updated_at": updated_doc.updatedAt,
                    },
                )

                return updated_doc

            server_version = await canvas_gateway.bump_canvas_server_version(
                canvas_id,
                current_doc.get("serverVersion") or current_doc.get("updatedAt"),
            )
            current_doc["serverVersion"] = server_version
            await update_use_case.execute(
                canvas=base_canvas,
                updates=current_doc,
                actor_id=user_id,
                event_payload={
                    "server_version": server_version,
                    "updated_at": current_doc.get("updatedAt"),
                },
            )
            try:
                change_data = canvas_gateway._workspace_canvas_meta(current_doc)
                await canvas_gateway.bump_workspace_version_and_broadcast(
                    workspace_id,
                    changes=[{"entity": "canvas", "action": "update", "data": change_data}],
                    actor_id=user_id,
                )
            except Exception as e:
                canvas_gateway.logger.warning(f"Failed to bump workspace version after canvas update: {e}")
            await canvas_gateway._broadcast_canvas_update(
                workspace_id,
                canvas_id,
                user_id,
                status="updated",
                updated_at=current_doc.get("updatedAt", canvas_gateway._now_ts()),
                server_version=server_version,
            )
            try:
                await canvas_gateway._set_cached_snapshot(workspace_id, canvas_id, dict(current_doc))
            except Exception:
                pass

            if bool(row.get("timeline_enabled", False)):
                try:
                    ev = {
                        "canvas_id": canvas_id,
                        "account_id": workspace_id,
                        "user_id": user_id,
                        "batch_id": str(uuid.uuid4()),
                        "seq": 0,
                        "op_type": "put_update",
                        "op": {"type": "put_update"},
                        "doc_after": canvas_gateway._clean_canvas_doc_dict(dict(current_doc)),
                        "is_checkpoint": True,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }
                    try:
                        await client.table("canvas_events").insert(ev).execute()
                    except Exception as inner:
                        canvas_gateway.logger.debug(f"canvas_events insert skipped: {inner}")
                    try:
                        vrow = {
                            "canvas_id": canvas_id,
                            "version_doc": canvas_gateway._clean_canvas_doc_dict(dict(current_doc)),
                            "is_auto_save": True,
                            "description": "AutoSave",
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }
                        await client.table("canvas_versions").insert(vrow).execute()
                    except Exception as inner2:
                        canvas_gateway.logger.debug(f"canvas_versions autosave skipped: {inner2}")
                except Exception as e:
                    canvas_gateway.logger.warning(f"Timeline/version log failed for {canvas_id}: {e}")

            try:
                await canvas_gateway._sync_canvas_file_links(client, canvas_id, workspace_id, current_doc)
            except Exception:
                pass

            try:
                await canvas_gateway.rebuild_canvas_search_index(canvas_id, workspace_id, doc=current_doc, client=client)
            except Exception as e:
                canvas_gateway.logger.warning(f"[search] index rebuild failed for canvas {canvas_id}: {e}")
            return CanvasDoc.model_validate(current_doc)

        except HTTPException:
            raise
        except Exception as e:
            canvas_gateway.logger.error(
                "Error updating canvas",
                canvas_id=canvas_id,
                workspace_id=workspace_id,
                request_id=request_id,
                error=str(e),
            )
            raise HTTPException(status_code=500, detail="Failed to update canvas")

    async def apply_canvas_operations(
        self,
        *,
        canvas_id: str,
        payload: Any,
        request: Request,
        token: Optional[str],
        expected_version: Optional[str],
    ) -> Any:
        canvas_gateway = self.deps.gateway
        user_id, workspace_id = await canvas_gateway._resolve_user_workspace(request, token)
        request_id = extract_request_id(request.headers)
        idempotency_key = extract_idempotency_key(request.headers)
        session_id = extract_session_id(request.headers, fallback=f"rest:{user_id}")

        if not isinstance(payload.operations, list) or not payload.operations:
            raise HTTPException(status_code=400, detail="'operations' must be a non-empty array")

        if canvas_gateway.config.CANVAS_ENFORCE_CLIENT_IDS:

            def _normalize_op(raw: Any) -> Optional[str]:
                if raw is None:
                    return None
                value = str(raw).strip()
                if not value:
                    return None
                compact = value.replace("-", "_").replace(" ", "_").lower()
                compact_key = compact.replace("_", "")
                aliases = {
                    "addnode": "add_node",
                    "addconnection": "add_connection",
                }
                return aliases.get(compact_key, compact)

            for op in payload.operations:
                if not isinstance(op, dict):
                    continue
                kind = _normalize_op(op.get("op") or op.get("type") or op.get("operation") or op.get("action"))
                if kind == "add_node":
                    node = op.get("node") if isinstance(op.get("node"), dict) else {}
                    node_id = node.get("id")
                    if not node_id:
                        raise HTTPException(status_code=422, detail="add_node requires client-provided id")
                if kind == "add_connection":
                    conn_id = op.get("id") or op.get("connection_id") or op.get("connectionId")
                    if not conn_id:
                        raise HTTPException(status_code=422, detail="add_connection requires client-provided id")

        try:
            expected_server_version = parse_expected_server_version(expected_version)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=build_invalid_expected_version_detail(),
            )
        realtime_write_enabled = _realtime_write_enabled_for_workspace(
            canvas_gateway.config, workspace_id
        )
        write_path = "realtime" if realtime_write_enabled else "legacy"
        canvas_gateway.logger.info(
            "Canvas apply write path selected",
            canvas_id=canvas_id,
            workspace_id=workspace_id,
            request_id=request_id,
            path_source=write_path,
            expected_version=expected_server_version,
            operations_count=len(payload.operations),
            has_idempotency_key=bool(idempotency_key),
            client_session_id=session_id,
            workspace_legacy_override=(
                bool(canvas_gateway.config.CANVAS_REALTIME_WRITE_ENABLED)
                and not realtime_write_enabled
            ),
        )
        metrics.incr(
            "canvas.write.path_selected",
            1,
            operation="apply",
            path_source=write_path,
        )

        if realtime_write_enabled:
            try:
                write_service = CanvasWriteService()
                rt_result = await write_service.apply_canvas_ops(
                    canvas_id=canvas_id,
                    workspace_id=workspace_id,
                    operations=payload.operations,
                    expected_version=expected_server_version,
                    user_id=user_id,
                    idempotency_key=idempotency_key,
                    client_request_id=request_id,
                    client_session_id=session_id,
                )
            except CanvasRealtimeError as e:
                canvas_gateway.logger.error(
                    "Canvas apply realtime failed",
                    canvas_id=canvas_id,
                    workspace_id=workspace_id,
                    request_id=request_id,
                    expected_version=str(expected_server_version) if expected_server_version is not None else None,
                    error=str(e),
                    code=getattr(e, "code", None),
                )
                detail = e.detail if isinstance(e.detail, dict) and e.detail else {
                    "message": e.message,
                    "code": e.code,
                }
                status_code = e.status_code if isinstance(e.status_code, int) and e.status_code >= 400 else 502
                raise HTTPException(status_code=status_code, detail=detail)
            except Exception as e:
                canvas_gateway.logger.error(
                    "Canvas apply realtime failed",
                    canvas_id=canvas_id,
                    workspace_id=workspace_id,
                    request_id=request_id,
                    expected_version=str(expected_server_version) if expected_server_version is not None else None,
                    error=str(e),
                )
                raise HTTPException(status_code=502, detail="Apply failed")

            if _is_realtime_version_conflict(rt_result):
                metrics.incr("canvas.write.version_conflict", 1, operation="apply")
                canvas_gateway.logger.info(
                    "Canvas apply version conflict",
                    canvas_id=canvas_id,
                    workspace_id=workspace_id,
                    request_id=request_id,
                    expected_version=str(expected_server_version) if expected_server_version is not None else None,
                    current_server_version=_extract_server_version(rt_result),
                )
                raise HTTPException(
                    status_code=409,
                    detail=build_version_conflict_detail(
                        expected_server_version=expected_server_version,
                        current_server_version=_extract_server_version(rt_result),
                    ),
                )

            server_version = None
            updated_at = None
            if isinstance(rt_result, dict):
                server_version = rt_result.get("serverVersion") or rt_result.get("server_version")
                canvas_doc = rt_result.get("canvas")
                if isinstance(canvas_doc, dict):
                    updated_at = canvas_doc.get("updatedAt")
            try:
                await record_event(
                    canvas_events.canvas_updated(
                        canvas_id=canvas_id,
                        tenant_id=workspace_id,
                        actor_id=user_id,
                        payload={
                            "canvas_id": canvas_id,
                            "server_version": server_version,
                            "updated_at": updated_at,
                        },
                    ),
                    strict=False,
                )
            except Exception as exc:
                canvas_gateway.logger.warning(
                    "Canvas apply event record failed",
                    canvas_id=canvas_id,
                    workspace_id=workspace_id,
                    error=str(exc),
                )

            try:
                await AppendCollaborationOperationsUseCase(
                    SupabaseCollaborationRepository()
                ).execute(
                    session_id=session_id,
                    canvas_id=canvas_id,
                    workspace_id=workspace_id,
                    user_id=user_id,
                    operations=payload.operations,
                    idempotency_key=idempotency_key,
                )
            except Exception as exc:
                canvas_gateway.logger.warning(
                    f"collaboration ops append failed for canvas={canvas_id}: {exc}"
                )

            # Refresh the snapshot cache so GET /snapshot doesn't serve a stale
            # serverVersion for up to the TTL, which would make a recovering
            # client refetch the old version and 409 again on its next apply.
            try:
                if workspace_id and canvas_id:
                    fresh_doc = (
                        canvas_doc if isinstance(canvas_doc, dict) else None
                    )
                    if fresh_doc is not None:
                        # Mirror the top-level serverVersion onto the doc so the
                        # cached snapshot advertises the post-apply version.
                        if server_version is not None and fresh_doc.get("serverVersion") is None:
                            fresh_doc = {**fresh_doc, "serverVersion": server_version}
                        await canvas_gateway._set_cached_snapshot(
                            workspace_id, canvas_id, fresh_doc
                        )
                    else:
                        # Fresh doc not returned by realtime apply; invalidate so
                        # the next GET recomputes from the source of truth.
                        await canvas_gateway.cache_service.delete(
                            canvas_gateway._snapshot_cache_key(workspace_id, canvas_id)
                        )
            except Exception as exc:
                canvas_gateway.logger.warning(
                    f"snapshot cache refresh failed after apply for canvas={canvas_id}: {exc}"
                )

            return rt_result

        client = await canvas_gateway.utils.db.client
        tool = CanvasEditTool(thread_id=f"rest:apply:{user_id}", db_connection=canvas_gateway.utils.db)
        result = await tool.edit(
            canvas_id=canvas_id,
            operations=payload.operations,
            expected_version=expected_server_version,
            account_id_override=workspace_id,
            broadcast_canvas_ws=True,
            force_legacy_write=True,
            record_collaboration_ops=False,
        )
        if not result.success:
            msg = str(result.output) if isinstance(result.output, str) else (result.error or "Apply failed")
            if "Version conflict" in msg:
                raise HTTPException(
                    status_code=409,
                    detail=build_version_conflict_detail(
                        expected_server_version=expected_server_version,
                    ),
                )
            raise HTTPException(status_code=422, detail=msg)

        parsed_output: Any = result.output
        if isinstance(parsed_output, str):
            try:
                parsed_output = json.loads(parsed_output)
            except Exception:
                canvas_gateway.logger.warning("Canvas apply: 无法解析 CanvasEditTool 输出，原始字符串长度=%s", len(parsed_output))
                parsed_output = {}
        if not isinstance(parsed_output, dict):
            parsed_output = {}
        legacy_id_map = parsed_output.get("id_map")
        camel_id_map = parsed_output.get("idMap")
        if isinstance(legacy_id_map, dict) and not isinstance(camel_id_map, dict):
            parsed_output["idMap"] = legacy_id_map
        elif isinstance(camel_id_map, dict) and not isinstance(legacy_id_map, dict):
            parsed_output["id_map"] = camel_id_map

        new_doc = parsed_output.get("canvas") or {}
        raw_server_version = None
        if isinstance(new_doc, dict):
            raw_server_version = new_doc.get("serverVersion")
        server_version = raw_server_version if isinstance(raw_server_version, (int, float)) else None
        if server_version is None and not realtime_write_enabled:
            server_version = await canvas_gateway.bump_canvas_server_version(
                canvas_id,
                (new_doc or {}).get("updatedAt") if isinstance(new_doc, dict) else None,
            )
            if isinstance(new_doc, dict):
                new_doc["serverVersion"] = server_version

        if not realtime_write_enabled:
            try:
                changes = None
                if isinstance(new_doc, dict) and new_doc.get("id"):
                    changes = [
                        {
                            "entity": "canvas",
                            "action": "update",
                            "data": canvas_gateway._workspace_canvas_meta(new_doc),
                        }
                    ]
                await canvas_gateway.bump_workspace_version_and_broadcast(
                    workspace_id,
                    changes=changes,
                    actor_id=user_id,
                )
            except Exception as e:
                canvas_gateway.logger.warning(f"Failed to bump workspace version after canvas apply: {e}")

        try:
            timeline_enabled = False
            try:
                cres = (
                    await client.table("canvases")
                    .select("timeline_enabled")
                    .eq("id", canvas_id)
                    .eq("account_id", workspace_id)
                    .limit(1)
                    .execute()
                )
                row = (cres.data or [None])[0]
                timeline_enabled = bool(row.get("timeline_enabled", False)) if row else False
            except Exception:
                timeline_enabled = False

            if timeline_enabled:
                batch_id = str(uuid.uuid4())
                first_type = None
                try:
                    if isinstance(payload.operations, list) and payload.operations:
                        op0 = payload.operations[0]
                        if isinstance(op0, dict):
                            first_type = op0.get("type")
                except Exception:
                    pass
                ev = {
                    "canvas_id": canvas_id,
                    "account_id": workspace_id,
                    "user_id": user_id,
                    "batch_id": batch_id,
                    "seq": 0,
                    "op_type": first_type or "batch",
                    "op": {
                        "type": first_type or "batch",
                        "operations": payload.operations,
                    },
                    "doc_after": canvas_gateway._clean_canvas_doc_dict(
                        dict(new_doc) if isinstance(new_doc, dict) else new_doc
                    ),
                    "is_checkpoint": True,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                try:
                    await client.table("canvas_events").insert(ev).execute()
                except Exception as inner:
                    canvas_gateway.logger.debug(f"canvas_events insert skipped: {inner}")
                try:
                    vrow = {
                        "canvas_id": canvas_id,
                        "version_doc": canvas_gateway._clean_canvas_doc_dict(
                            dict(new_doc) if isinstance(new_doc, dict) else new_doc
                        ),
                        "is_auto_save": True,
                        "description": "AutoSave",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }
                    await client.table("canvas_versions").insert(vrow).execute()
                except Exception as inner2:
                    canvas_gateway.logger.debug(f"canvas_versions autosave skipped: {inner2}")
        except Exception as e:
            canvas_gateway.logger.warning(f"Canvas event logging error for {canvas_id}: {e}")

        try:
            if isinstance(new_doc, dict):
                await canvas_gateway._sync_canvas_file_links(client, canvas_id, workspace_id, new_doc)
        except Exception:
            pass

        try:
            if isinstance(new_doc, dict):
                await canvas_gateway.rebuild_canvas_search_index(canvas_id, workspace_id, doc=new_doc, client=client)
        except Exception as e:
            canvas_gateway.logger.warning(f"[search] index rebuild failed for canvas {canvas_id}: {e}")

        try:
            await AppendCollaborationOperationsUseCase(
                SupabaseCollaborationRepository()
            ).execute(
                session_id=session_id,
                canvas_id=canvas_id,
                workspace_id=workspace_id,
                user_id=user_id,
                operations=payload.operations,
                idempotency_key=idempotency_key,
            )
        except Exception as exc:
            canvas_gateway.logger.warning(
                f"collaboration ops append failed for canvas={canvas_id}: {exc}"
            )

        # Refresh the snapshot cache so GET /snapshot doesn't serve a stale
        # serverVersion for up to the TTL, which would make a recovering client
        # refetch the old version and 409 again on its next apply.
        try:
            if workspace_id and canvas_id:
                if isinstance(new_doc, dict) and new_doc.get("id"):
                    await canvas_gateway._set_cached_snapshot(
                        workspace_id, canvas_id, new_doc
                    )
                else:
                    # Fresh doc not available at this site; invalidate so the
                    # next GET recomputes from the source of truth.
                    await canvas_gateway.cache_service.delete(
                        canvas_gateway._snapshot_cache_key(workspace_id, canvas_id)
                    )
        except Exception as exc:
            canvas_gateway.logger.warning(
                f"snapshot cache refresh failed after apply for canvas={canvas_id}: {exc}"
            )

        return parsed_output or {}

    async def delete_canvas(
        self,
        *,
        canvas_id: str,
        request: Request,
        token: Optional[str],
    ) -> Any:
        canvas_gateway = self.deps.gateway
        user_id, workspace_id = await canvas_gateway._resolve_user_workspace(request, token)
        client = await canvas_gateway.utils.db.client
        try:
            await DeleteCanvasUseCase(SupabaseCanvasRepository()).execute(
                canvas_id=canvas_id,
                workspace_id=workspace_id,
                actor_id=user_id,
            )
            try:
                await canvas_gateway.delete_canvas_search_index(canvas_id, workspace_id, client=client)
            except Exception as e:
                canvas_gateway.logger.warning(f"[search] index delete failed for canvas {canvas_id}: {e}")
            try:
                await canvas_gateway.bump_workspace_version_and_broadcast(
                    workspace_id,
                    changes=[{"entity": "canvas", "action": "delete", "data": {"id": canvas_id}}],
                    actor_id=user_id,
                )
            except Exception as e:
                canvas_gateway.logger.warning(f"Failed to bump workspace version after canvas delete: {e}")
            try:
                await canvas_gateway.cache_service.delete(canvas_gateway._snapshot_cache_key(workspace_id, canvas_id))
            except Exception:
                pass
            await canvas_gateway._broadcast_canvas_update(workspace_id, canvas_id, user_id, status="deleted")
            return {"success": True}
        except Exception as e:
            canvas_gateway.logger.error(f"Error deleting canvas {canvas_id}: {e}")
            raise HTTPException(status_code=500, detail="Failed to delete canvas")

    async def restore_canvas_version(
        self,
        *,
        version_id: str,
        request: Request,
        token: Optional[str],
    ) -> Any:
        canvas_gateway = self.deps.gateway
        user_id, workspace_id = await canvas_gateway._resolve_user_workspace(request, token)
        request_id = extract_request_id(request.headers)
        idempotency_key = extract_idempotency_key(request.headers)
        session_id = extract_session_id(request.headers, fallback=f"rest:{user_id}")
        client = await canvas_gateway.utils.db.client
        try:
            vres = await client.table("canvas_versions").select("*").eq("id", version_id).limit(1).execute()
            if not vres.data:
                raise HTTPException(status_code=404, detail="Version not found")
            vrow = vres.data[0]
            canvas_id = vrow["canvas_id"]

            cres = (
                await client.table("canvases")
                .select("*")
                .eq("id", canvas_id)
                .eq("account_id", workspace_id)
                .eq("is_deleted", False)
                .limit(1)
                .execute()
            )
            if not cres.data:
                raise HTTPException(status_code=404, detail="Canvas not found")
            row = cres.data[0]
            base_doc = canvas_gateway._compose_doc(row).model_dump(mode="json", by_alias=True)
            base_canvas = Canvas(
                id=canvas_id,
                workspace_id=workspace_id,
                title=base_doc.get("title") or row.get("title") or "Untitled",
                version=base_doc.get("version") or row.get("version") or "1.0.0",
                doc=base_doc,
            )
            update_use_case = UpdateCanvasUseCase(SupabaseCanvasRepository())
            vdoc = vrow.get("version_doc") or {}
            try:
                doc = CanvasDoc.model_validate(vdoc)
            except Exception:
                doc = canvas_gateway._compose_doc(row)
            restored_payload = canvas_gateway._clean_canvas_doc_dict(doc.model_dump(mode="json", by_alias=True))
            restored_payload["updatedAt"] = canvas_gateway._now_ts()
            server_version: Optional[int] = None
            realtime_write_enabled = _realtime_write_enabled_for_workspace(
                canvas_gateway.config, workspace_id
            )
            metrics.incr(
                "canvas.write.path_selected",
                1,
                operation="restore_version",
                path_source="realtime" if realtime_write_enabled else "legacy",
            )
            if not realtime_write_enabled:
                server_version = await canvas_gateway.bump_canvas_server_version(
                    canvas_id,
                    restored_payload.get("serverVersion") or restored_payload.get("updatedAt"),
                )
                restored_payload["serverVersion"] = server_version

            expected_server_version: Optional[int] = None
            try:
                expected_server_version = canvas_gateway._compose_doc(row).serverVersion
            except Exception:
                expected_server_version = None

            if realtime_write_enabled:
                try:
                    write_service = CanvasWriteService()
                    rt_result = await write_service.import_canvas_snapshot(
                        canvas_id=canvas_id,
                        workspace_id=workspace_id,
                        doc=restored_payload,
                        expected_version=expected_server_version,
                        user_id=user_id,
                        idempotency_key=idempotency_key,
                        client_request_id=request_id,
                        client_session_id=session_id,
                    )
                    if _is_realtime_version_conflict(rt_result):
                        raise HTTPException(
                            status_code=409,
                            detail=build_version_conflict_detail(
                                expected_server_version=expected_server_version,
                                current_server_version=_extract_server_version(rt_result),
                            ),
                        )
                except HTTPException:
                    raise
                except CanvasRealtimeError as e:
                    canvas_gateway.logger.error(f"Error restoring version {version_id} via realtime: {e}")
                    detail = e.detail if isinstance(e.detail, dict) and e.detail else {
                        "message": e.message,
                        "code": e.code,
                    }
                    status_code = e.status_code if isinstance(e.status_code, int) and e.status_code >= 400 else 502
                    raise HTTPException(status_code=status_code, detail=detail)
                except Exception as e:
                    canvas_gateway.logger.error(f"Error restoring version {version_id} via realtime: {e}")
                    raise HTTPException(status_code=502, detail="Failed to restore canvas version")

                await update_use_case.execute(
                    canvas=base_canvas,
                    updates=restored_payload,
                    actor_id=user_id,
                    persist=False,
                    event_payload={
                        "restored_from_version_id": version_id,
                        "updated_at": restored_payload.get("updatedAt"),
                        "server_version": server_version,
                    },
                )

                latest_res = (
                    await client.table("canvases")
                    .select("*")
                    .eq("id", canvas_id)
                    .eq("account_id", workspace_id)
                    .eq("is_deleted", False)
                    .limit(1)
                    .execute()
                )
                latest_row = latest_res.data[0] if latest_res.data else row
                updated_doc = canvas_gateway._compose_doc(latest_row)
            else:
                saved_canvas = await update_use_case.execute(
                    canvas=base_canvas,
                    updates=restored_payload,
                    actor_id=user_id,
                    event_payload={
                        "restored_from_version_id": version_id,
                        "updated_at": restored_payload.get("updatedAt"),
                        "server_version": server_version,
                    },
                )
                updated_doc = CanvasDoc.model_validate(saved_canvas.doc)
                await canvas_gateway._broadcast_canvas_update(
                    workspace_id,
                    canvas_id,
                    user_id,
                    status="updated",
                    updated_at=updated_doc.updatedAt,
                )
            try:
                await canvas_gateway._sync_canvas_file_links(
                    client,
                    canvas_id,
                    workspace_id,
                    updated_doc.model_dump(mode="json", by_alias=True),
                )
            except Exception:
                pass
            try:
                await canvas_gateway._set_cached_snapshot(
                    workspace_id,
                    canvas_id,
                    updated_doc.model_dump(mode="json", by_alias=True),
                )
            except Exception:
                pass
            return updated_doc
        except HTTPException:
            raise
        except Exception as e:
            canvas_gateway.logger.error(f"Error restoring version {version_id}: {e}")
            raise HTTPException(status_code=500, detail="Failed to restore canvas version")

    async def restore_canvas(
        self,
        *,
        canvas_id: str,
        request: Request,
        token: Optional[str],
    ) -> Any:
        canvas_gateway = self.deps.gateway
        user_id, workspace_id = await canvas_gateway._resolve_user_workspace(request, token)
        client = await canvas_gateway.utils.db.client
        try:
            res = await client.table("canvases").select("*").eq("id", canvas_id).eq("account_id", workspace_id).limit(1).execute()
            if not res.data:
                raise HTTPException(status_code=404, detail="Canvas not found")
            row = res.data[0]
            if not row.get("is_deleted"):
                return canvas_gateway._compose_doc(row)
            restored = await RestoreCanvasUseCase(SupabaseCanvasRepository()).execute(
                canvas_id=canvas_id,
                workspace_id=workspace_id,
                actor_id=user_id,
            )
            try:
                restored_doc = CanvasDoc.model_validate(restored.doc)
            except Exception:
                restored_doc = canvas_gateway._compose_doc(
                    {
                        "id": restored.id,
                        "title": restored.title,
                        "version": restored.version,
                        "doc": restored.doc,
                    }
                )
            try:
                await canvas_gateway._set_cached_snapshot(
                    workspace_id,
                    canvas_id,
                    restored_doc.model_dump(mode="json", by_alias=True),
                )
            except Exception:
                pass
            try:
                change_data = canvas_gateway._workspace_canvas_meta(restored_doc.model_dump(mode="json", by_alias=True))
                await canvas_gateway.bump_workspace_version_and_broadcast(
                    workspace_id,
                    changes=[{"entity": "canvas", "action": "create", "data": change_data}],
                    actor_id=user_id,
                )
            except Exception as e:
                canvas_gateway.logger.warning(f"Failed to bump workspace version after canvas restore: {e}")
            await canvas_gateway._broadcast_canvas_update(
                workspace_id,
                canvas_id,
                user_id,
                status="restored",
                updated_at=restored_doc.updatedAt,
            )
            try:
                await canvas_gateway._sync_canvas_file_links(
                    client,
                    canvas_id,
                    workspace_id,
                    restored_doc.model_dump(mode="json", by_alias=True),
                )
            except Exception:
                pass
            try:
                await canvas_gateway.rebuild_canvas_search_index(
                    canvas_id,
                    workspace_id,
                    doc=restored_doc.model_dump(mode="json", by_alias=True),
                    client=client,
                )
            except Exception as e:
                canvas_gateway.logger.warning(f"[search] index rebuild failed for canvas {canvas_id}: {e}")
            return restored_doc
        except HTTPException:
            raise
        except Exception as e:
            canvas_gateway.logger.error(f"Error restoring canvas {canvas_id}: {e}")
            raise HTTPException(status_code=500, detail="Failed to restore canvas")

    async def save_canvas_version(
        self,
        *,
        canvas_id: str,
        payload: Any,
        request: Request,
        token: Optional[str],
    ) -> Any:
        return await self.legacy_handlers.save_canvas_version(
            canvas_id=canvas_id,
            payload=payload,
            request=request,
            token=token,
        )

    async def delete_canvas_version(
        self,
        *,
        version_id: str,
        request: Request,
        token: Optional[str],
    ) -> Any:
        return await self.legacy_handlers.delete_canvas_version(
            version_id=version_id,
            request=request,
            token=token,
        )

    async def purge_deleted_canvases(
        self,
        *,
        days: int,
        request: Request,
        token: Optional[str],
    ) -> Any:
        return await self.legacy_handlers.purge_deleted_canvases(
            days=days,
            request=request,
            token=token,
        )

    async def hard_delete_canvas(
        self,
        *,
        canvas_id: str,
        request: Request,
        token: Optional[str],
    ) -> Any:
        return await self.legacy_handlers.hard_delete_canvas(
            canvas_id=canvas_id,
            request=request,
            token=token,
        )

    async def restore_canvases_batch(
        self,
        *,
        payload: Dict[str, Any],
        request: Request,
        token: Optional[str],
    ) -> Any:
        return await self.legacy_handlers.restore_canvases_batch(
            payload=payload,
            request=request,
            token=token,
        )

    async def purge_canvases_by_ids(
        self,
        *,
        payload: Dict[str, Any],
        request: Request,
        token: Optional[str],
    ) -> Any:
        return await self.legacy_handlers.purge_canvases_by_ids(
            payload=payload,
            request=request,
            token=token,
        )

    async def ensure_thread_for_canvas(
        self,
        *,
        canvas_id: str,
        request: Request,
        token: Optional[str],
    ) -> Any:
        return await self.legacy_handlers.ensure_thread_for_canvas(
            canvas_id=canvas_id,
            request=request,
            token=token,
        )
