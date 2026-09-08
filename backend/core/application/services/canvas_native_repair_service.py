from __future__ import annotations

from typing import Any

from core.application.services.canvas_native_context_resolver_service import (
    CanvasNativeContextResolverService,
)


class CanvasNativeRepairService:
    def __init__(
        self,
        *,
        context_resolver: CanvasNativeContextResolverService | None = None,
    ) -> None:
        self._context_resolver = context_resolver or CanvasNativeContextResolverService()

    async def repair(self, *, state: dict[str, Any], tool_context: dict[str, Any] | None) -> dict[str, Any]:
        verification = state.get("canvas_verification") or {}
        execution = state.get("canvas_execution") or {}
        task = dict(state.get("canvas_task") or {})
        context = state.get("canvas_context") or {}

        repair_count = int(state.get("repair_count") or 0) + 1

        current_server_version = verification.get("metadata", {}).get("current_server_version")
        if current_server_version is None:
            detail = (execution.get("error") or {}).get("detail")
            if isinstance(detail, dict):
                current_server_version = detail.get("serverVersion") or detail.get("server_version")

        if current_server_version is None:
            snapshot_doc, _source, _warnings = await self._context_resolver.fetch_snapshot(
                canvas_id=context.get("canvas_id"),
                workspace_id=context.get("workspace_id"),
            )
            if isinstance(snapshot_doc, dict):
                current_server_version = snapshot_doc.get("serverVersion")

        execution_block = dict(task.get("execution") or {})
        if current_server_version is not None:
            execution_block["expected_canvas_version"] = current_server_version
        task["execution"] = execution_block
        task["status"] = "repaired"
        task.setdefault("metadata", {})
        task["metadata"]["last_repair_reason"] = verification.get("summary")
        task["metadata"]["last_repair_count"] = repair_count

        refreshed_context = await self._context_resolver.resolve(state, tool_context or {})
        if current_server_version is not None:
            refreshed_context["current_server_version"] = current_server_version

        return {
            "repair_count": repair_count,
            "canvas_task": task,
            "canvas_context": refreshed_context,
            "canvas_runtime": {
                **(state.get("canvas_runtime") or {}),
                "last_repair_reason": verification.get("summary"),
            },
        }
