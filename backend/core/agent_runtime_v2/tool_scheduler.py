from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.langgraph_engine.contracts.tool_interface import SideEffectLevel, ToolCall
from core.langgraph_engine.tools.registry import InMemoryToolRegistry


@dataclass(slots=True, frozen=True)
class ToolSchedulePlanV2:
    read_only_parallel: list[ToolCall]
    write_serial: list[ToolCall]
    unknown: list[ToolCall]
    decision_trace: list[dict[str, Any]]


class ToolSchedulerV2:
    def plan(self, *, tool_calls: list[ToolCall], registry: InMemoryToolRegistry | None) -> ToolSchedulePlanV2:
        read_only_parallel: list[ToolCall] = []
        write_serial: list[ToolCall] = []
        unknown: list[ToolCall] = []
        decision_trace: list[dict[str, Any]] = []

        for tool_call in tool_calls:
            tool_name = str(tool_call.get("name") or "")
            tool_spec = registry.get(tool_name) if registry else None
            if tool_spec is None:
                unknown.append(tool_call)
                decision_trace.append({"tool": tool_name, "bucket": "unknown", "reason": "missing_spec"})
                continue
            if tool_spec.side_effect_level == SideEffectLevel.READ_ONLY:
                read_only_parallel.append(tool_call)
                decision_trace.append({"tool": tool_name, "bucket": "read_only_parallel"})
            else:
                write_serial.append(tool_call)
                decision_trace.append({"tool": tool_name, "bucket": "write_serial"})

        return ToolSchedulePlanV2(
            read_only_parallel=read_only_parallel,
            write_serial=write_serial,
            unknown=unknown,
            decision_trace=decision_trace,
        )
