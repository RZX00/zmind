from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple
from datetime import datetime, timezone

import httpx
import jwt
import orjson

from core.services import redis as redis_service
from core.utils.config import config
from core.utils.logger import logger
from core.workspace.service import WORKSPACE_UPDATES_CHANNEL


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


class CanvasRealtimeError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: Optional[str] = None,
        status_code: Optional[int] = None,
        detail: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.detail = detail or {}


def _extract_realtime_error(resp: httpx.Response) -> Tuple[Optional[str], str, Optional[Dict[str, Any]]]:
    detail: Optional[Dict[str, Any]] = None
    code: Optional[str] = None
    message: Optional[str] = None
    try:
        payload = resp.json()
    except Exception:
        payload = None
    if isinstance(payload, dict):
        detail = payload
        err = payload.get("error")
        if isinstance(err, dict):
            code = err.get("code") or payload.get("code")
            message = err.get("message") or payload.get("message")
        elif isinstance(err, str):
            code = payload.get("code") or err
            message = payload.get("message") or err
        else:
            code = payload.get("code")
            message = payload.get("message")
    if not message:
        try:
            message = resp.text
        except Exception:
            message = f"Realtime request failed: {resp.status_code}"
    return code, message or f"Realtime request failed: {resp.status_code}", detail


