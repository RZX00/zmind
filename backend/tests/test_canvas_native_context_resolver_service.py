from types import SimpleNamespace

import pytest

from core.application.services.canvas_native_context_resolver_service import (
    CanvasNativeContextResolverService,
)


class _FakeWriteService:
    async def fetch_canvas_snapshot(self, *, canvas_id: str, workspace_id: str, user_id=None):
        return {
            "canvas": {
                "id": canvas_id,
                "serverVersion": 12,
                "nodes": [
                    {"id": "n1", "content": "目标", "x": 10, "y": 20, "width": 100, "height": 60},
                    {"id": "n2", "content": "策略", "x": 180, "y": 20, "width": 100, "height": 60},
                ],
                "connections": [{"id": "c1", "from": "n1", "to": "n2"}],
            }
        }


@pytest.mark.asyncio
async def test_context_resolver_uses_selection_context_when_available() -> None:
    service = CanvasNativeContextResolverService(
        create_write_service=_FakeWriteService,
        db_connection=SimpleNamespace(),
    )
    state = {
        "messages_context": [
            {
                "role": "user",
                "content": "请整理这些节点",
                "metadata": {
                    "selection_context": {
                        "meta": {"canvas_id": "canvas_1"},
                        "nodes": [
                            {"id": "n1", "x": 10, "y": 20, "width": 100, "height": 60},
                            {"id": "n2", "x": 180, "y": 20, "width": 100, "height": 60},
                        ],
                    }
                },
            }
        ]
    }

    context = await service.resolve(
        state,
        {"canvas_id": "canvas_1", "account_id": "acct_1"},
    )

    assert context["focus_scope"] == "selection"
    assert context["focus_node_ids"] == ["n1", "n2"]
    assert context["focus_nodes"][0]["content"] == "目标"
    assert context["focus_texts"] == ["目标", "策略"]
    assert context["focus_connections"][0]["id"] == "c1"
    assert context["current_server_version"] == 12
    assert context["snapshot_source"] == "realtime"
    assert context["anchor_box"]["center_x"] == 145.0
