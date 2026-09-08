from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from core.langgraph_engine.billing.billing_guard import BillingGuard
from core.langgraph_engine.persistence.message_writer import MessageWriter, MessageWriterError
from core.utils.config import EnvMode, config


class FakeUniqueViolation(Exception):
    code = "23505"

    def __init__(self, message: str = "duplicate key value violates unique constraint"):
        super().__init__(message)


class FakeResult:
    def __init__(self, data: Any):
        self.data = data


class FakeRPCBuilder:
    def __init__(self, client: "FakeSupabaseClient", fn: str, params: dict[str, Any]):
        self._client = client
        self._fn = fn
        self._params = params

    async def execute(self) -> FakeResult:
        return FakeResult([self._client._handle_rpc(self._fn, self._params)])


class FakeTableQuery:
    def __init__(self, client: "FakeSupabaseClient", table: str):
        self._client = client
        self._table = table
        self._action: str | None = None
        self._row: dict[str, Any] | None = None
        self._filters: dict[str, Any] = {}
        self._limit: int | None = None

    def insert(self, row: dict[str, Any]) -> "FakeTableQuery":
        self._action = "insert"
        self._row = row
        return self

    def select(self, _fields: str) -> "FakeTableQuery":
        self._action = "select"
        return self

    def eq(self, field: str, value: Any) -> "FakeTableQuery":
        self._filters[field] = value
        return self

    def limit(self, n: int) -> "FakeTableQuery":
        self._limit = n
        return self

    async def execute(self) -> FakeResult:
        if self._table != "messages":
            raise NotImplementedError(self._table)

        if self._action == "insert":
            assert self._row is not None
            stored = self._client._insert_message_row(self._row)
            return FakeResult([stored])

        if self._action == "select":
            key = self._filters.get("message_dedup_key")
            if not key:
                return FakeResult([])
            row = self._client._messages_by_dedup.get(str(key))
            if row is None:
                return FakeResult([])
            return FakeResult([row])

        raise NotImplementedError(self._action)


class FakeSupabaseClient:
    def __init__(self):
        self._messages_by_dedup: dict[str, dict[str, Any]] = {}
        self._generated_message_id = 0

        self._billing_seen: dict[str, str] = {}
        self._billing_deduct_count = 0
        self._balance = Decimal("1.00")

        self.rpc_call_count = 0

    def table(self, name: str) -> FakeTableQuery:
        return FakeTableQuery(self, name)

    def rpc(self, fn: str, params: dict[str, Any]) -> FakeRPCBuilder:
        self.rpc_call_count += 1
        return FakeRPCBuilder(self, fn, params)

    def _insert_message_row(self, row: dict[str, Any]) -> dict[str, Any]:
        dedup = row.get("message_dedup_key")
        assert isinstance(dedup, str) and dedup
        if dedup in self._messages_by_dedup:
            raise FakeUniqueViolation()

        if not row.get("message_id"):
            self._generated_message_id += 1
            row = {**row, "message_id": f"generated-{self._generated_message_id}"}

        self._messages_by_dedup[dedup] = dict(row)
        return dict(row)

    def _handle_rpc(self, fn: str, params: dict[str, Any]) -> dict[str, Any]:
        assert fn == "deduct_credits_idempotent"
        key = str(params["p_billing_dedup_key"])
        amount = Decimal(str(params["p_amount"]))

        if key in self._billing_seen:
            return {
                "success": True,
                "duplicate": True,
                "new_balance": str(self._balance),
                "transaction_id": self._billing_seen[key],
                "error": None,
            }

        self._billing_deduct_count += 1
        self._balance -= amount
        tx = f"tx-{self._billing_deduct_count}"
        self._billing_seen[key] = tx

        return {
            "success": True,
            "duplicate": False,
            "new_balance": str(self._balance),
            "transaction_id": tx,
            "error": None,
        }


def _state(*, is_shadow: bool = False) -> dict[str, Any]:
    return {
        "agent_run_id": "run-1",
        "thread_id": "thread-1",
        "project_id": None,
        "account_id": "account-1",
        "model_name": "unknown",
        "enable_thinking": False,
        "reasoning_effort": "low",
        "enable_context_manager": True,
        "enable_prompt_caching": True,
        "agent_config": None,
        "messages_context": [],
        "session_index": 3,
        "iteration": 0,
        "max_iterations": 10,
        "pending_tool_calls": [],
        "tool_results": [],
        "termination": {"should_terminate": False, "reason": "running"},
        "checkpoint_id": None,
        "checkpoint_thread_id": "run-1",
        "engine": "langgraph",
        "engine_version": "v1",
        "is_shadow": is_shadow,
        "shadow_parent_run_id": None,
        "side_effect_policy": "allow_all",
    }


