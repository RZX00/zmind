from __future__ import annotations

from typing import Any


class CanvasNativeRuntimePolicyService:
    def __init__(self, config: Any) -> None:
        self._config = config

    def evaluate(
        self,
        *,
        intent: dict[str, Any] | None,
        tool_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        intent_payload = intent if isinstance(intent, dict) else {}
        tool_ctx = tool_context if isinstance(tool_context, dict) else {}

        domain = str(intent_payload.get("domain") or "").strip().lower()
        surface = str(
            tool_ctx.get("interaction_surface")
            or intent_payload.get("target_surface")
            or ""
        ).strip().lower()
        canvas_id = str(tool_ctx.get("canvas_id") or "").strip() or None
        workspace_id = str(tool_ctx.get("account_id") or "").strip() or None

        enabled = bool(getattr(self._config, "CANVAS_NATIVE_RUNTIME_ENABLED", False))
        shadow = bool(getattr(self._config, "CANVAS_NATIVE_RUNTIME_SHADOW", False))
        verify_enabled = bool(getattr(self._config, "CANVAS_NATIVE_VERIFY_ENABLED", False))
        repair_attempt_limit = max(
            0,
            int(getattr(self._config, "CANVAS_NATIVE_MAX_REPAIR_ATTEMPTS", 0) or 0),
        )
        best_path_enabled = bool(getattr(self._config, "CANVAS_NATIVE_BEST_PATH_ENABLED", True))
        plan_budget_ms = max(
            0,
            int(getattr(self._config, "CANVAS_NATIVE_PLAN_BUDGET_MS", 20) or 0),
        )
        layout_budget_ms = max(
            0,
            int(getattr(self._config, "CANVAS_NATIVE_LAYOUT_BUDGET_MS", 24) or 0),
        )
        layout_collision_pass_limit = max(
            0,
            int(getattr(self._config, "CANVAS_NATIVE_LAYOUT_COLLISION_PASS_LIMIT", 2) or 0),
        )

        route = "classic"
        reason = "native_disabled"
        eligible = False

        if not enabled:
            route = "classic"
            reason = "native_disabled"
        elif domain != "canvas":
            route = "classic"
            reason = f"unsupported_domain:{domain or 'unknown'}"
        elif surface != "canvas":
            route = "classic"
            reason = f"unsupported_surface:{surface or 'unknown'}"
        elif not canvas_id:
            route = "classic"
            reason = "missing_canvas_id"
        elif not workspace_id:
            route = "classic"
            reason = "missing_workspace_id"
        else:
            route = "native"
            reason = "eligible"
            eligible = True

        mode = "shadow" if shadow and eligible else "apply"

        return {
            "enabled": enabled,
            "eligible": eligible,
            "route": route,
            "reason": reason,
            "mode": mode,
            "shadow": shadow and eligible,
            "verify_enabled": verify_enabled,
            "repair_attempt_limit": repair_attempt_limit,
            "best_path_enabled": best_path_enabled,
            "plan_budget_ms": plan_budget_ms,
            "layout_budget_ms": layout_budget_ms,
            "layout_collision_pass_limit": layout_collision_pass_limit,
            "canvas_id": canvas_id,
            "workspace_id": workspace_id,
        }
