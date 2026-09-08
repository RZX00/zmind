from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, List
from unittest.mock import AsyncMock
import sys
import types

import pytest

from core.domains.automation.model import AutomationRun

# Keep tests isolated from optional runtime deps pulled by Supabase client imports.
try:
    import jwt  # noqa: F401
except Exception:  # pragma: no cover - fallback only when pyjwt is unavailable
    jwt_stub = types.ModuleType("jwt")
    jwt_stub.get_algorithm_by_name = lambda *_args, **_kwargs: None  # type: ignore[attr-defined]
    jwt_exceptions_stub = types.ModuleType("jwt.exceptions")
    jwt_exceptions_stub.PyJWTError = Exception  # type: ignore[attr-defined]
    jwt_stub.exceptions = jwt_exceptions_stub  # type: ignore[attr-defined]
    sys.modules["jwt"] = jwt_stub
    sys.modules["jwt.exceptions"] = jwt_exceptions_stub

from core.infrastructure.automation.supabase_automation_repository import SupabaseAutomationRepository


class _FakeQuery:
    def __init__(self, outcomes: List[Any]) -> None:
        self._outcomes = list(outcomes)

    def select(self, *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        return self

    def eq(self, *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        return self

    def limit(self, *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        return self

    def insert(self, *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        return self

    def update(self, *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        return self

    def order(self, *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        return self

    def range(self, *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        return self

    async def execute(self) -> SimpleNamespace:
        if not self._outcomes:
            raise AssertionError("No scripted outcome left for execute()")
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return SimpleNamespace(data=outcome)


class _FakeClient:
    def __init__(self, scripted_queries: List[List[Any]]) -> None:
        self._scripted_queries = [list(item) for item in scripted_queries]
        self.table_calls: List[str] = []

    def table(self, name: str) -> _FakeQuery:
        self.table_calls.append(name)
        if not self._scripted_queries:
            raise AssertionError(f"No scripted query left for table({name})")
        return _FakeQuery(self._scripted_queries.pop(0))


class _FakeDB:
    def __init__(self, client: _FakeClient) -> None:
        self._client = client

    @property
    async def client(self) -> _FakeClient:
        return self._client


def _provider_event_row() -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "provider_event_id": "evt_local_1",
        "account_id": "acc_1",
        "provider": "composio",
        "external_event_id": "evt_remote_1",
        "event_type": "gmail.email_received",
        "signature_valid": True,
        "dedupe_key": "dedupe_1",
        "payload": {"hello": "world"},
        "headers": {"webhook-id": "wid_1"},
        "processing_status": "received",
        "processing_error": None,
        "dispatched_at": None,
        "received_at": now,
        "created_at": now,
    }


@pytest.mark.asyncio
async def test_upsert_provider_event_returns_duplicate_for_existing_row() -> None:
    existing = _provider_event_row()
    client = _FakeClient(scripted_queries=[[[existing]]])
    repo = SupabaseAutomationRepository(db=_FakeDB(client))

    provider_event, duplicate = await repo.upsert_provider_event(
        provider="composio",
        dedupe_key="dedupe_1",
        payload={"hello": "world"},
        headers={"webhook-id": "wid_1"},
        external_event_id="evt_remote_1",
        event_type="gmail.email_received",
        account_id="acc_1",
        signature_valid=True,
    )

    assert duplicate is True
    assert provider_event.id == "evt_local_1"
    assert client.table_calls == ["provider_events"]


@pytest.mark.asyncio
async def test_upsert_provider_event_handles_unique_conflict_race() -> None:
    winner = _provider_event_row()
    client = _FakeClient(
        scripted_queries=[
            [[]],
            [RuntimeError("duplicate key value violates unique constraint")],
            [[winner]],
        ]
    )
    repo = SupabaseAutomationRepository(db=_FakeDB(client))

    provider_event, duplicate = await repo.upsert_provider_event(
        provider="composio",
        dedupe_key="dedupe_1",
        payload={"hello": "world"},
        headers={"webhook-id": "wid_1"},
        external_event_id="evt_remote_1",
        event_type="gmail.email_received",
        account_id="acc_1",
        signature_valid=True,
    )

    assert duplicate is True
    assert provider_event.dedupe_key == "dedupe_1"
    assert client.table_calls == ["provider_events", "provider_events", "provider_events"]


def test_row_to_automation_parses_json_and_defaults() -> None:
    row = {
        "automation_id": "auto_1",
        "account_id": "acc_1",
        "agent_id": None,
        "name": "Daily digest",
        "description": "sample",
        "trigger_type": "unknown",
        "provider": "composio",
        "provider_binding_key": "binding_1",
        "route_type": "unknown",
        "route_ref": None,
        "is_active": True,
        "config": '{"cron_expression":"0 * * * *"}',
        "created_by": "user_1",
        "created_at": "2026-02-20T10:00:00Z",
        "updated_at": "2026-02-20T10:00:00Z",
    }

    automation = SupabaseAutomationRepository._row_to_automation(row)

    assert automation.id == "auto_1"
    assert automation.trigger_type == "event"
    assert automation.route_type == "agent"
    assert automation.config["cron_expression"] == "0 * * * *"


@pytest.mark.asyncio
async def test_create_run_returns_duplicate_when_existing_found_before_insert() -> None:
    client = _FakeClient(scripted_queries=[])
    repo = SupabaseAutomationRepository(db=_FakeDB(client))
    existing_run = AutomationRun(
        id="run_1",
        automation_id="auto_1",
        account_id="acc_1",
        provider_event_id="evt_local_1",
        trigger_source="event",
        triggered_at=datetime.now(timezone.utc),
        status="queued",
        retry_count=0,
        max_retries=5,
        external_run_key=None,
        agent_run_id=None,
        error_code=None,
        error_message=None,
        metadata={},
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    repo._find_existing_run = AsyncMock(return_value=existing_run)  # type: ignore[attr-defined]

    run, duplicate = await repo.create_run(
        automation_id="auto_1",
        account_id="acc_1",
        trigger_source="event",
        provider_event_id="evt_local_1",
        external_run_key=None,
        status="queued",
        retry_count=0,
        max_retries=5,
        metadata={},
    )

    assert duplicate is True
    assert run.id == "run_1"
    assert client.table_calls == []
