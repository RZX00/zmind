from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, AsyncIterator, Protocol

from .event_schema import EngineEvent
from .state_schema import EngineName, SideEffectPolicy


@dataclass(slots=True)
class RunConfig:
    """
    Engine run configuration (v1).

    This is a runtime-only object (may contain non-serializable fields like stop_event).
    """

    agent_run_id: str
    thread_id: str
    project_id: str | None
    account_id: str

    model_name: str
    enable_thinking: bool | None = False
    reasoning_effort: str = "low"
    enable_context_manager: bool = True
    enable_prompt_caching: bool = True

    agent_config: dict[str, Any] | None = None

    max_iterations: int = 100

    engine: EngineName = "langgraph"
    engine_version: str = "v1"

    is_shadow: bool = False
    shadow_parent_run_id: str | None = None
    side_effect_policy: SideEffectPolicy = "allow_all"

    # Optional checkpoint selection for resume (None => engine decides latest/initial).
    checkpoint_id: str | None = None

    # Stop hook: worker listens to Redis STOP and sets this event.
    stop_event: asyncio.Event | None = None

    # Optional override: provide prebuilt messages to skip DB load.
    initial_messages_context: list[dict[str, Any]] | None = None

    # Optional: append messages after loading checkpoint (task/session resume).
    append_messages_context: list[dict[str, Any]] | None = None

    # Optional: when resuming from a checkpoint, reset iteration/termination/tool buffers.
    reset_loaded_state: bool = False


class BaseEngine(Protocol):
    """Unified engine entrypoint (v1)."""

    async def run(self, run_config: RunConfig) -> AsyncIterator[EngineEvent]: ...

