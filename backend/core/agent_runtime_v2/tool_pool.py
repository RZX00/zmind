from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Set

from core.langgraph_engine.tools.catalog import build_registry
from core.langgraph_engine.tools.registry import InMemoryToolRegistry

from .tool_policy import ToolPolicyDecisionV2


@dataclass(slots=True)
class ToolPoolV2:
    registry: InMemoryToolRegistry | None
    policy: ToolPolicyDecisionV2
    mcp_enabled: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "tool_count": len(self.registry.list_tools()) if self.registry else 0,
            "policy": self.policy.to_dict(),
            "mcp_enabled": self.mcp_enabled,
        }


class ToolPoolFactoryV2:
    def wrap(
        self,
        *,
        registry: InMemoryToolRegistry | None,
        policy: ToolPolicyDecisionV2,
        mcp_enabled: bool = False,
    ) -> ToolPoolV2:
        return ToolPoolV2(
            registry=registry,
            policy=policy,
            mcp_enabled=mcp_enabled,
        )

    def build(
        self,
        *,
        policy: ToolPolicyDecisionV2,
        mcp_service: Any | None = None,
        mcp_read_only_allowlist: Optional[Set[str]] = None,
    ) -> ToolPoolV2:
        registry = build_registry(
            mcp_service=mcp_service,
            mcp_read_only_allowlist=mcp_read_only_allowlist,
            allowed_names=policy.allowed_names,
            allowed_prefixes=policy.allowed_prefixes,
        )
        return ToolPoolV2(
            registry=registry,
            policy=policy,
            mcp_enabled=bool(mcp_service),
        )
