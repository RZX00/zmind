from __future__ import annotations

import asyncio
import importlib
from datetime import datetime, timezone
from typing import Dict, List, Optional, Protocol

from core.services import metrics
from core.services.supabase import DBConnection
from core.domains.shared.events import DomainEvent
from core.domains.shared.event_registry import get_schema_version, validate_event_type
from core.domains.shared.event_upcasters import needs_upcast, upcast_payload
from core.utils.logger import logger


class ProjectionHandler(Protocol):
    name: str
    async def handle(self, event: DomainEvent) -> None:
        ...


_EVENT_REGISTRY_MODULES = (
    "core.domains.canvas.events",
    "core.domains.agent.events",
    "core.domains.collaboration.events",
    "core.domains.sharing.events",
    "core.domains.knowledge.events",
    "core.domains.marketplace.events",
    "core.domains.automation.events",
    "core.domains.billing.events",
    "core.domains.workspace.events",
)


def _bootstrap_event_registry() -> None:
    for module_path in _EVENT_REGISTRY_MODULES:
        try:
            importlib.import_module(module_path)
        except Exception as exc:
            logger.warning(
                "projection.event_registry_bootstrap_failed",
                module=module_path,
                error=str(exc),
            )


def _parse_iso_dt(value: object) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _is_after_cursor(
    event_occurred_at: datetime,
    event_id: str,
    cursor_occurred_at: datetime,
    cursor_event_id: Optional[str],
) -> bool:
    if event_occurred_at > cursor_occurred_at:
        return True
    if event_occurred_at < cursor_occurred_at:
        return False
    # Backward compatibility: old offsets may not have event_id.
    # Preserve old behavior (strictly greater timestamp) until cursor is upgraded.
    if not cursor_event_id:
        return False
    return event_id > cursor_event_id


def _is_unregistered_event_error(exc: Exception) -> bool:
    return isinstance(exc, ValueError) and "event_type not registered" in str(exc)


