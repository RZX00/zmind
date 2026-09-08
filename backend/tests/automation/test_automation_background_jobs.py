from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import inspect

import pytest

from core.automation import background_jobs
from core.automation.schedule_utils import compute_retry_delay_ms, is_schedule_due
from core.domains.automation.model import Automation, AutomationRun, ProviderEvent


async def _invoke_actor(actor: object, **kwargs):
    fn = getattr(actor, "fn", None)
    wrapped = getattr(fn, "__wrapped__", None)
    if wrapped is not None and inspect.iscoroutinefunction(wrapped):
        return await wrapped(**kwargs)
    if inspect.iscoroutinefunction(actor):
        return await actor(**kwargs)
    return actor(**kwargs)


def _now() -> datetime:
    return datetime(2026, 2, 20, 12, 0, tzinfo=timezone.utc)


def _automation(
    *,
    automation_id: str = "auto_1",
    account_id: str = "acc_1",
    trigger_type: str = "event",
    provider: str | None = "composio",
    provider_binding_key: str | None = "trigger_1",
    config: dict | None = None,
    is_active: bool = True,
) -> Automation:
    now = _now()
    return Automation(
        id=automation_id,
        account_id=account_id,
        agent_id="agent_1",
        name="Automation",
        description=None,
        trigger_type=trigger_type,  # type: ignore[arg-type]
        provider=provider,
        provider_binding_key=provider_binding_key,
        route_type="agent",
        route_ref=None,
        is_active=is_active,
        config=config or {},
        created_by=account_id,
        created_at=now,
        updated_at=now,
    )


def _provider_event(
    *,
    provider_event_id: str = "evt_1",
    status: str = "received",
    payload: dict | None = None,
) -> ProviderEvent:
    now = _now()
    return ProviderEvent(
        id=provider_event_id,
        account_id="acc_1",
        provider="composio",
        external_event_id="external_evt_1",
        event_type="gmail.email_received",
        signature_valid=True,
        dedupe_key="dedupe_1",
        payload=payload or {"data": {"trigger_nano_id": "trigger_1"}},
        headers={},
        processing_status=status,  # type: ignore[arg-type]
        processing_error=None,
        dispatched_at=None,
        received_at=now,
        created_at=now,
    )


def _run(
    *,
    run_id: str = "run_1",
    automation_id: str = "auto_1",
    account_id: str = "acc_1",
    status: str = "queued",
    retry_count: int = 0,
    max_retries: int = 5,
    trigger_source: str = "event",
    provider_event_id: str | None = "evt_1",
) -> AutomationRun:
    now = _now()
    return AutomationRun(
        id=run_id,
        automation_id=automation_id,
        account_id=account_id,
        provider_event_id=provider_event_id,
        trigger_source=trigger_source,  # type: ignore[arg-type]
        triggered_at=now,
        status=status,  # type: ignore[arg-type]
        retry_count=retry_count,
        max_retries=max_retries,
        external_run_key=None,
        agent_run_id=None,
        error_code=None,
        error_message=None,
        metadata={},
        created_at=now,
        updated_at=now,
    )


def test_compute_retry_delay_ms_progressive_backoff() -> None:
    assert compute_retry_delay_ms(1) == 60_000
    assert compute_retry_delay_ms(2) == 5 * 60_000
    assert compute_retry_delay_ms(3) == 15 * 60_000
    assert compute_retry_delay_ms(4) == 60 * 60_000
    assert compute_retry_delay_ms(10) == 2 * 60 * 60_000


def test_is_schedule_due_matches_minute_boundary() -> None:
    now = datetime(2026, 2, 20, 10, 15, 30, tzinfo=timezone.utc)
    assert is_schedule_due("15 10 * * *", now) is True
    assert is_schedule_due("16 10 * * *", now) is False


def test_is_schedule_due_rejects_invalid_expression() -> None:
    now = datetime(2026, 2, 20, 10, 15, 0, tzinfo=timezone.utc)
    assert is_schedule_due("invalid cron", now) is False


