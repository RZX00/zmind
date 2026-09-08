from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from core.auth import require_admin
from core.services.supabase import DBConnection
from core.utils.pagination import PaginationService, PaginationParams, PaginatedResponse


router = APIRouter(prefix="/admin/audit", tags=["admin-audit"])


class AuditEvent(BaseModel):
    event_id: str
    event_type: str
    schema_version: int
    occurred_at: datetime
    aggregate_id: str
    aggregate_type: str
    tenant_id: Optional[str] = None
    actor_id: Optional[str] = None
    payload: dict
    ingested_at: datetime


class ProjectionFailure(BaseModel):
    projection_name: str
    event_id: str
    event_type: str
    schema_version: int
    occurred_at: datetime
    aggregate_id: str
    aggregate_type: str
    tenant_id: Optional[str] = None
    actor_id: Optional[str] = None
    payload: dict
    failure_count: int
    first_failed_at: datetime
    last_failed_at: datetime
    last_error: Optional[str] = None


class ProjectionLagSnapshot(BaseModel):
    projection_name: str
    last_processed_at: Optional[datetime] = None
    lag_seconds: Optional[float] = None


class AuditSLOSnapshot(BaseModel):
    captured_at: datetime
    outbox_pending_count: int
    outbox_oldest_pending_at: Optional[datetime] = None
    outbox_oldest_pending_lag_seconds: Optional[float] = None
    projection_failures_total: int
    projection_failures_by_projection: Dict[str, int]
    projection_lag: list[ProjectionLagSnapshot]


@router.get("/events", response_model=PaginatedResponse[AuditEvent])
async def list_audit_events(
    event_type: Optional[str] = Query(None),
    aggregate_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    actor_id: Optional[str] = Query(None),
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    _: dict = Depends(require_admin),
) -> PaginatedResponse[AuditEvent]:
    db = DBConnection()
    client = await db.client

    query = client.table("event_audit").select(
        "event_id,event_type,schema_version,occurred_at,aggregate_id,aggregate_type,tenant_id,actor_id,payload,ingested_at"
    )
    count_query = client.table("event_audit").select("event_id", count="exact")

    if event_type:
        query = query.eq("event_type", event_type)
        count_query = count_query.eq("event_type", event_type)
    if aggregate_id:
        query = query.eq("aggregate_id", aggregate_id)
        count_query = count_query.eq("aggregate_id", aggregate_id)
    if tenant_id:
        query = query.eq("tenant_id", tenant_id)
        count_query = count_query.eq("tenant_id", tenant_id)
    if actor_id:
        query = query.eq("actor_id", actor_id)
        count_query = count_query.eq("actor_id", actor_id)
    if since:
        query = query.gte("occurred_at", since.isoformat())
        count_query = count_query.gte("occurred_at", since.isoformat())
    if until:
        query = query.lte("occurred_at", until.isoformat())
        count_query = count_query.lte("occurred_at", until.isoformat())

    query = query.order("occurred_at", desc=True)

    params = PaginationParams(page=page, page_size=page_size)
    return await PaginationService.paginate_database_query(query, params, count_query=count_query)


@router.get("/failures", response_model=PaginatedResponse[ProjectionFailure])
async def list_projection_failures(
    projection_name: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    _: dict = Depends(require_admin),
) -> PaginatedResponse[ProjectionFailure]:
    db = DBConnection()
    client = await db.client

    query = client.table("projection_failures").select(
        "projection_name,event_id,event_type,schema_version,occurred_at,aggregate_id,aggregate_type,tenant_id,actor_id,payload,failure_count,first_failed_at,last_failed_at,last_error"
    )
    count_query = client.table("projection_failures").select("event_id", count="exact")

    if projection_name:
        query = query.eq("projection_name", projection_name)
        count_query = count_query.eq("projection_name", projection_name)
    if event_type:
        query = query.eq("event_type", event_type)
        count_query = count_query.eq("event_type", event_type)
    if tenant_id:
        query = query.eq("tenant_id", tenant_id)
        count_query = count_query.eq("tenant_id", tenant_id)
    if since:
        query = query.gte("last_failed_at", since.isoformat())
        count_query = count_query.gte("last_failed_at", since.isoformat())
    if until:
        query = query.lte("last_failed_at", until.isoformat())
        count_query = count_query.lte("last_failed_at", until.isoformat())

    query = query.order("last_failed_at", desc=True)

    params = PaginationParams(page=page, page_size=page_size)
    return await PaginationService.paginate_database_query(query, params, count_query=count_query)


@router.get("/slo", response_model=AuditSLOSnapshot)
async def get_audit_slo_snapshot(
    _: dict = Depends(require_admin),
) -> AuditSLOSnapshot:
    db = DBConnection()
    client = await db.client
    now = datetime.now(timezone.utc)

    pending_count_res = (
        await client.table("domain_outbox")
        .select("event_id", count="exact")
        .is_("published_at", "null")
        .execute()
    )
    outbox_pending_count = int(pending_count_res.count or 0)

    oldest_pending_res = (
        await client.table("domain_outbox")
        .select("occurred_at")
        .is_("published_at", "null")
        .order("occurred_at", desc=False)
        .limit(1)
        .execute()
    )
    outbox_oldest_pending_at: Optional[datetime] = None
    outbox_oldest_pending_lag_seconds: Optional[float] = None
    if oldest_pending_res.data:
        raw = oldest_pending_res.data[0].get("occurred_at")
        try:
            outbox_oldest_pending_at = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            outbox_oldest_pending_lag_seconds = max(
                0.0, (now - outbox_oldest_pending_at).total_seconds()
            )
        except Exception:
            outbox_oldest_pending_at = None
            outbox_oldest_pending_lag_seconds = None

    offsets_res = (
        await client.table("projection_offsets")
        .select("projection_name,last_processed_at")
        .order("projection_name", desc=False)
        .execute()
    )
    projection_lag: list[ProjectionLagSnapshot] = []
    for row in offsets_res.data or []:
        projection_name = str(row.get("projection_name") or "")
        if not projection_name:
            continue
        raw_ts = row.get("last_processed_at")
        parsed_ts: Optional[datetime] = None
        lag_seconds: Optional[float] = None
        try:
            if raw_ts:
                parsed_ts = datetime.fromisoformat(str(raw_ts).replace("Z", "+00:00"))
                lag_seconds = max(0.0, (now - parsed_ts).total_seconds())
        except Exception:
            parsed_ts = None
            lag_seconds = None
        projection_lag.append(
            ProjectionLagSnapshot(
                projection_name=projection_name,
                last_processed_at=parsed_ts,
                lag_seconds=lag_seconds,
            )
        )

    failures_total_res = (
        await client.table("projection_failures")
        .select("event_id", count="exact")
        .execute()
    )
    projection_failures_total = int(failures_total_res.count or 0)

    projection_failures_by_projection: Dict[str, int] = {}
    for item in projection_lag:
        count_res = (
            await client.table("projection_failures")
            .select("event_id", count="exact")
            .eq("projection_name", item.projection_name)
            .execute()
        )
        projection_failures_by_projection[item.projection_name] = int(count_res.count or 0)

    return AuditSLOSnapshot(
        captured_at=now,
        outbox_pending_count=outbox_pending_count,
        outbox_oldest_pending_at=outbox_oldest_pending_at,
        outbox_oldest_pending_lag_seconds=outbox_oldest_pending_lag_seconds,
        projection_failures_total=projection_failures_total,
        projection_failures_by_projection=projection_failures_by_projection,
        projection_lag=projection_lag,
    )