def _normalize_apply_payload(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    id_map = payload.get("id_map")
    id_map_camel = payload.get("idMap")
    if isinstance(id_map_camel, dict) and not isinstance(id_map, dict):
        payload["id_map"] = id_map_camel
        id_map = id_map_camel
    if isinstance(id_map, dict) and not isinstance(id_map_camel, dict):
        payload["idMap"] = id_map
    return payload

CANVAS_WS_CHANNEL = "canvas:updates:{canvas_id}"


class CanvasWriteService:
    """Centralize canvas doc broadcasts (workspace update + doc-sync + realtime import).

    Provides a single best-effort sync entrypoint with graceful degradation so callers
    don't have to juggle multiple pub/sub and realtime concerns.
    """

    def __init__(self, realtime_url: Optional[str] = None) -> None:
        self._realtime_url = (
            realtime_url
            or os.getenv("CANVAS_REALTIME_INTERNAL_URL")
            or os.getenv("CANVAS_REALTIME_URL")
            or "http://canvas-realtime:6020"
        ).rstrip("/")

    def _build_service_token(
        self,
        workspace_id: str,
        user_id: Optional[str] = None,
    ) -> str:
        if not config.SUPABASE_JWT_SECRET:
            raise RuntimeError("SUPABASE_JWT_SECRET not configured for realtime apply")
        payload = {
            "sub": user_id or workspace_id,
            "role": "service",
            "workspaceId": workspace_id,
            "workspace_id": workspace_id,
            "aud": "authenticated",
            "app_metadata": {
                "actor": "service",
                "roles": ["service"],
            },
        }
        return jwt.encode(payload, config.SUPABASE_JWT_SECRET, algorithm="HS256")

    async def _publish_workspace_update(
        self,
        workspace_id: str,
        canvas_id: str,
        updated_by: str,
        updated_at: int,
        server_version: Optional[int],
    ) -> None:
        payload = {
            "type": "canvas_updated",
            "canvasId": canvas_id,
            "workspaceId": workspace_id,
            "updatedBy": updated_by,
            "updatedAt": updated_at,
            "status": "updated",
            "serverVersion": server_version,
        }
        channel = WORKSPACE_UPDATES_CHANNEL.format(workspace_id=workspace_id)
        await redis_service.publish(channel, orjson.dumps(payload).decode("utf-8"))

    async def _publish_doc_sync(
        self,
        canvas_id: str,
        workspace_id: str,
        doc: Dict[str, Any],
        updated_at: int,
        server_version: Optional[int],
    ) -> None:
        payload = {
            "type": "doc-sync",
            "canvasId": canvas_id,
            "doc": doc,
            "updatedAt": updated_at,
            "serverVersion": server_version,
            "workspaceId": workspace_id,
        }
        channel = CANVAS_WS_CHANNEL.format(canvas_id=canvas_id)
        await redis_service.publish(channel, orjson.dumps(payload).decode("utf-8"))

    async def _push_realtime_snapshot(
        self,
        canvas_id: str,
        workspace_id: str,
        doc: Dict[str, Any],
        user_id: Optional[str],
        expected_version: Optional[str] = None,
    ) -> None:
        """Best-effort push latest doc into realtime service."""
        if not self._realtime_url:
            return
        if not config.SUPABASE_JWT_SECRET:
            raise RuntimeError("SUPABASE_JWT_SECRET not configured for realtime import")
        token = self._build_service_token(workspace_id, user_id=user_id)
        import_url = f"{self._realtime_url}/import?canvasId={canvas_id}&workspaceId={workspace_id}"
        headers = {"Authorization": f"Bearer {token}"}
        if expected_version is not None:
            headers["If-Match"] = str(expected_version)
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                import_url,
                json={"doc": doc},
                headers=headers,
            )

    async def sync_canvas_doc(
        self,
        *,
        canvas_id: str,
        workspace_id: str,
        doc: Dict[str, Any],
        updated_by: str,
        updated_at: Optional[int],
        server_version: Optional[int],
    ) -> Dict[str, Any]:
        """Publish canvas updates to workspace channel, doc-sync channel, and realtime.

        Returns sync_status ('ok'|'degraded') and accumulated warnings.
        """
        warnings: list[str] = []
        status = "ok"
        ts = updated_at or _now_ms()

        # realtime import
        try:
            await self._push_realtime_snapshot(
                canvas_id,
                workspace_id,
                doc,
                user_id=None,
                expected_version=server_version,
            )
        except Exception as e:
            warnings.append(f"realtime import failed: {e}")
            logger.debug(f"CanvasWriteService realtime failed for {canvas_id}: {e}")
            status = "degraded"

        # doc-sync
        try:
            await self._publish_doc_sync(canvas_id, workspace_id, doc, ts, server_version)
        except Exception as e:
            warnings.append(f"doc-sync publish failed: {e}")
            logger.warning(f"CanvasWriteService doc-sync failed for {canvas_id}: {e}")
            status = "degraded"

        # workspace update
        try:
            await self._publish_workspace_update(workspace_id, canvas_id, updated_by, ts, server_version)
        except Exception as e:
            warnings.append(f"workspace update publish failed: {e}")
            logger.warning(f"CanvasWriteService workspace publish failed for {canvas_id}: {e}")
            status = "degraded"

        return {"sync_status": status, "warnings": warnings}

    async def apply_canvas_ops(
        self,
        *,
        canvas_id: str,
        workspace_id: str,
        operations: list[Dict[str, Any]],
        expected_version: Optional[str] = None,
        user_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        client_request_id: Optional[str] = None,
        client_session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not self._realtime_url:
            raise RuntimeError("Realtime URL not configured for apply")
        token = self._build_service_token(workspace_id, user_id=user_id)
        url = (
            f"{self._realtime_url}/apply?canvasId={canvas_id}&workspaceId={workspace_id}"
        )
        headers = {"Authorization": f"Bearer {token}"}
        if expected_version is not None:
            headers["If-Match"] = str(expected_version)
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        if client_request_id:
            headers["X-Client-Request-Id"] = client_request_id
        if client_session_id:
            headers["X-Client-Session-Id"] = client_session_id

        payload = {
            "canvasId": canvas_id,
            "workspaceId": workspace_id,
            "operations": operations,
            "actor": "service",
        }
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code == 409:
            code, message, detail = _extract_realtime_error(resp)
            payload = detail if isinstance(detail, dict) else {}
            if "error" not in payload:
                payload["error"] = {
                    "code": code or "version_conflict",
                    "message": message,
                }
                payload["code"] = code or "version_conflict"
                payload["message"] = message
            payload.setdefault("status_code", 409)
            return _normalize_apply_payload(payload)
        if resp.status_code >= 400:
            code, message, detail = _extract_realtime_error(resp)
            raise CanvasRealtimeError(
                message,
                code=code,
                status_code=resp.status_code,
                detail=detail,
            )
        try:
            return _normalize_apply_payload(resp.json())
        except Exception:
            raise CanvasRealtimeError(
                "Realtime apply returned invalid JSON",
                code="invalid_response",
                status_code=resp.status_code,
            )

    async def import_canvas_snapshot(
        self,
        *,
        canvas_id: str,
        workspace_id: str,
        doc: Dict[str, Any],
        expected_version: Optional[str] = None,
        user_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        client_request_id: Optional[str] = None,
        client_session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not self._realtime_url:
            raise RuntimeError("Realtime URL not configured for import")
        token = self._build_service_token(workspace_id, user_id=user_id)
        url = (
            f"{self._realtime_url}/import?canvasId={canvas_id}&workspaceId={workspace_id}"
        )
        headers = {"Authorization": f"Bearer {token}"}
        if expected_version is not None:
            headers["If-Match"] = str(expected_version)
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        if client_request_id:
            headers["X-Client-Request-Id"] = client_request_id
        if client_session_id:
            headers["X-Client-Session-Id"] = client_session_id

        payload = {
            "canvasId": canvas_id,
            "workspaceId": workspace_id,
            "doc": doc,
            "actor": "service",
        }
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code == 409:
            code, message, detail = _extract_realtime_error(resp)
            payload = detail if isinstance(detail, dict) else {}
            if "error" not in payload:
                payload["error"] = {
                    "code": code or "version_conflict",
                    "message": message,
                }
                payload["code"] = code or "version_conflict"
                payload["message"] = message
            payload.setdefault("status_code", 409)
            return payload
        if resp.status_code >= 400:
            code, message, detail = _extract_realtime_error(resp)
            raise CanvasRealtimeError(
                message,
                code=code,
                status_code=resp.status_code,
                detail=detail,
            )
        try:
            return resp.json()
        except Exception:
            raise CanvasRealtimeError(
                "Realtime import returned invalid JSON",
                code="invalid_response",
                status_code=resp.status_code,
            )

    async def fetch_canvas_snapshot(
        self,
        *,
        canvas_id: str,
        workspace_id: str,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not self._realtime_url:
            raise RuntimeError("Realtime URL not configured for snapshot")
        token = self._build_service_token(workspace_id, user_id=user_id)
        url = f"{self._realtime_url}/snapshot?canvasId={canvas_id}&workspaceId={workspace_id}"
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            raise RuntimeError(f"Realtime snapshot failed: {resp.status_code} {resp.text}")
        try:
            return resp.json()
        except Exception:
            raise RuntimeError("Realtime snapshot returned invalid JSON")
