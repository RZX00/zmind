from __future__ import annotations

from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.application.use_cases.automation import (
    CreateAutomationUseCase,
    QueueAutomationRunUseCase,
)
from core.infrastructure.automation.supabase_automation_repository import (
    SupabaseAutomationRepository,
)
from core.utils.auth_utils import verify_and_get_user_id_from_jwt
from .background_jobs import dispatch_scheduled_automations, execute_automation_run


router = APIRouter(prefix="/automations", tags=["automations"])


db: Optional[Any] = None


def initialize(database: Any) -> None:
    global db
    db = database


class AutomationCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    trigger_type: str = Field(pattern="^(schedule|event)$")
    provider: Optional[str] = None
    provider_binding_key: Optional[str] = None
    route_type: str = Field(default="agent", pattern="^(agent|workflow)$")
    route_ref: Optional[str] = None
    agent_id: Optional[str] = None
    is_active: bool = True
    config: Dict[str, Any] = Field(default_factory=dict)


class AutomationUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    provider: Optional[str] = None
    provider_binding_key: Optional[str] = None
    route_type: Optional[str] = Field(default=None, pattern="^(agent|workflow)$")
    route_ref: Optional[str] = None
    agent_id: Optional[str] = None
    is_active: Optional[bool] = None
    config: Optional[Dict[str, Any]] = None


class AutomationToggleRequest(BaseModel):
    is_active: bool


class AutomationTestFireRequest(BaseModel):
    payload: Dict[str, Any] = Field(default_factory=dict)


def _repo() -> SupabaseAutomationRepository:
    return SupabaseAutomationRepository(db=db)


@router.get("")
async def list_automations(
    trigger_type: Optional[str] = None,
    is_active: Optional[bool] = None,
    limit: int = 100,
    offset: int = 0,
    current_user_id: str = Depends(verify_and_get_user_id_from_jwt),
) -> Dict[str, Any]:
    repo = _repo()
    items = await repo.list_automations(
        account_id=current_user_id,
        trigger_type=trigger_type,
        is_active=is_active,
        limit=max(1, min(limit, 200)),
        offset=max(0, offset),
    )
    return {
        "success": True,
        "items": [item.__dict__ for item in items],
        "count": len(items),
    }


@router.post("")
async def create_automation(
    request: AutomationCreateRequest,
    current_user_id: str = Depends(verify_and_get_user_id_from_jwt),
) -> Dict[str, Any]:
    if request.route_type == "agent" and not request.agent_id:
        raise HTTPException(status_code=400, detail="agent_id is required when route_type=agent")
    if request.trigger_type == "event" and not request.provider:
        raise HTTPException(status_code=400, detail="provider is required when trigger_type=event")

    use_case = CreateAutomationUseCase(_repo())
    automation = await use_case.execute(
        account_id=current_user_id,
        agent_id=request.agent_id,
        name=request.name,
        description=request.description,
        trigger_type=request.trigger_type,
        provider=request.provider,
        provider_binding_key=request.provider_binding_key,
        route_type=request.route_type,
        route_ref=request.route_ref,
        is_active=request.is_active,
        config=request.config,
        actor_id=current_user_id,
    )
    return {"success": True, "item": automation.__dict__}


@router.get("/{automation_id}")
async def get_automation(
    automation_id: str,
    current_user_id: str = Depends(verify_and_get_user_id_from_jwt),
) -> Dict[str, Any]:
    item = await _repo().get_automation(automation_id, account_id=current_user_id)
    if not item:
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"success": True, "item": item.__dict__}


@router.patch("/{automation_id}")
async def update_automation(
    automation_id: str,
    request: AutomationUpdateRequest,
    current_user_id: str = Depends(verify_and_get_user_id_from_jwt),
) -> Dict[str, Any]:
    patch = request.model_dump(exclude_none=True)
    updated = await _repo().update_automation(
        automation_id=automation_id,
        account_id=current_user_id,
        patch=patch,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"success": True, "item": updated.__dict__}


