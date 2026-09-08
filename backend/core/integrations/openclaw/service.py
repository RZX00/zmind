from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Iterable, Optional
from uuid import uuid4

from fastapi import HTTPException, Request

from core.application.event_bus import record_event
from core.docs.api_models import UndoDocRevisionRequest, UpdateDocRequest
from core.domains.openclaw import events as openclaw_events
from core.services.supabase import DBConnection


OPENCLAW_SOURCE = "openclaw"
HEADER_SOURCE = "X-ZMind-Integration-Source"
HEADER_CLIENT = "X-ZMind-Integration-Client"
HEADER_TOOL = "X-ZMind-Integration-Tool"
HEADER_REQUEST_ID = "X-Client-Request-Id"

VALID_ROLES = ("owner", "member")
VALID_CAPABILITIES = (
    "canvas.read",
    "canvas.create",
    "canvas.write",
    "doc.read",
    "doc.create",
    "doc.write",
    "rollback.execute",
)
DEFAULT_ALLOWED_ROLES = ("owner",)
DEFAULT_ALLOWED_CAPABILITIES = (
    "canvas.read",
    "canvas.create",
    "canvas.write",
    "doc.read",
    "doc.create",
    "doc.write",
    "rollback.execute",
)
ROLLBACK_STATUS_AVAILABLE = "available"
ROLLBACK_STATUS_COMPLETED = "completed"
ROLLBACK_STATUS_FAILED = "failed"
ROLLBACK_STATUS_NOT_SUPPORTED = "not_supported"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _dedupe_ordered(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized


def sanitize_role_list(values: Optional[Iterable[Any]]) -> list[str]:
    normalized: list[str] = []
    for value in values or []:
        role = str(value or "").strip().lower()
        if role in VALID_ROLES:
            normalized.append(role)
    result = _dedupe_ordered(normalized)
    return result or list(DEFAULT_ALLOWED_ROLES)


def sanitize_capability_list(values: Optional[Iterable[Any]]) -> list[str]:
    normalized: list[str] = []
    for value in values or []:
        capability = str(value or "").strip().lower()
        if capability in VALID_CAPABILITIES:
            normalized.append(capability)
    result = _dedupe_ordered(normalized)
    return result or list(DEFAULT_ALLOWED_CAPABILITIES)


def extract_openclaw_context(request: Request) -> Optional[dict[str, Optional[str]]]:
    source = str(request.headers.get(HEADER_SOURCE) or "").strip().lower()
    if source != OPENCLAW_SOURCE:
        return None
    client = str(request.headers.get(HEADER_CLIENT) or "").strip() or None
    tool_name = str(request.headers.get(HEADER_TOOL) or "").strip() or None
    request_id = str(request.headers.get(HEADER_REQUEST_ID) or "").strip() or None
    return {
        "source": source,
        "client": client,
        "tool_name": tool_name,
        "request_id": request_id,
    }


def normalize_settings_row(
    row: Optional[dict[str, Any]],
    *,
    workspace_id: Optional[str] = None,
    workspace_role: Optional[str] = None,
) -> dict[str, Any]:
    data = row or {}
    return {
        "workspace_id": str(data.get("workspace_id") or workspace_id or ""),
        "enabled": bool(data.get("enabled", False)),
        "allowed_roles": sanitize_role_list(data.get("allowed_roles")),
        "allowed_capabilities": sanitize_capability_list(data.get("allowed_capabilities")),
        "linked_at": data.get("linked_at"),
        "linked_by": data.get("linked_by"),
        "last_verified_at": data.get("last_verified_at"),
        "last_verified_by": data.get("last_verified_by"),
        "created_at": data.get("created_at"),
        "updated_at": data.get("updated_at"),
        "updated_by": data.get("updated_by"),
        "metadata": data.get("metadata") or {},
        "workspace_role": workspace_role,
    }


def normalize_activity_row(row: Optional[dict[str, Any]]) -> dict[str, Any]:
    data = row or {}
    rollback_payload = data.get("rollback_payload") if isinstance(data.get("rollback_payload"), dict) else None
    rollback_status = str(data.get("rollback_status") or ROLLBACK_STATUS_NOT_SUPPORTED)
    return {
        "id": str(data.get("id") or ""),
        "workspace_id": str(data.get("workspace_id") or ""),
        "actor_id": data.get("actor_id"),
        "client": data.get("client"),
        "tool_name": data.get("tool_name"),
        "operation_key": data.get("operation_key"),
        "resource_type": data.get("resource_type"),
        "resource_id": data.get("resource_id"),
        "status": data.get("status") or "succeeded",
        "summary": data.get("summary"),
        "request_id": data.get("request_id"),
        "metadata": data.get("metadata") or {},
        "rollback_payload": rollback_payload,
        "rollback_status": rollback_status,
        "rollback_error": data.get("rollback_error"),
        "created_at": data.get("created_at"),
        "rolled_back_at": data.get("rolled_back_at"),
        "rolled_back_by": data.get("rolled_back_by"),
        "can_rollback": rollback_payload is not None and rollback_status != ROLLBACK_STATUS_COMPLETED,
    }


class OpenClawIntegrationService:
    async def _get_client(self):
        return await DBConnection().client

    async def get_workspace_role(self, *, user_id: str, workspace_id: str) -> str:
        if str(user_id) == str(workspace_id):
            return "owner"
        client = await self._get_client()
        result = (
            await client.schema("basejump")
            .table("account_user")
            .select("account_role")
            .eq("user_id", user_id)
            .eq("account_id", workspace_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=403, detail="You do not have access to this workspace")
        role = str(result.data[0].get("account_role") or "").strip().lower()
        if role not in VALID_ROLES:
            raise HTTPException(status_code=403, detail="Your workspace role is not recognized")
        return role

    async def get_settings(self, *, workspace_id: str, workspace_role: Optional[str] = None) -> dict[str, Any]:
        client = await self._get_client()
        result = (
            await client.table("openclaw_workspace_settings")
            .select("*")
            .eq("workspace_id", workspace_id)
            .limit(1)
            .execute()
        )
        row = result.data[0] if result.data else None
        return normalize_settings_row(row, workspace_id=workspace_id, workspace_role=workspace_role)

    async def get_state(self, *, workspace_id: str, user_id: str) -> dict[str, Any]:
        workspace_role = await self.get_workspace_role(user_id=user_id, workspace_id=workspace_id)
        settings = await self.get_settings(workspace_id=workspace_id, workspace_role=workspace_role)
        client = await self._get_client()
        latest_activity_res = (
            await client.table("openclaw_activity_log")
            .select("*")
            .eq("workspace_id", workspace_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        recent_since = (_now_utc() - timedelta(days=7)).isoformat()
        recent_count_res = (
            await client.table("openclaw_activity_log")
            .select("id", count="exact")
            .eq("workspace_id", workspace_id)
            .gte("created_at", recent_since)
            .execute()
        )
        rollback_pending_res = (
            await client.table("openclaw_activity_log")
            .select("id", count="exact")
            .eq("workspace_id", workspace_id)
            .eq("rollback_status", ROLLBACK_STATUS_AVAILABLE)
            .execute()
        )
        return {
            "settings": settings,
            "stats": {
                "recent_activity_count": int(recent_count_res.count or 0),
                "pending_rollbacks": int(rollback_pending_res.count or 0),
                "last_activity": normalize_activity_row(latest_activity_res.data[0]) if latest_activity_res.data else None,
            },
        }

    async def ensure_management_access(self, *, user_id: str, workspace_id: str, capability: str = "rollback.execute") -> dict[str, Any]:
        role = await self.get_workspace_role(user_id=user_id, workspace_id=workspace_id)
        if role != "owner":
            raise HTTPException(status_code=403, detail="Only workspace owners can manage the OpenClaw bridge")
        settings = await self.get_settings(workspace_id=workspace_id, workspace_role=role)
        if capability and capability not in settings["allowed_capabilities"]:
            raise HTTPException(status_code=403, detail="OpenClaw rollback is currently turned off for this workspace")
        return settings

    async def update_settings(
        self,
        *,
        workspace_id: str,
        user_id: str,
        enabled: bool,
        allowed_roles: Optional[Iterable[Any]],
        allowed_capabilities: Optional[Iterable[Any]],
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        role = await self.get_workspace_role(user_id=user_id, workspace_id=workspace_id)
        if role != "owner":
            raise HTTPException(status_code=403, detail="Only workspace owners can change OpenClaw access")

        current = await self.get_settings(workspace_id=workspace_id, workspace_role=role)
        now_iso = _now_utc().isoformat()
        next_row: dict[str, Any] = {
            "workspace_id": workspace_id,
            "enabled": bool(enabled),
            "allowed_roles": sanitize_role_list(allowed_roles),
            "allowed_capabilities": sanitize_capability_list(allowed_capabilities),
            "metadata": metadata or current.get("metadata") or {},
            "updated_at": now_iso,
            "updated_by": user_id,
        }
        if next_row["enabled"] and not current.get("linked_at"):
            next_row["linked_at"] = now_iso
            next_row["linked_by"] = user_id
        elif current.get("linked_at"):
            next_row["linked_at"] = current.get("linked_at")
            next_row["linked_by"] = current.get("linked_by")

        client = await self._get_client()
        await client.table("openclaw_workspace_settings").upsert(next_row).execute()

        payload = {
            "enabled": next_row["enabled"],
            "allowed_roles": next_row["allowed_roles"],
            "allowed_capabilities": next_row["allowed_capabilities"],
        }
        await record_event(
            openclaw_events.openclaw_settings_updated(
                workspace_id=workspace_id,
                actor_id=user_id,
                payload=payload,
            )
        )
        return await self.get_settings(workspace_id=workspace_id, workspace_role=role)

    async def touch_verified(self, *, workspace_id: str, user_id: str) -> None:
        client = await self._get_client()
        current = await self.get_settings(workspace_id=workspace_id)
        now_iso = _now_utc().isoformat()
        update_row: dict[str, Any] = {
            "workspace_id": workspace_id,
            "last_verified_at": now_iso,
            "last_verified_by": user_id,
            "updated_at": now_iso,
            "updated_by": user_id,
            "enabled": bool(current.get("enabled")),
            "allowed_roles": current.get("allowed_roles") or list(DEFAULT_ALLOWED_ROLES),
            "allowed_capabilities": current.get("allowed_capabilities") or list(DEFAULT_ALLOWED_CAPABILITIES),
            "metadata": current.get("metadata") or {},
        }
        if not current.get("linked_at") and current.get("enabled"):
            update_row["linked_at"] = now_iso
            update_row["linked_by"] = user_id
        elif current.get("linked_at"):
            update_row["linked_at"] = current.get("linked_at")
            update_row["linked_by"] = current.get("linked_by")
        await client.table("openclaw_workspace_settings").upsert(update_row).execute()

    async def ensure_request_allowed(
        self,
        *,
        request: Request,
        user_id: str,
        workspace_id: str,
        capability: str,
    ) -> Optional[dict[str, Optional[str]]]:
        context = extract_openclaw_context(request)
        if not context:
            return None

        workspace_role = await self.get_workspace_role(user_id=user_id, workspace_id=workspace_id)
        settings = await self.get_settings(workspace_id=workspace_id, workspace_role=workspace_role)

        if not settings["enabled"]:
            raise HTTPException(
                status_code=403,
                detail="OpenClaw is not enabled for this workspace yet",
            )
        if workspace_role not in settings["allowed_roles"]:
            raise HTTPException(
                status_code=403,
                detail="Your workspace role is not allowed to use OpenClaw here",
            )
        if capability not in settings["allowed_capabilities"]:
            raise HTTPException(
                status_code=403,
                detail="OpenClaw does not have permission for this action in this workspace",
            )
        return context

    async def list_activity(
        self,
        *,
        workspace_id: str,
        user_id: str,
        limit: int = 20,
    ) -> dict[str, Any]:
        workspace_role = await self.get_workspace_role(user_id=user_id, workspace_id=workspace_id)
        _ = workspace_role
        client = await self._get_client()
        result = (
            await client.table("openclaw_activity_log")
            .select("*", count="exact")
            .eq("workspace_id", workspace_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        items = [normalize_activity_row(row) for row in (result.data or [])]
        return {
            "items": items,
            "total": int(result.count or len(items)),
        }

    async def record_activity(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        operation_key: str,
        resource_type: str,
        resource_id: str,
        summary: str,
        metadata: Optional[dict[str, Any]] = None,
        rollback_payload: Optional[dict[str, Any]] = None,
        request: Optional[Request] = None,
        status: str = "succeeded",
    ) -> dict[str, Any]:
        context = extract_openclaw_context(request) if request else None
        row = {
            "id": f"ocl_{uuid4().hex}",
            "workspace_id": workspace_id,
            "actor_id": actor_id,
            "client": context.get("client") if context else None,
            "tool_name": context.get("tool_name") if context else None,
            "operation_key": operation_key,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "status": status,
            "summary": summary,
            "request_id": context.get("request_id") if context else None,
            "metadata": metadata or {},
            "rollback_payload": rollback_payload,
            "rollback_status": (
                ROLLBACK_STATUS_AVAILABLE if isinstance(rollback_payload, dict) else ROLLBACK_STATUS_NOT_SUPPORTED
            ),
            "created_at": _now_utc().isoformat(),
        }
        client = await self._get_client()
        await client.table("openclaw_activity_log").insert(row).execute()
        await self.touch_verified(workspace_id=workspace_id, user_id=actor_id)
        await record_event(
            openclaw_events.openclaw_activity_recorded(
                activity_id=row["id"],
                workspace_id=workspace_id,
                actor_id=actor_id,
                payload={
                    "operation_key": operation_key,
                    "resource_type": resource_type,
                    "resource_id": resource_id,
                    "summary": summary,
                    "status": status,
                },
            )
        )
        return normalize_activity_row(row)

    async def rollback_activity(
        self,
        *,
        activity_id: str,
        request: Request,
        token: Optional[str] = None,
    ) -> dict[str, Any]:
        from core.docs.service import DocsService
        from core.interfaces.http.canvas.service_bindings import get_canvas_command_service
        from core.items.service import ItemsService
        from core.utils.auth_utils import resolve_user_and_workspace

        user_id, workspace_id = await resolve_user_and_workspace(request, token)
        await self.ensure_management_access(user_id=user_id, workspace_id=workspace_id)

        client = await self._get_client()
        result = (
            await client.table("openclaw_activity_log")
            .select("*")
            .eq("id", activity_id)
            .eq("workspace_id", workspace_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="OpenClaw activity not found")

        row = result.data[0]
        activity = normalize_activity_row(row)
        rollback_payload = activity["rollback_payload"]
        if not isinstance(rollback_payload, dict):
            raise HTTPException(status_code=422, detail="This activity cannot be rolled back automatically")
        if activity["rollback_status"] == ROLLBACK_STATUS_COMPLETED:
            raise HTTPException(status_code=409, detail="This OpenClaw activity has already been rolled back")

        request_id = str(request.headers.get(HEADER_REQUEST_ID) or f"rollback_{uuid4().hex}")
        docs_service = DocsService()
        items_service = ItemsService()
        canvas_command_service = get_canvas_command_service()

        try:
            kind = str(rollback_payload.get("kind") or "").strip()
            if kind == "canvas.restore_version":
                rollback_result = await canvas_command_service.restore_canvas_version(
                    version_id=str(rollback_payload["version_id"]),
                    request=request,
                    token=token,
                )
            elif kind == "canvas.delete":
                rollback_result = await canvas_command_service.delete_canvas(
                    canvas_id=str(rollback_payload["canvas_id"]),
                    request=request,
                    token=token,
                )
            elif kind == "item.delete":
                await items_service.delete_item(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    item_id=str(rollback_payload["item_id"]),
                    client_request_id=request_id,
                )
                rollback_result = {"success": True}
            elif kind == "doc.undo_revision":
                rollback_result = await docs_service.undo_doc_revision(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    item_id=str(rollback_payload["item_id"]),
                    revision_id=str(rollback_payload["revision_id"]),
                    payload=UndoDocRevisionRequest(
                        expectedCurrentVersion=rollback_payload.get("expected_current_version"),
                        summary=f"Rollback OpenClaw activity {activity_id}",
                        actorType="agent",
                        actorId=user_id,
                        metadata={
                            "source": "openclaw_rollback",
                            "activityId": activity_id,
                        },
                    ),
                    client_request_id=request_id,
                )
            elif kind == "doc.restore_content":
                expected_current_version = rollback_payload.get("expected_current_version")
                rollback_result = await docs_service.update_doc(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    item_id=str(rollback_payload["item_id"]),
                    payload=UpdateDocRequest(
                        contentMd=str(rollback_payload.get("content_md") or ""),
                        frontmatter=rollback_payload.get("frontmatter") or {},
                    ),
                    if_match=str(expected_current_version) if expected_current_version else None,
                    client_request_id=request_id,
                )
            else:
                raise HTTPException(status_code=422, detail="This OpenClaw rollback type is not supported yet")

            now_iso = _now_utc().isoformat()
            await client.table("openclaw_activity_log").update(
                {
                    "status": "rolled_back",
                    "rollback_status": ROLLBACK_STATUS_COMPLETED,
                    "rollback_error": None,
                    "rolled_back_at": now_iso,
                    "rolled_back_by": user_id,
                }
            ).eq("id", activity_id).execute()

            await self.record_activity(
                workspace_id=workspace_id,
                actor_id=user_id,
                operation_key="rollback.execute",
                resource_type=str(activity["resource_type"] or "integration_activity"),
                resource_id=str(activity["resource_id"] or activity_id),
                summary=f"Rolled back {activity['operation_key']}",
                metadata={
                    "activity_id": activity_id,
                    "rolled_back_operation_key": activity["operation_key"],
                },
                rollback_payload=None,
                request=None,
                status="succeeded",
            )
            await record_event(
                openclaw_events.openclaw_activity_rolled_back(
                    activity_id=activity_id,
                    workspace_id=workspace_id,
                    actor_id=user_id,
                    payload={
                        "rolled_back_operation_key": activity["operation_key"],
                        "resource_type": activity["resource_type"],
                        "resource_id": activity["resource_id"],
                    },
                )
            )
            latest = (
                await client.table("openclaw_activity_log")
                .select("*")
                .eq("id", activity_id)
                .limit(1)
                .execute()
            )
            return {
                "activity": normalize_activity_row(latest.data[0] if latest.data else row),
                "result": rollback_result,
            }
        except HTTPException as exc:
            await client.table("openclaw_activity_log").update(
                {
                    "rollback_status": ROLLBACK_STATUS_FAILED,
                    "rollback_error": str(exc.detail),
                }
            ).eq("id", activity_id).execute()
            raise
        except Exception as exc:
            await client.table("openclaw_activity_log").update(
                {
                    "rollback_status": ROLLBACK_STATUS_FAILED,
                    "rollback_error": str(exc),
                }
            ).eq("id", activity_id).execute()
            raise


@lru_cache(maxsize=1)
def get_openclaw_integration_service() -> OpenClawIntegrationService:
    return OpenClawIntegrationService()
