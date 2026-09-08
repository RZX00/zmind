from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Any


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _env_str(name: str) -> str | None:
    value = os.getenv(name)
    if not value:
        return None
    return value.strip() or None


def _coerce_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class SupervisorConfig:
    enabled: bool
    mode: str
    model_name: str | None = None
    router_enabled: bool = True
    router_hard_gate: bool = False

    @property
    def include_native_tools(self) -> bool:
        return self.mode == "hybrid"


def load_supervisor_config(agent_config: dict[str, Any] | None = None) -> SupervisorConfig:
    enabled = _env_bool("LANGGRAPH_SUPERVISOR_ENABLED", True)
    mode = (_env_str("LANGGRAPH_SUPERVISOR_MODE") or "handoff_only").lower()
    if mode not in ("handoff_only", "hybrid", "disabled"):
        mode = "handoff_only"

    if mode == "disabled":
        enabled = False

    model_name = None
    if agent_config:
        model_name = agent_config.get("supervisor_model") or agent_config.get("supervisorModel")
    model_name = model_name or _env_str("LANGGRAPH_SUPERVISOR_MODEL")

    router_enabled = _env_bool("LANGGRAPH_ROUTER_ENABLED", True)
    router_hard_gate = _env_bool("LANGGRAPH_ROUTER_HARD_GATE", False)
    if agent_config:
        router_hard_gate = _coerce_bool(
            agent_config.get("supervisor_router_hard_gate", agent_config.get("supervisorRouterHardGate")),
            router_hard_gate,
        )

    return SupervisorConfig(
        enabled=enabled,
        mode=mode,
        model_name=model_name,
        router_enabled=router_enabled,
        router_hard_gate=router_hard_gate,
    )
