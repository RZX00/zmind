from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.langgraph_engine.tools.policy import ToolPolicy, resolve_tool_policy


@dataclass(slots=True, frozen=True)
class ToolPolicyDecisionV2:
    allowed_names: set[str] | None
    allowed_prefixes: set[str] | None
    source: str
    side_effect_policy: str
    decision_trace: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed_names": sorted(self.allowed_names) if isinstance(self.allowed_names, set) else None,
            "allowed_prefixes": sorted(self.allowed_prefixes) if isinstance(self.allowed_prefixes, set) else None,
            "source": self.source,
            "side_effect_policy": self.side_effect_policy,
            "decision_trace": dict(self.decision_trace),
        }


class ToolPolicyEngineV2:
    def resolve(
        self,
        *,
        agent_config: dict[str, Any] | None,
        mcp_enabled: bool,
        side_effect_policy: str,
    ) -> ToolPolicyDecisionV2:
        policy: ToolPolicy = resolve_tool_policy(agent_config, mcp_enabled=mcp_enabled)
        return ToolPolicyDecisionV2(
            allowed_names=set(policy.allowed_names) if isinstance(policy.allowed_names, set) else None,
            allowed_prefixes=set(policy.allowed_prefixes) if isinstance(policy.allowed_prefixes, set) else None,
            source=policy.source,
            side_effect_policy=side_effect_policy,
            decision_trace={
                "policy_source": policy.source,
                "mcp_enabled": mcp_enabled,
                "side_effect_policy": side_effect_policy,
            },
        )
