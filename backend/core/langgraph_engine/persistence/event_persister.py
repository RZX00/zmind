from __future__ import annotations

import json
import os
from typing import Iterable

from core.langgraph_engine.billing.billing_guard import BillingGuard, billing_guard
from core.langgraph_engine.contracts.event_schema import EngineEvent
from core.langgraph_engine.contracts.state_schema import GraphState
from core.langgraph_engine.persistence.message_writer import MessageWriter, message_writer
from core.utils.logger import logger
from core.utils.retry import retry


_DEFAULT_TERMINAL_STATUS_TYPES = frozenset(
    {
        "run_completed",
        "run_stopped",
        "run_max_iterations",
        "run_failed",
        "error",
        "failed",
        "completed",
        "stopped",
    }
)
_ALWAYS_PERSIST_EVENT_TYPES = frozenset(
    {"assistant_final", "tool_message", "llm_response_end", "error"}
)


def _parse_bool_env(name: str, *, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _parse_status_types_env(defaults: Iterable[str]) -> set[str]:
    raw = os.getenv("LANGGRAPH_PERSIST_STATUS_TYPES")
    normalized_defaults = {str(item).strip().lower() for item in defaults if str(item).strip()}
    if raw is None:
        return normalized_defaults

    value = str(raw).strip()
    if not value:
        return normalized_defaults

    items: list[str] = []
    if value.startswith("["):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                items = [str(item) for item in parsed]
        except Exception:
            items = []

    if not items:
        items = value.split(",")

    parsed_types = {item.strip().lower() for item in items if item and item.strip()}
    return parsed_types or normalized_defaults


class EventPersister:
    def __init__(
        self,
        message_writer_obj: MessageWriter | None = None,
        billing_guard_obj: BillingGuard | None = None,
        persist_status_events: bool | None = None,
        persist_status_terminal_only: bool | None = None,
        persist_status_types: Iterable[str] | None = None,
    ) -> None:
        self._message_writer = message_writer_obj or message_writer
        self._billing_guard = billing_guard_obj or billing_guard
        self._message_persist_disabled = False
        self._billing_disabled = False
        self._persist_status_events = (
            bool(persist_status_events)
            if persist_status_events is not None
            else _parse_bool_env("LANGGRAPH_PERSIST_STATUS_EVENTS", default=False)
        )
        self._persist_status_terminal_only = (
            bool(persist_status_terminal_only)
            if persist_status_terminal_only is not None
            else _parse_bool_env("LANGGRAPH_PERSIST_STATUS_TERMINAL_ONLY", default=True)
        )
        if persist_status_types is not None:
            self._persist_status_types = {
                str(item).strip().lower()
                for item in persist_status_types
                if str(item).strip()
            }
        else:
            self._persist_status_types = _parse_status_types_env(
                _DEFAULT_TERMINAL_STATUS_TYPES
            )

        if not self._persist_status_types:
            self._persist_status_types = set(_DEFAULT_TERMINAL_STATUS_TYPES)

    def _is_terminal_status(self, event: EngineEvent) -> bool:
        terminal_status = event.get("terminal_status")
        if isinstance(terminal_status, str) and terminal_status.strip():
            return True

        status_type = event.get("status_type")
        if not isinstance(status_type, str):
            return False
        return status_type.strip().lower() in self._persist_status_types

    def _should_persist_message(self, event: EngineEvent) -> bool:
        event_type = event.get("type")
        if event_type in _ALWAYS_PERSIST_EVENT_TYPES:
            return True

        if event_type != "status":
            return False

        if self._persist_status_events and not self._persist_status_terminal_only:
            return True

        if self._persist_status_terminal_only:
            return self._is_terminal_status(event)

        return False

    async def persist(self, state: GraphState, event: EngineEvent) -> None:
        event_type = event.get("type")

        if self._should_persist_message(event):
            if not self._message_persist_disabled:
                try:
                    await retry(lambda: self._message_writer.write_once(state, event), max_attempts=3, delay_seconds=1)
                except Exception as err:
                    self._message_persist_disabled = True
                    logger.exception(
                        "[EVENT_PERSISTER] Message persistence failed; disabling for remainder of run",
                        agent_run_id=state.get("agent_run_id"),
                        thread_id=state.get("thread_id"),
                        event_type=event_type,
                        error=str(err),
                    )

        if event_type == "llm_response_end":
            if not self._billing_disabled:
                try:
                    await retry(lambda: self._billing_guard.deduct_once(state, event), max_attempts=3, delay_seconds=1)  # type: ignore[arg-type]
                except Exception as err:
                    self._billing_disabled = True
                    logger.exception(
                        "[EVENT_PERSISTER] Billing deduction failed; disabling for remainder of run",
                        agent_run_id=state.get("agent_run_id"),
                        thread_id=state.get("thread_id"),
                        error=str(err),
                    )

