from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .contracts import RuntimeContextV2


class RuntimeHooksV2:
    async def session_start(self, **_: Any) -> None:
        return None

    async def user_prompt_submit(self, **_: Any) -> None:
        return None

    async def pre_execution(self, **_: Any) -> None:
        return None

    async def subagent_start(self, **_: Any) -> None:
        return None

    async def subagent_stop(self, **_: Any) -> None:
        return None

    async def verification_complete(self, **_: Any) -> None:
        return None

    async def turn_complete(self, **_: Any) -> None:
        return None


@dataclass(slots=True)
class ContextEnrichersV2:
    def enrich(
        self,
        *,
        context: RuntimeContextV2,
        normalized: dict[str, Any],
    ) -> dict[str, Any]:
        continuity_state = context.continuity_state
        active_canvas_metadata = {
            "canvas_id": context.workspace_target.canvas_id or context.selection_context.canvas_id,
            "workspace_id": context.workspace_target.workspace_id or context.identity.account_id,
            "selection_scope": context.selection_context.scope,
        }
        pending_preview = dict(continuity_state.pending_preview or {}) if continuity_state else None
        pending_plan = dict(continuity_state.pending_canvas_plan or {}) if continuity_state else None
        permission_context = dict(context.policy_context)
        diagnostics = list(context.diagnostics)
        mailbox = dict(context.tool_context.get("agent_mailbox") or {})
        delegation_state = dict(context.tool_context.get("delegation_state") or {})

        return {
            "selection_context": dict(normalized.get("selection_context") or {}),
            "active_canvas_metadata": active_canvas_metadata,
            "workspace_target": dict(normalized.get("workspace_target") or {}),
            "pending_preview": pending_preview,
            "pending_canvas_plan": pending_plan,
            "permission_context": permission_context,
            "diagnostics": diagnostics,
            "mailbox": mailbox,
            "delegation_state": delegation_state,
        }
