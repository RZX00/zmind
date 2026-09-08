from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import HTTPException

from core.utils.logger import structlog


@dataclass(frozen=True)
class RuntimeAccessContext:
    runtime_ref: str
    runtime_mode: str
    project_id: str
    account_id: str
    is_public: bool
    project_data: Dict[str, Any]


async def resolve_runtime_context_by_project_ref(client: Any, runtime_ref: str) -> RuntimeAccessContext:
    ref = str(runtime_ref or "").strip()
    if not ref:
        raise HTTPException(status_code=400, detail="Runtime reference is required")

    result = (
        await client.table("projects")
        .select("*")
        .eq("project_id", ref)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Runtime not found")

    project_data = dict(result.data[0])
    project_id = str(project_data.get("project_id") or "")
    account_id = str(project_data.get("account_id") or "")
    if not project_id or not account_id:
        raise HTTPException(status_code=500, detail="Project runtime metadata is incomplete")

    return RuntimeAccessContext(
        runtime_ref=ref,
        runtime_mode="cloud",
        project_id=project_id,
        account_id=account_id,
        is_public=bool(project_data.get("is_public", False)),
        project_data=project_data,
    )


def _with_runtime_metadata(context: RuntimeAccessContext) -> Dict[str, Any]:
    payload = dict(context.project_data)
    payload["runtime"] = {
        "mode": context.runtime_mode,
        "runtime_ref": context.runtime_ref,
    }
    return payload


async def verify_runtime_access(
    client: Any,
    runtime_ref: str,
    *,
    user_id: Optional[str],
    allow_anonymous_public: bool,
) -> Dict[str, Any]:
    context = await resolve_runtime_context_by_project_ref(client, runtime_ref)

    structlog.get_logger().debug(
        "runtime_access_check",
        runtime_ref=context.runtime_ref,
        project_id=context.project_id,
        account_id=context.account_id,
        is_public=context.is_public,
        user_id=user_id,
    )

    if context.is_public:
        if allow_anonymous_public or user_id:
            return _with_runtime_metadata(context)
        raise HTTPException(status_code=401, detail="Authentication required for this private project")

    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required for this private project")

    account_user_result = (
        await client.schema("basejump")
        .from_("account_user")
        .select("account_role")
        .eq("user_id", user_id)
        .eq("account_id", context.account_id)
        .execute()
    )
    if account_user_result.data and len(account_user_result.data) > 0:
        return _with_runtime_metadata(context)

    raise HTTPException(status_code=403, detail="Not authorized to access this project runtime")