class ProjectionWorker:
    def __init__(self, db: Optional[DBConnection] = None) -> None:
        _bootstrap_event_registry()
        self._db = db or DBConnection()
        self._handlers: Dict[str, ProjectionHandler] = {}

    def register(self, handler: ProjectionHandler) -> None:
        self._handlers[handler.name] = handler

    async def _get_cursor(self, projection_name: str) -> tuple[datetime, Optional[str]]:
        client = await self._db.client
        res = (
            await client.table("projection_offsets")
            .select("last_processed_at,last_event_id")
            .eq("projection_name", projection_name)
            .limit(1)
            .execute()
        )
        if res.data:
            raw = res.data[0].get("last_processed_at")
            event_id = res.data[0].get("last_event_id")
            try:
                return _parse_iso_dt(raw), str(event_id) if event_id else None
            except Exception:
                pass
        return datetime.fromtimestamp(0, tz=timezone.utc), None

    async def _set_cursor(
        self,
        projection_name: str,
        ts: datetime,
        event_id: Optional[str],
    ) -> None:
        client = await self._db.client
        await client.table("projection_offsets").upsert(
            {
                "projection_name": projection_name,
                "last_processed_at": ts.isoformat(),
                "last_event_id": event_id,
            },
            on_conflict="projection_name",
        ).execute()

    async def _record_failure(self, projection_name: str, row: dict, error: str) -> None:
        client = await self._db.client
        event_id = row.get("event_id")
        if not event_id:
            return
        now = datetime.now(timezone.utc).isoformat()
        existing = (
            await client.table("projection_failures")
            .select("failure_count, first_failed_at")
            .eq("projection_name", projection_name)
            .eq("event_id", event_id)
            .limit(1)
            .execute()
        )
        failure_count = 0
        first_failed_at = now
        if existing.data:
            row_existing = existing.data[0] or {}
            failure_count = int(row_existing.get("failure_count") or 0)
            first_failed_at = row_existing.get("first_failed_at") or now
        failure_count += 1

        payload = {
            "projection_name": projection_name,
            "event_id": event_id,
            "event_type": row.get("event_type"),
            "schema_version": row.get("schema_version"),
            "occurred_at": row.get("occurred_at"),
            "aggregate_id": row.get("aggregate_id"),
            "aggregate_type": row.get("aggregate_type"),
            "tenant_id": row.get("tenant_id"),
            "actor_id": row.get("actor_id"),
            "payload": row.get("payload") or {},
            "failure_count": failure_count,
            "first_failed_at": first_failed_at,
            "last_failed_at": now,
            "last_error": error,
        }
        await client.table("projection_failures").upsert(
            payload, on_conflict="projection_name,event_id"
        ).execute()

    def _build_event(self, row: dict) -> DomainEvent:
        event_type = str(row.get("event_type"))
        schema_version = int(row.get("schema_version") or 1)
        payload = row.get("payload") or {}
        expected = get_schema_version(event_type)
        if expected is None:
            raise ValueError(f"event_type not registered: {event_type}")
        if schema_version != expected:
            if schema_version > expected:
                raise ValueError(
                    f"event_type {event_type} schema_version newer than expected: {schema_version} > {expected}"
                )
            if needs_upcast(event_type, schema_version):
                schema_version, payload = upcast_payload(
                    event_type, schema_version, payload
                )
            if schema_version != expected:
                raise ValueError(
                    f"event_type {event_type} schema_version mismatch after upcast: {schema_version} != {expected}"
                )
        validate_event_type(event_type, schema_version)
        return DomainEvent(
            event_id=str(row.get("event_id")),
            event_type=event_type,
            schema_version=schema_version,
            occurred_at=_parse_iso_dt(row.get("occurred_at")),
            aggregate_id=str(row.get("aggregate_id")),
            aggregate_type=str(row.get("aggregate_type")),
            tenant_id=row.get("tenant_id"),
            actor_id=row.get("actor_id"),
            payload=payload,
        )

    async def run_once(self, projection_name: str, limit: int = 200) -> int:
        if projection_name not in self._handlers:
            return 0
        cursor_ts, cursor_event_id = await self._get_cursor(projection_name)
        client = await self._db.client
        res = (
            await client.table("domain_outbox")
            .select("event_id,event_type,schema_version,occurred_at,aggregate_id,aggregate_type,tenant_id,actor_id,payload")
            .gte("occurred_at", cursor_ts.isoformat())
            .order("occurred_at", desc=False)
            .order("event_id", desc=False)
            .limit(limit)
            .execute()
        )
        source_rows = res.data or []
        if not source_rows:
            return 0
        rows: List[dict] = []
        for row in source_rows:
            try:
                row_ts = _parse_iso_dt(row.get("occurred_at"))
                row_event_id = str(row.get("event_id") or "")
            except Exception:
                continue
            if _is_after_cursor(row_ts, row_event_id, cursor_ts, cursor_event_id):
                rows.append(row)
        if not rows:
            return 0
        handler = self._handlers[projection_name]
        last_ts = cursor_ts
        last_event_id = cursor_event_id
        skipped_unregistered = 0
        failed_rows = 0
        for row in rows:
            row_event_id = str(row.get("event_id") or "")
            try:
                row_ts = _parse_iso_dt(row.get("occurred_at"))
            except Exception:
                row_ts = last_ts
            try:
                event = self._build_event(row)
                await handler.handle(event)
                last_ts = event.occurred_at
                last_event_id = event.event_id
            except Exception as exc:
                if _is_unregistered_event_error(exc):
                    last_ts = row_ts
                    last_event_id = row_event_id
                    skipped_unregistered += 1
                    logger.debug(
                        "projection.skip_unregistered_event",
                        projection=projection_name,
                        event_id=row_event_id,
                        event_type=row.get("event_type"),
                    )
                    continue
                await self._record_failure(projection_name, row, str(exc))
                failed_rows += 1
                logger.warning("projection.handle_failed", projection=projection_name, error=str(exc))
        await self._set_cursor(projection_name, last_ts, last_event_id)
        lag_sec = max(0.0, (datetime.now(timezone.utc) - last_ts).total_seconds())
        metrics.incr(
            "projection.rows_processed",
            len(rows),
            projection=projection_name,
        )
        if skipped_unregistered:
            metrics.incr(
                "projection.rows_skipped_unregistered",
                skipped_unregistered,
                projection=projection_name,
            )
        if failed_rows:
            metrics.incr(
                "projection.rows_failed",
                failed_rows,
                projection=projection_name,
            )
        metrics.gauge(
            "projection.lag_seconds",
            lag_sec,
            projection=projection_name,
        )
        return len(rows)

    async def run_forever(self, projection_name: str, interval_sec: float = 2.0) -> None:
        while True:
            processed = await self.run_once(projection_name)
            if processed == 0:
                await asyncio.sleep(interval_sec)