@router.delete("/{automation_id}")
async def delete_automation(
    automation_id: str,
    current_user_id: str = Depends(verify_and_get_user_id_from_jwt),
) -> Dict[str, Any]:
    deleted = await _repo().delete_automation(
        automation_id=automation_id,
        account_id=current_user_id,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"success": True}


@router.post("/{automation_id}/toggle")
async def toggle_automation(
    automation_id: str,
    request: AutomationToggleRequest,
    current_user_id: str = Depends(verify_and_get_user_id_from_jwt),
) -> Dict[str, Any]:
    updated = await _repo().update_automation(
        automation_id=automation_id,
        account_id=current_user_id,
        patch={"is_active": request.is_active},
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"success": True, "item": updated.__dict__}


@router.post("/{automation_id}/test-fire")
async def test_fire_automation(
    automation_id: str,
    request: AutomationTestFireRequest,
    current_user_id: str = Depends(verify_and_get_user_id_from_jwt),
) -> Dict[str, Any]:
    repo = _repo()
    automation = await repo.get_automation(automation_id, account_id=current_user_id)
    if not automation:
        raise HTTPException(status_code=404, detail="Automation not found")

    external_run_key = f"manual:{uuid4()}"
    run, duplicate = await QueueAutomationRunUseCase(repo).execute(
        automation_id=automation.id,
        account_id=current_user_id,
        trigger_source="manual",
        provider_event_id=None,
        external_run_key=external_run_key,
        retry_count=0,
        max_retries=int((automation.config or {}).get("max_retries") or 5),
        metadata={
            "test_fire": True,
            "payload": request.payload,
        },
        actor_id=current_user_id,
    )
    if not duplicate:
        execute_automation_run.send(run_id=run.id)

    return {
        "success": True,
        "run_id": run.id,
        "duplicate": duplicate,
    }


@router.get("/{automation_id}/runs")
async def list_automation_runs(
    automation_id: str,
    limit: int = 50,
    offset: int = 0,
    current_user_id: str = Depends(verify_and_get_user_id_from_jwt),
) -> Dict[str, Any]:
    repo = _repo()
    automation = await repo.get_automation(automation_id, account_id=current_user_id)
    if not automation:
        raise HTTPException(status_code=404, detail="Automation not found")

    runs = await repo.list_runs(
        automation_id=automation_id,
        limit=max(1, min(limit, 200)),
        offset=max(0, offset),
    )
    return {
        "success": True,
        "items": [run.__dict__ for run in runs],
        "count": len(runs),
    }


@router.get("/runs/{run_id}")
async def get_automation_run(
    run_id: str,
    current_user_id: str = Depends(verify_and_get_user_id_from_jwt),
) -> Dict[str, Any]:
    run = await _repo().get_run(run_id)
    if not run or run.account_id != current_user_id:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"success": True, "item": run.__dict__}


@router.get("/runs/{run_id}/attempts")
async def get_run_attempts(
    run_id: str,
    current_user_id: str = Depends(verify_and_get_user_id_from_jwt),
) -> Dict[str, Any]:
    repo = _repo()
    run = await repo.get_run(run_id)
    if not run or run.account_id != current_user_id:
        raise HTTPException(status_code=404, detail="Run not found")
    attempts = await repo.list_run_attempts(run_id=run_id)
    return {
        "success": True,
        "items": [attempt.__dict__ for attempt in attempts],
        "count": len(attempts),
    }


@router.post("/internal/schedule/tick")
async def schedule_tick(
    current_user_id: str = Depends(verify_and_get_user_id_from_jwt),
) -> Dict[str, Any]:
    # User-scoped manual tick for operational safety.
    dispatch_scheduled_automations.send(account_id=current_user_id)
    return {
        "success": True,
        "queued": True,
        "account_id": current_user_id,
    }
