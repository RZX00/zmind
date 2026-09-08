import json
import sys
import types

import pytest


if "core.utils.logger" not in sys.modules:
    logger_stub = types.ModuleType("core.utils.logger")

    class _Logger:  # pragma: no cover - test import shim
        def debug(self, *_args, **_kwargs):
            return None

        def info(self, *_args, **_kwargs):
            return None

        def warning(self, *_args, **_kwargs):
            return None

        def error(self, *_args, **_kwargs):
            return None

        def exception(self, *_args, **_kwargs):
            return None

    logger_stub.logger = _Logger()
    sys.modules["core.utils.logger"] = logger_stub


if "core.utils.config" not in sys.modules:
    config_stub = types.ModuleType("core.utils.config")

    class _Config:  # pragma: no cover - test import shim
        CANVAS_REALTIME_WRITE_ENABLED = False

    config_stub.config = _Config()
    sys.modules["core.utils.config"] = config_stub


if "core.services.supabase" not in sys.modules:
    supabase_service_stub = types.ModuleType("core.services.supabase")

    class DBConnection:  # pragma: no cover - test import shim
        pass

    supabase_service_stub.DBConnection = DBConnection
    sys.modules["core.services.supabase"] = supabase_service_stub


if "core.canvas.write_service" not in sys.modules:
    write_service_stub = types.ModuleType("core.canvas.write_service")

    class CanvasWriteService:  # pragma: no cover - test import shim
        async def fetch_canvas_snapshot(self, *_args, **_kwargs):
            return None

    write_service_stub.CanvasWriteService = CanvasWriteService
    sys.modules["core.canvas.write_service"] = write_service_stub

from core.canvas.cac.tools import (
    CanvasEditTool,
    CanvasReadTool,
    CanvasWriteTool,
    WorkspaceListCanvasesTool,
)


@pytest.mark.asyncio
async def test_canvas_read_supports_explicit_canvas_id(monkeypatch):
    tool = CanvasReadTool(thread_id="th_test", canvas_id="cv_default")
    captured: dict[str, str] = {}

    async def _get_account_id():
        return "acct_test"

    async def _fetch_canvas(_account_id: str, canvas_id: str):
        captured["canvas_id"] = canvas_id
        return {
            "id": canvas_id,
            "title": "Target Canvas",
            "nodes": [{"id": "n1", "type": "text", "content": "hello"}],
            "connections": [],
        }

    async def _get_selection_context():
        return None

    monkeypatch.setattr(tool, "_get_account_id", _get_account_id)
    monkeypatch.setattr(tool, "_fetch_canvas", _fetch_canvas)
    monkeypatch.setattr(tool, "_get_selection_context", _get_selection_context)

    result = await tool.read(canvas_id="cv_other")
    assert result.success is True
    assert captured["canvas_id"] == "cv_other"

    payload = json.loads(result.output)
    assert payload["canvas"]["id"] == "cv_other"


@pytest.mark.asyncio
async def test_canvas_read_full_returns_raw_node_fields(monkeypatch):
    tool = CanvasReadTool(thread_id="th_test", canvas_id="cv_test")

    async def _get_account_id():
        return "acct_test"

    async def _fetch_canvas(_account_id: str, canvas_id: str):
        return {
            "id": canvas_id,
            "title": "Full",
            "nodes": [
                {
                    "id": "n1",
                    "type": "text",
                    "content": "hello",
                    "x": 1,
                    "y": 2,
                    "width": 3,
                    "height": 4,
                    "style": {"color": "#fff"},
                }
            ],
            "connections": [],
        }

    async def _get_selection_context():
        return None

    monkeypatch.setattr(tool, "_get_account_id", _get_account_id)
    monkeypatch.setattr(tool, "_fetch_canvas", _fetch_canvas)
    monkeypatch.setattr(tool, "_get_selection_context", _get_selection_context)

    simplified = await tool.read()
    simplified_payload = json.loads(simplified.output)
    assert "style" not in simplified_payload["canvas"]["nodes"][0]

    full = await tool.read(full=True)
    full_payload = json.loads(full.output)
    assert full_payload["canvas"]["nodes"][0]["style"] == {"color": "#fff"}