@pytest.mark.unit
@pytest.mark.asyncio
async def test_billing_guard_deduct_once_is_idempotent(monkeypatch: pytest.MonkeyPatch):
    fake = FakeSupabaseClient()

    monkeypatch.setattr(config, "ENV_MODE", EnvMode.PRODUCTION)
    guard = BillingGuard(client_getter=lambda: fake)

    event = {
        "type": "llm_response_end",
        "timestamp": "2025-01-01T00:00:00Z",
        "agent_run_id": "run-1",
        "thread_id": "thread-1",
        "thread_run_id": "tr-1",
        "message_id": "msg-1",
        "llm_response_id": "llm-1",
        "model": "unknown",
        "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        "finish_reason": "stop",
    }

    r1 = await guard.deduct_once(_state(is_shadow=False), event)  # type: ignore[arg-type]
    r2 = await guard.deduct_once(_state(is_shadow=False), event)  # type: ignore[arg-type]

    assert r1.success is True and r1.duplicate is False
    assert r2.success is True and r2.duplicate is True
    assert fake._billing_deduct_count == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_message_writer_write_once_checkpoint_resume_no_duplicates():
    fake = FakeSupabaseClient()
    writer = MessageWriter(client_getter=lambda: fake)

    event = {
        "type": "tool_message",
        "timestamp": "2025-01-01T00:00:00Z",
        "agent_run_id": "run-1",
        "thread_id": "thread-1",
        "thread_run_id": "tr-1",
        "message_id": "msg-tool-1",
        "tool_call_id": "tc-1",
        "name": "search",
        "content": "ok",
        "success": True,
    }

    m1 = await writer.write_once(_state(is_shadow=False), event)  # type: ignore[arg-type]
    m2 = await writer.write_once(_state(is_shadow=False), event)  # type: ignore[arg-type]

    assert m1 is not None and m2 is not None
    assert len(fake._messages_by_dedup) == 1
    assert m1["message_id"] == m2["message_id"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_shadow_run_bypasses_billing_and_messages(monkeypatch: pytest.MonkeyPatch):
    fake = FakeSupabaseClient()
    monkeypatch.setattr(config, "ENV_MODE", EnvMode.PRODUCTION)

    writer = MessageWriter(client_getter=lambda: fake)
    guard = BillingGuard(client_getter=lambda: fake)

    llm_event = {
        "type": "llm_response_end",
        "timestamp": "2025-01-01T00:00:00Z",
        "agent_run_id": "run-1",
        "thread_id": "thread-1",
        "thread_run_id": "tr-1",
        "message_id": "msg-1",
        "llm_response_id": "llm-1",
        "model": "unknown",
        "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        "finish_reason": "stop",
    }

    tool_event = {
        "type": "tool_message",
        "timestamp": "2025-01-01T00:00:00Z",
        "agent_run_id": "run-1",
        "thread_id": "thread-1",
        "thread_run_id": "tr-1",
        "message_id": "msg-tool-1",
        "tool_call_id": "tc-1",
        "name": "search",
        "content": "ok",
        "success": True,
    }

    shadow_state = _state(is_shadow=True)

    assert await writer.write_once(shadow_state, tool_event) is None  # type: ignore[arg-type]
    r = await guard.deduct_once(shadow_state, llm_event)  # type: ignore[arg-type]

    assert r.success is True and r.cost == 0.0
    assert fake.rpc_call_count == 0
    assert fake._messages_by_dedup == {}


@pytest.mark.unit
@pytest.mark.asyncio
async def test_terminal_status_is_idempotent_and_has_session_index():
    fake = FakeSupabaseClient()
    writer = MessageWriter(client_getter=lambda: fake)

    event = {
        "type": "status",
        "timestamp": "2025-01-01T00:00:00Z",
        "agent_run_id": "run-1",
        "thread_id": "thread-1",
        "thread_run_id": "tr-1",
        "status_type": "run_completed",
        "terminal_status": "completed",
        "data": {"endedAt": 123, "reason": "ok"},
    }

    m1 = await writer.write_once(_state(is_shadow=False), event)  # type: ignore[arg-type]
    m2 = await writer.write_once(_state(is_shadow=False), event)  # type: ignore[arg-type]

    assert m1 is not None and m2 is not None
    assert len(fake._messages_by_dedup) == 1
    assert m1["metadata"]["session_index"] == 3
    assert m1["metadata"]["thread_run_id"] == "tr-1"
    assert m1["content"]["status_type"] == "run_completed"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_message_writer_raises_on_non_dedup_errors():
    class FailingClient(FakeSupabaseClient):
        def _insert_message_row(self, row: dict[str, Any]) -> dict[str, Any]:
            raise RuntimeError("db_down")

    writer = MessageWriter(client_getter=lambda: FailingClient())
    event = {
        "type": "tool_message",
        "timestamp": "2025-01-01T00:00:00Z",
        "agent_run_id": "run-1",
        "thread_id": "thread-1",
        "thread_run_id": "tr-1",
        "message_id": "msg-tool-1",
        "tool_call_id": "tc-1",
        "name": "search",
        "content": "ok",
        "success": True,
    }

    with pytest.raises(MessageWriterError):
        await writer.write_once(_state(is_shadow=False), event)  # type: ignore[arg-type]