@pytest.mark.asyncio
async def test_dispatch_provider_event_marks_ignored_when_no_match(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = SimpleNamespace(
        get_provider_event=AsyncMock(return_value=_provider_event()),
        list_active_event_automations=AsyncMock(return_value=[]),
        update_provider_event_status=AsyncMock(),
    )
    monkeypatch.setattr(background_jobs, "_repo", lambda: repo)
    send_mock = Mock()
    monkeypatch.setattr(background_jobs.execute_automation_run, "send", send_mock)

    await _invoke_actor(background_jobs.dispatch_provider_event, provider_event_id="evt_1")

    repo.update_provider_event_status.assert_awaited_once_with(
        provider_event_id="evt_1",
        status="ignored",
        processing_error="no_matching_automations",
    )
    send_mock.assert_not_called()


@pytest.mark.asyncio
async def test_dispatch_provider_event_queues_and_dispatches_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    queued_calls: list[dict] = []
    run_counter = {"n": 0}

    class _FakeQueueUseCase:
        def __init__(self, _repo: object) -> None:
            self._repo = _repo

        async def execute(self, **kwargs):
            queued_calls.append(kwargs)
            run_counter["n"] += 1
            return (
                _run(
                    run_id=f"run_{run_counter['n']}",
                    automation_id=kwargs["automation_id"],
                    account_id=kwargs["account_id"],
                    trigger_source="event",
                    provider_event_id=kwargs.get("provider_event_id"),
                ),
                False,
            )

    import core.application.use_cases.automation.queue_automation_run as queue_run_module

    monkeypatch.setattr(queue_run_module, "QueueAutomationRunUseCase", _FakeQueueUseCase)

    repo = SimpleNamespace(
        get_provider_event=AsyncMock(return_value=_provider_event()),
        list_active_event_automations=AsyncMock(return_value=[_automation(automation_id="auto_1"), _automation(automation_id="auto_2")]),
        update_provider_event_status=AsyncMock(),
    )
    monkeypatch.setattr(background_jobs, "_repo", lambda: repo)

    send_mock = Mock()
    monkeypatch.setattr(background_jobs.execute_automation_run, "send", send_mock)

    await _invoke_actor(background_jobs.dispatch_provider_event, provider_event_id="evt_1")

    assert len(queued_calls) == 2
    assert send_mock.call_count == 2
    repo.update_provider_event_status.assert_awaited_once_with(
        provider_event_id="evt_1",
        status="dispatched",
        processing_error=None,
    )


@pytest.mark.asyncio
async def test_execute_automation_run_success_marks_completed(monkeypatch: pytest.MonkeyPatch) -> None:
    run = _run()
    automation = _automation()
    repo = SimpleNamespace(
        get_run=AsyncMock(return_value=run),
        get_automation=AsyncMock(return_value=automation),
        update_run_status=AsyncMock(),
        create_run_attempt=AsyncMock(return_value=(SimpleNamespace(id="attempt_1"), False)),
        get_provider_event=AsyncMock(return_value=_provider_event()),
        update_run_attempt_status=AsyncMock(),
    )
    monkeypatch.setattr(background_jobs, "_repo", lambda: repo)

    async def _fake_start_agent_run(**_kwargs):
        return "agent_run_1"

    monkeypatch.setattr(background_jobs, "_start_agent_run_for_automation", _fake_start_agent_run)

    await _invoke_actor(background_jobs.execute_automation_run, run_id=run.id)

    first_status_call = repo.update_run_status.await_args_list[0]
    second_status_call = repo.update_run_status.await_args_list[1]
    assert first_status_call.kwargs["status"] == "running"
    assert second_status_call.kwargs["status"] == "completed"
    assert second_status_call.kwargs["agent_run_id"] == "agent_run_1"
    repo.update_run_attempt_status.assert_awaited_once_with(attempt_id="attempt_1", status="completed")


@pytest.mark.asyncio
async def test_execute_automation_run_failure_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    run = _run(run_id="run_retry_1", retry_count=0, max_retries=3)
    repo = SimpleNamespace(
        get_run=AsyncMock(return_value=run),
        get_automation=AsyncMock(return_value=_automation()),
        update_run_status=AsyncMock(),
        create_run_attempt=AsyncMock(return_value=(SimpleNamespace(id="attempt_1"), False)),
        get_provider_event=AsyncMock(return_value=None),
        update_run_attempt_status=AsyncMock(),
    )
    monkeypatch.setattr(background_jobs, "_repo", lambda: repo)

    async def _raise_start(**_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(background_jobs, "_start_agent_run_for_automation", _raise_start)
    send_with_options_mock = Mock()
    monkeypatch.setattr(background_jobs.execute_automation_run, "send_with_options", send_with_options_mock)

    await _invoke_actor(background_jobs.execute_automation_run, run_id=run.id)

    final_status_call = repo.update_run_status.await_args_list[-1]
    assert final_status_call.kwargs["status"] == "failed"
    assert final_status_call.kwargs["retry_count"] == 1
    send_with_options_mock.assert_called_once()
    assert send_with_options_mock.call_args.kwargs["delay"] == compute_retry_delay_ms(1)
    assert send_with_options_mock.call_args.kwargs["kwargs"] == {"run_id": run.id}


@pytest.mark.asyncio
async def test_execute_automation_run_failure_dead_lettered(monkeypatch: pytest.MonkeyPatch) -> None:
    run = _run(run_id="run_dead_letter", retry_count=2, max_retries=3)
    repo = SimpleNamespace(
        get_run=AsyncMock(return_value=run),
        get_automation=AsyncMock(return_value=_automation()),
        update_run_status=AsyncMock(),
        create_run_attempt=AsyncMock(return_value=(SimpleNamespace(id="attempt_1"), False)),
        get_provider_event=AsyncMock(return_value=None),
        update_run_attempt_status=AsyncMock(),
    )
    monkeypatch.setattr(background_jobs, "_repo", lambda: repo)

    async def _raise_start(**_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(background_jobs, "_start_agent_run_for_automation", _raise_start)
    send_with_options_mock = Mock()
    monkeypatch.setattr(background_jobs.execute_automation_run, "send_with_options", send_with_options_mock)

    await _invoke_actor(background_jobs.execute_automation_run, run_id=run.id)

    final_status_call = repo.update_run_status.await_args_list[-1]
    assert final_status_call.kwargs["status"] == "dead_lettered"
    assert final_status_call.kwargs["retry_count"] == 3
    send_with_options_mock.assert_not_called()


@pytest.mark.asyncio
async def test_dispatch_scheduled_automations_impl_queues_due_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    queued_calls: list[dict] = []

    class _FakeQueueUseCase:
        def __init__(self, _repo: object) -> None:
            self._repo = _repo

        async def execute(self, **kwargs):
            queued_calls.append(kwargs)
            return (
                _run(
                    run_id="run_schedule_1",
                    automation_id=kwargs["automation_id"],
                    account_id=kwargs["account_id"],
                    trigger_source="schedule",
                    provider_event_id=None,
                ),
                False,
            )

    import core.application.use_cases.automation.queue_automation_run as queue_run_module

    monkeypatch.setattr(queue_run_module, "QueueAutomationRunUseCase", _FakeQueueUseCase)
    monkeypatch.setattr(background_jobs, "is_schedule_due", lambda _expr, _now: True)

    repo = SimpleNamespace(
        list_active_schedule_automations=AsyncMock(
            return_value=[
                _automation(
                    automation_id="auto_schedule_1",
                    trigger_type="schedule",
                    provider=None,
                    provider_binding_key=None,
                    config={"cron_expression": "*/5 * * * *", "timezone": "UTC"},
                )
            ]
        ),
        get_latest_run_for_automation=AsyncMock(return_value=None),
    )
    monkeypatch.setattr(background_jobs, "_repo", lambda: repo)

    send_mock = Mock()
    monkeypatch.setattr(background_jobs.execute_automation_run, "send", send_mock)

    result = await background_jobs._dispatch_scheduled_automations_impl(account_id="acc_1")

    assert result["scanned"] == 1
    assert result["queued"] == 1
    assert result["skipped"] == 0
    assert len(queued_calls) == 1
    send_mock.assert_called_once()
