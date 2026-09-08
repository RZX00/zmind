"""
Projects 的 REST 端点。

为什么新增：前端原本用 supabase-js 直连 PostgREST 读写 projects 表（lib/api.ts 里
10 处 `.from('projects')`）。去 supabase-js 化之后，这些查询必须走后端，所以这里
把当时靠 RLS 保证的访问控制，改成在服务端显式校验 workspace 归属。

安全性说明：RLS 之前是前端直连时的唯一防线；现在后端用 service_role 语义连库
（BYPASSRLS），所以每个端点都必须自己校验 account_id 归属——不能依赖 RLS 兜底。
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from core.utils.auth_utils import (
    verify_and_get_user_id_from_jwt,
    resolve_user_and_workspace,
)
from core.utils.logger import logger
from . import core_utils as utils

router = APIRouter()


class ProjectCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    account_id: Optional[str] = None


class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None


async def _assert_workspace_member(client, account_id: str, user_id: str) -> None:
    """确认 user_id 有权访问 account_id 这个工作区。

    个人账户：basejump.accounts.primary_owner_user_id == user_id
    团队账户：basejump.account_user 里有 (account_id, user_id) 记录
    """
    owner = await client.schema("basejump").table("accounts") \
        .select("primary_owner_user_id").eq("id", account_id).limit(1).execute()
    if owner.data and owner.data[0].get("primary_owner_user_id") == user_id:
        return

    member = await client.schema("basejump").table("account_user") \
        .select("user_id").eq("account_id", account_id).eq("user_id", user_id).limit(1).execute()
    if member.data:
        return

    raise HTTPException(status_code=403, detail="No access to this workspace")


@router.get("/projects")
async def list_projects(
    request: Request,
    account_id: Optional[str] = Query(None, description="工作区 ID，缺省用当前解析出的工作区"),
    user_id: str = Depends(verify_and_get_user_id_from_jwt),
):
    client = await utils.db.client
    if not account_id:
        _, account_id = await resolve_user_and_workspace(request)
    await _assert_workspace_member(client, account_id, user_id)

    result = await client.table("projects").select("*") \
        .eq("account_id", account_id).order("created_at", desc=True).execute()
    return result.data or []


@router.get("/projects/{project_id}")
async def get_project(
    project_id: str,
    user_id: str = Depends(verify_and_get_user_id_from_jwt),
):
    client = await utils.db.client
    result = await client.table("projects").select("*").eq("project_id", project_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")
    project = result.data[0]
    await _assert_workspace_member(client, project["account_id"], user_id)
    return project


@router.post("/projects")
async def create_project(
    payload: ProjectCreateRequest,
    request: Request,
    user_id: str = Depends(verify_and_get_user_id_from_jwt),
):
    client = await utils.db.client
    account_id = payload.account_id
    if not account_id:
        _, account_id = await resolve_user_and_workspace(request)
    await _assert_workspace_member(client, account_id, user_id)

    result = await client.table("projects").insert({
        "name": payload.name,
        "description": payload.description or None,
        "account_id": account_id,
    }).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create project")
    logger.info(f"Created project {result.data[0].get('project_id')} in {account_id}")
    return result.data[0]


@router.patch("/projects/{project_id}")
async def update_project(
    project_id: str,
    payload: ProjectUpdateRequest,
    user_id: str = Depends(verify_and_get_user_id_from_jwt),
):
    client = await utils.db.client
    existing = await client.table("projects").select("account_id").eq("project_id", project_id).limit(1).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Project not found")
    await _assert_workspace_member(client, existing.data[0]["account_id"], user_id)

    changes = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not changes:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = await client.table("projects").update(changes).eq("project_id", project_id).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update project")
    return result.data[0]


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    user_id: str = Depends(verify_and_get_user_id_from_jwt),
):
    client = await utils.db.client
    existing = await client.table("projects").select("account_id").eq("project_id", project_id).limit(1).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Project not found")
    await _assert_workspace_member(client, existing.data[0]["account_id"], user_id)

    await client.table("projects").delete().eq("project_id", project_id).execute()
    return {"success": True, "project_id": project_id}


@router.get("/me/roles")
async def my_roles(user_id: str = Depends(verify_and_get_user_id_from_jwt)):
    """当前用户的角色。

    前端 3 处直接查 user_roles 表判断是否管理员（侧边栏、画布浮动按钮、消息区）。
    这类判断放在前端直查是危险的——改成由服务端给出结论。
    """
    client = await utils.db.client
    result = await client.table("user_roles").select("role").eq("user_id", user_id).execute()
    roles = [r["role"] for r in (result.data or []) if r.get("role")]
    hierarchy = {"user": 0, "admin": 1, "super_admin": 2}
    highest = max(roles, key=lambda r: hierarchy.get(r, -1)) if roles else None
    return {
        "roles": roles,
        "role": highest,
        "is_admin": any(hierarchy.get(r, -1) >= 1 for r in roles),
        "is_super_admin": any(hierarchy.get(r, -1) >= 2 for r in roles),
    }


@router.get("/public-canvases")
async def list_public_canvases(
    limit: int = Query(24, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """公开画布列表（首页/探索页用）。

    读的是 public_canvases_v1 视图，无需登录——原本前端用 anon key 直查，
    现在改由后端提供，前端不必再持有直连数据库的能力。
    """
    client = await utils.db.client
    result = await client.table("public_canvases_v1").select("*") \
        .order("listed_at", desc=True).range(offset, offset + limit - 1).execute()
    return result.data or []