@pytest.mark.asyncio
async def test_workspace_list_canvases_returns_paged_rows(monkeypatch):
    tool = WorkspaceListCanvasesTool(thread_id="th_test")

    async def _get_account_id():
        return "acct_test"

    async def _fetch_canvases(
        account_id: str,
        *,
        query: str | None,
        limit: int,
        offset: int,
        include_deleted: bool,
    ):
        assert account_id == "acct_test"
        assert query == "roadmap"
        assert limit == 2
        assert offset == 1
        assert include_deleted is True
        return [
            {"id": "c1", "title": "Roadmap A"},
            {"id": "c2", "title": "Roadmap B"},
        ]

    monkeypatch.setattr(tool, "_get_account_id", _get_account_id)
    monkeypatch.setattr(tool, "_fetch_canvases", _fetch_canvases)

    result = await tool.workspace_list_canvases(query="roadmap", limit=2, offset=1, include_deleted=True)
    assert result.success is True
    payload = json.loads(result.output)
    assert payload["count"] == 2
    assert [item["id"] for item in payload["canvases"]] == ["c1", "c2"]


@pytest.mark.asyncio
async def test_canvas_write_blocks_cross_canvas_without_explicit_target(monkeypatch):
    tool = CanvasWriteTool(thread_id="th_test", canvas_id="cv_default")

    async def _get_account_id():
        return "acct_test"

    async def _get_canvas_id():
        return "cv_default"

    async def _latest_user_metadata(_db, _thread_id):
        return {}

    async def _fetch_canvas(_account_id: str, _canvas_id: str):
        raise AssertionError("guard should run before canvas fetch")

    monkeypatch.setattr(tool, "_get_account_id", _get_account_id)
    monkeypatch.setattr(tool, "_get_canvas_id", _get_canvas_id)
    monkeypatch.setattr("core.canvas.cac.tools._get_latest_user_metadata", _latest_user_metadata)
    monkeypatch.setattr(tool, "_fetch_canvas", _fetch_canvas)

    result = await tool.write(
        canvas_id="cv_other",
        layout="stack",
        anchor="canvas.origin",
        nodes=[{"type": "text", "content": "hello"}],
    )
    assert result.success is False
    assert "Cross-canvas write blocked" in result.output


@pytest.mark.asyncio
async def test_canvas_write_allows_cross_canvas_with_explicit_target(monkeypatch):
    tool = CanvasWriteTool(thread_id="th_test", canvas_id="cv_default")

    async def _get_account_id():
        return "acct_test"

    async def _get_canvas_id():
        return "cv_default"

    async def _latest_user_metadata(_db, _thread_id):
        return {"workspace_target_canvas": {"canvas_id": "cv_other"}}

    async def _fetch_canvas(_account_id: str, canvas_id: str):
        return {"id": canvas_id, "title": "Cross", "nodes": [], "connections": []}

    async def _get_selection_context():
        return None

    async def _apply_operations(_account_id: str, canvas_id: str, operations: list[dict]):
        assert canvas_id == "cv_other"
        assert operations
        return {"success": True}

    monkeypatch.setattr(tool, "_get_account_id", _get_account_id)
    monkeypatch.setattr(tool, "_get_canvas_id", _get_canvas_id)
    monkeypatch.setattr("core.canvas.cac.tools._get_latest_user_metadata", _latest_user_metadata)
    monkeypatch.setattr(tool, "_fetch_canvas", _fetch_canvas)
    monkeypatch.setattr(tool, "_get_selection_context", _get_selection_context)
    monkeypatch.setattr(tool, "_apply_operations", _apply_operations)

    result = await tool.write(
        canvas_id="cv_other",
        layout="stack",
        anchor="canvas.origin",
        nodes=[{"type": "text", "content": "hello"}],
    )
    assert result.success is True


@pytest.mark.asyncio
async def test_canvas_edit_blocks_cross_canvas_without_explicit_target(monkeypatch):
    tool = CanvasEditTool(thread_id="th_test", canvas_id="cv_default")

    async def _get_account_id():
        return "acct_test"

    async def _get_canvas_id():
        return "cv_default"

    async def _latest_user_metadata(_db, _thread_id):
        return {}

    async def _fetch_canvas(_account_id: str, _canvas_id: str):
        raise AssertionError("guard should run before canvas fetch")

    monkeypatch.setattr(tool, "_get_account_id", _get_account_id)
    monkeypatch.setattr(tool, "_get_canvas_id", _get_canvas_id)
    monkeypatch.setattr("core.canvas.cac.tools._get_latest_user_metadata", _latest_user_metadata)
    monkeypatch.setattr(tool, "_fetch_canvas", _fetch_canvas)

    result = await tool.edit(canvas_id="cv_other", n1={"content": "updated"})
    assert result.success is False
    assert "Cross-canvas write blocked" in result.output
