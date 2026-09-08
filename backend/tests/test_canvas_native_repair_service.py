import pytest

from core.application.services.canvas_native_context_resolver_service import (
    CanvasNativeContextResolverService,
)
from core.application.services.canvas_native_repair_service import (
    CanvasNativeRepairService,
)


class _RepairResolver(CanvasNativeContextResolverService):
    def __init__(self) -> None:
        pass

    async def resolve(self, state, tool_context):
        return {
            "canvas_id": "canvas_1",
            "workspace_id": "acct_1",
            "current_server_version": 15,
            "focus_node_ids": ["existing_1"],
        }

    async def fetch_snapshot(self, *, canvas_id: str | None, workspace_id: str | None):
        return (
            {
                "id": canvas_id,
                "serverVersion": 15,
                "nodes": [],
                "connections": [],
            },
            "realtime",
            [],
        )


@pytest.mark.asyncio
async def test_repair_service_advances_expected_version_and_count() -> None:
    service = CanvasNativeRepairService(context_resolver=_RepairResolver())

    repaired = await service.repair(
        state={
            "repair_count": 0,
            "canvas_context": {"canvas_id": "canvas_1", "workspace_id": "acct_1"},
            "canvas_task": {"execution": {"expected_canvas_version": 9}},
            "canvas_runtime": {"repair_attempt_limit": 2},
            "canvas_verification": {
                "summary": "verification_failed",
                "metadata": {"current_server_version": 15},
            },
            "canvas_execution": {"error": {}},
        },
        tool_context={},
    )

    assert repaired["repair_count"] == 1
    assert repaired["canvas_task"]["execution"]["expected_canvas_version"] == 15
    assert repaired["canvas_runtime"]["last_repair_reason"] == "verification_failed"
