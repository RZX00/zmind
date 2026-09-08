from __future__ import annotations

import asyncio
import re
from types import SimpleNamespace
from pathlib import Path
from typing import Any

import pytest

from core.application.services.canvas_command_application_service import (
    CanvasCommandApplicationService,
    CanvasCommandDependencies,
    CanvasCommandLegacyHandlers,
    _extract_server_version,
    _is_realtime_version_conflict,
    _parse_workspace_list,
    _realtime_write_enabled_for_workspace,
)
from core.application.services.canvas_query_service import (
    CanvasQueryDependencies,
    CanvasQueryService,
    calculate_days_remaining,
    calculate_doc_counts,
    parse_deleted_flag,
)
from core.application.services.canvas_ai_service import CanvasAIDependencies, CanvasAIService
from core.application.services.canvas_share_service import CanvasShareDependencies, CanvasShareService


def _async_capture(name: str, calls: list[tuple[str, dict[str, Any]]]):
    async def _inner(**kwargs: Any):
        calls.append((name, kwargs))
        return {"name": name, "kwargs": kwargs}

    return _inner


def test_canvas_query_service_helpers() -> None:
    assert parse_deleted_flag("true") is True
    assert parse_deleted_flag("0") is False
    assert calculate_days_remaining("2026-02-18T00:00:00Z", 15, now=None) is not None
    assert calculate_days_remaining(None, 15) is None
    assert calculate_doc_counts({"nodes": [1, 2], "connections": [1]}) == (2, 1)
    assert calculate_doc_counts('{"nodes":[1],"connections":[1,2]}') == (1, 2)
    assert calculate_doc_counts("invalid-json") == (0, 0)


def test_canvas_query_service_requires_explicit_dependencies() -> None:
    class _Logger:
        def debug(self, *_args: Any, **_kwargs: Any) -> None:
            return None

        def warning(self, *_args: Any, **_kwargs: Any) -> None:
            return None

        def error(self, *_args: Any, **_kwargs: Any) -> None:
            return None

    async def _resolve_user_workspace(_request: Any, _token: Any) -> tuple[str, str]:
        return "u1", "w1"

    async def _extract_invited_context(_request: Any, _token: Any, _canvas_id: str) -> tuple[str, str] | None:
        return None

    async def _get_db_client() -> Any:
        return object()

    async def _backfill(_client: Any, doc: dict[str, Any], _workspace_id: str) -> dict[str, Any]:
        return doc

    async def _set_cached_snapshot(_workspace_id: str, _canvas_id: str, _doc: dict[str, Any]) -> str | None:
        return None

    async def _get_cached_snapshot(_workspace_id: str, _canvas_id: str) -> dict[str, Any] | None:
        return None

    class _WriteService:
        async def fetch_canvas_snapshot(self, **_kwargs: Any) -> dict[str, Any]:
            return {}

    class _CanvasDoc:
        @staticmethod
        def model_validate(_value: Any) -> Any:
            return object()

    deps = CanvasQueryDependencies(
        resolve_user_workspace=_resolve_user_workspace,
        extract_invited_context=_extract_invited_context,
        get_db_client=_get_db_client,
        compose_doc=lambda row: row,
        compose_meta=lambda row: row,
        iso_to_ms=lambda _value: 0,
        make_meta_etag=lambda _workspace_id, _updated_at: "etag-meta",
        make_canvas_etag=lambda _canvas_id, _version, _updated_at: "etag-canvas",
        now_ts=lambda: 0,
        backfill_media_storage_paths_from_file_ids=_backfill,
        set_cached_snapshot=_set_cached_snapshot,
        get_cached_snapshot=_get_cached_snapshot,
        doc_needs_media_backfill=lambda _doc: False,
        create_write_service=_WriteService,
        canvas_doc_model=_CanvasDoc,
        canvas_version_model=dict,
        logger=_Logger(),
        realtime_write_enabled=False,
        snapshot_timeout_sec=0.1,
    )

    service = CanvasQueryService(deps=deps)
    assert isinstance(service, CanvasQueryService)


class _TrashQueryBuilder:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = list(rows)
        self._total_count = len(self._rows)
        self.range_args: tuple[int, int] | None = None

    def select(self, *_args: Any, **_kwargs: Any) -> "_TrashQueryBuilder":
        return self

    def eq(self, column: str, value: Any) -> "_TrashQueryBuilder":
        self._rows = [row for row in self._rows if row.get(column) == value]
        self._total_count = len(self._rows)
        return self

    def ilike(self, column: str, pattern: str) -> "_TrashQueryBuilder":
        needle = pattern.strip("%").lower()
        self._rows = [
            row for row in self._rows if needle in str(row.get(column) or "").lower()
        ]
        self._total_count = len(self._rows)
        return self

    def order(self, column: str, *, desc: bool = False) -> "_TrashQueryBuilder":
        self._rows = sorted(
            self._rows,
            key=lambda row: row.get(column) or "",
            reverse=desc,
        )
        return self

    def range(self, start: int, end: int) -> "_TrashQueryBuilder":
        self.range_args = (start, end)
        self._rows = self._rows[start : end + 1]
        return self

    async def execute(self) -> Any:
        return SimpleNamespace(data=list(self._rows), count=self._total_count)


class _TrashDbClient:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows
        self.last_builder: _TrashQueryBuilder | None = None

    def table(self, name: str) -> _TrashQueryBuilder:
        assert name == "canvases"
        self.last_builder = _TrashQueryBuilder(self._rows)
        return self.last_builder


def _make_canvas_query_service_for_trash(rows: list[dict[str, Any]]) -> tuple[CanvasQueryService, _TrashDbClient]:
    class _Logger:
        def debug(self, *_args: Any, **_kwargs: Any) -> None:
            return None

        def warning(self, *_args: Any, **_kwargs: Any) -> None:
            return None

        def error(self, *_args: Any, **_kwargs: Any) -> None:
            return None

    async def _resolve_user_workspace(_request: Any, _token: Any) -> tuple[str, str]:
        return "user-1", "workspace-1"

    async def _extract_invited_context(
        _request: Any, _token: Any, _canvas_id: str
    ) -> tuple[str, str] | None:
        return None

    client = _TrashDbClient(rows)

    async def _get_db_client() -> Any:
        return client

    async def _backfill(_client: Any, doc: dict[str, Any], _workspace_id: str) -> dict[str, Any]:
        return doc

    async def _set_cached_snapshot(_workspace_id: str, _canvas_id: str, _doc: dict[str, Any]) -> str | None:
        return None

    async def _get_cached_snapshot(_workspace_id: str, _canvas_id: str) -> dict[str, Any] | None:
        return None

    class _WriteService:
        async def fetch_canvas_snapshot(self, **_kwargs: Any) -> dict[str, Any]:
            return {}

    class _CanvasDoc:
        @staticmethod
        def model_validate(value: Any) -> Any:
            return value

    service = CanvasQueryService(
        deps=CanvasQueryDependencies(
            resolve_user_workspace=_resolve_user_workspace,
            extract_invited_context=_extract_invited_context,
            get_db_client=_get_db_client,
            compose_doc=lambda row: row,
            compose_meta=lambda row: row,
            iso_to_ms=lambda _value: 0,
            make_meta_etag=lambda _workspace_id, _updated_at: "etag-meta",
            make_canvas_etag=lambda _canvas_id, _version, _updated_at: "etag-canvas",
            now_ts=lambda: 0,
            backfill_media_storage_paths_from_file_ids=_backfill,
            set_cached_snapshot=_set_cached_snapshot,
            get_cached_snapshot=_get_cached_snapshot,
            doc_needs_media_backfill=lambda _doc: False,
            create_write_service=_WriteService,
            canvas_doc_model=_CanvasDoc,
            canvas_version_model=dict,
            logger=_Logger(),
            realtime_write_enabled=False,
            snapshot_timeout_sec=0.1,
        )
    )
    return service, client


@pytest.mark.asyncio
async def test_canvas_query_service_sorts_deleted_canvases_by_node_count_before_paginating() -> None:
    service, client = _make_canvas_query_service_for_trash(
        [
            {
                "id": "canvas-small",
                "title": "Small",
                "doc": {"nodes": [1], "connections": []},
                "created_at": "2026-03-01T00:00:00Z",
                "updated_at": "2026-03-01T00:00:00Z",
                "deleted_at": "2026-03-05T00:00:00Z",
                "account_id": "workspace-1",
                "is_deleted": True,
            },
            {
                "id": "canvas-large",
                "title": "Large",
                "doc": {"nodes": [1, 2, 3, 4], "connections": []},
                "created_at": "2026-03-02T00:00:00Z",
                "updated_at": "2026-03-02T00:00:00Z",
                "deleted_at": "2026-03-06T00:00:00Z",
                "account_id": "workspace-1",
                "is_deleted": True,
            },
            {
                "id": "canvas-medium",
                "title": "Medium",
                "doc": {"nodes": [1, 2], "connections": []},
                "created_at": "2026-03-03T00:00:00Z",
                "updated_at": "2026-03-03T00:00:00Z",
                "deleted_at": "2026-03-04T00:00:00Z",
                "account_id": "workspace-1",
                "is_deleted": True,
            },
        ]
    )

    result = await service.list_deleted_canvases_with_meta(
        request=SimpleNamespace(),
        token=None,
        limit=2,
        offset=0,
        retention_days=15,
        q=None,
        sort_by="node_count",
        sort_dir="desc",
    )

    assert [item["id"] for item in result["items"]] == [
        "canvas-large",
        "canvas-medium",
    ]
    assert result["total_count"] == 3
    assert client.last_builder is not None
    assert client.last_builder.range_args is None


def test_canvas_command_application_helpers() -> None:
    assert _is_realtime_version_conflict({"error": "version_conflict"}) is True
    assert _is_realtime_version_conflict({"error": {"code": "version_conflict"}}) is True
    assert _is_realtime_version_conflict({"status_code": 409}) is True
    assert _is_realtime_version_conflict({"status_code": 200}) is False
    assert _extract_server_version({"serverVersion": "12"}) == 12
    assert _extract_server_version({"server_version": 7}) == 7
    assert _extract_server_version({"serverVersion": "abc"}) is None


def test_canvas_workspace_override_helpers() -> None:
    assert _parse_workspace_list(None) == set()
    assert _parse_workspace_list("") == set()
    assert _parse_workspace_list("w1,w2") == {"w1", "w2"}
    assert _parse_workspace_list('["w1", "w2"]') == {"w1", "w2"}
    assert _parse_workspace_list(["w1", "w2"]) == {"w1", "w2"}

    cfg = SimpleNamespace(
        CANVAS_REALTIME_WRITE_ENABLED=True,
        CANVAS_FORCE_LEGACY_WORKSPACES="w_legacy,w_staging",
    )
    assert _realtime_write_enabled_for_workspace(cfg, "w_live") is True
    assert _realtime_write_enabled_for_workspace(cfg, "w_legacy") is False

    cfg_disabled = SimpleNamespace(
        CANVAS_REALTIME_WRITE_ENABLED=False,
        CANVAS_FORCE_LEGACY_WORKSPACES="",
    )
    assert _realtime_write_enabled_for_workspace(cfg_disabled, "any") is False


@pytest.mark.asyncio
async def test_canvas_command_application_service_delegates_legacy_methods() -> None:
    calls: list[tuple[str, dict[str, Any]]] = []
    service = CanvasCommandApplicationService(
        deps=CanvasCommandDependencies(gateway=object()),
        legacy_handlers=CanvasCommandLegacyHandlers(
            save_canvas_version=_async_capture("save_canvas_version", calls),
            delete_canvas_version=_async_capture("delete_canvas_version", calls),
            purge_deleted_canvases=_async_capture("purge_deleted_canvases", calls),
            hard_delete_canvas=_async_capture("hard_delete_canvas", calls),
            restore_canvases_batch=_async_capture("restore_canvases_batch", calls),
            purge_canvases_by_ids=_async_capture("purge_canvases_by_ids", calls),
            ensure_thread_for_canvas=_async_capture("ensure_thread_for_canvas", calls),
        )
    )

    await service.purge_canvases_by_ids(payload={"ids": ["c1"]}, request="req", token="token")
    await service.ensure_thread_for_canvas(canvas_id="c1", request="req", token="token")

    assert calls[0][0] == "purge_canvases_by_ids"
    assert calls[0][1]["payload"] == {"ids": ["c1"]}
    assert calls[1][0] == "ensure_thread_for_canvas"
    assert calls[1][1]["canvas_id"] == "c1"


@pytest.mark.asyncio
async def test_canvas_command_delete_canvas_works_without_legacy_use_case_exports(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.application.services import canvas_command_application_service as service_module

    calls: dict[str, Any] = {}

    class _FakeDeleteCanvasUseCase:
        def __init__(self, repository: Any) -> None:
            calls["repository"] = repository

        async def execute(self, **kwargs: Any) -> None:
            calls["execute_kwargs"] = kwargs

    class _FakeRepository:
        pass

    monkeypatch.setattr(service_module, "DeleteCanvasUseCase", _FakeDeleteCanvasUseCase)
    monkeypatch.setattr(service_module, "SupabaseCanvasRepository", _FakeRepository)

    async def _resolve_user_workspace(_request: Any, _token: Any) -> tuple[str, str]:
        return "u1", "w1"

    async def _delete_canvas_search_index(*_args: Any, **_kwargs: Any) -> None:
        calls["search_index_deleted"] = True

    async def _bump_workspace_version_and_broadcast(*_args: Any, **_kwargs: Any) -> None:
        calls["workspace_bumped"] = True

    async def _cache_delete(*_args: Any, **_kwargs: Any) -> None:
        calls["snapshot_cache_deleted"] = True

    async def _broadcast_canvas_update(*_args: Any, **_kwargs: Any) -> None:
        calls["canvas_broadcasted"] = True

    class _Logger:
        def warning(self, *_args: Any, **_kwargs: Any) -> None:
            return None

        def error(self, *_args: Any, **_kwargs: Any) -> None:
            return None

    loop = asyncio.get_running_loop()
    db_client_future: asyncio.Future[Any] = loop.create_future()
    db_client_future.set_result(object())

    legacy_api = SimpleNamespace(
        _resolve_user_workspace=_resolve_user_workspace,
        utils=SimpleNamespace(db=SimpleNamespace(client=db_client_future)),
        delete_canvas_search_index=_delete_canvas_search_index,
        bump_workspace_version_and_broadcast=_bump_workspace_version_and_broadcast,
        cache_service=SimpleNamespace(delete=_cache_delete),
        _snapshot_cache_key=lambda workspace_id, canvas_id: f"{workspace_id}:{canvas_id}",
        _broadcast_canvas_update=_broadcast_canvas_update,
        logger=_Logger(),
    )

    async def _noop(**_kwargs: Any) -> Any:
        return None

    service = CanvasCommandApplicationService(
        deps=CanvasCommandDependencies(gateway=legacy_api),
        legacy_handlers=CanvasCommandLegacyHandlers(
            save_canvas_version=_noop,
            delete_canvas_version=_noop,
            purge_deleted_canvases=_noop,
            hard_delete_canvas=_noop,
            restore_canvases_batch=_noop,
            purge_canvases_by_ids=_noop,
            ensure_thread_for_canvas=_noop,
        ),
    )

    result = await service.delete_canvas(canvas_id="canvas_1", request=object(), token=None)
    assert result == {"success": True}
    assert calls["execute_kwargs"]["canvas_id"] == "canvas_1"
    assert calls["execute_kwargs"]["workspace_id"] == "w1"
    assert calls["execute_kwargs"]["actor_id"] == "u1"
    assert calls["search_index_deleted"] is True
    assert calls["workspace_bumped"] is True
    assert calls["snapshot_cache_deleted"] is True
    assert calls["canvas_broadcasted"] is True


@pytest.mark.asyncio
async def test_canvas_command_apply_legacy_forces_tool_legacy_and_appends_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core.application.services import canvas_command_application_service as service_module

    tool_calls: dict[str, Any] = {}
    append_calls: list[dict[str, Any]] = []

    class _FakeCanvasEditTool:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            return None

        async def edit(self, **kwargs: Any) -> Any:
            tool_calls["kwargs"] = kwargs
            return SimpleNamespace(
                success=True,
                output={
                    "canvas": {
                        "id": "canvas_1",
                        "title": "Canvas",
                        "nodes": [],
                        "connections": [],
                        "version": "1.0.0",
                        "updatedAt": 123,
                        "serverVersion": 9,
                    },
                    "applied": [],
                    "id_map": {},
                },
                error=None,
            )

    class _FakeAppendUseCase:
        def __init__(self, _repository: Any) -> None:
            return None

        async def execute(self, **kwargs: Any) -> Any:
            append_calls.append(kwargs)
            return None

    class _FakeCollabRepo:
        pass

    class _TableQuery:
        def select(self, *_args: Any, **_kwargs: Any) -> "_TableQuery":
            return self

        def eq(self, *_args: Any, **_kwargs: Any) -> "_TableQuery":
            return self

        def limit(self, *_args: Any, **_kwargs: Any) -> "_TableQuery":
            return self

        def order(self, *_args: Any, **_kwargs: Any) -> "_TableQuery":
            return self

        async def execute(self) -> Any:
            return SimpleNamespace(data=[])

    class _Client:
        def table(self, *_args: Any, **_kwargs: Any) -> _TableQuery:
            return _TableQuery()

    class _Logger:
        def info(self, *_args: Any, **_kwargs: Any) -> None:
            return None

        def warning(self, *_args: Any, **_kwargs: Any) -> None:
            return None

        def error(self, *_args: Any, **_kwargs: Any) -> None:
            return None

    async def _resolve_user_workspace(_request: Any, _token: Any) -> tuple[str, str]:
        return "u1", "w_legacy"

    async def _bump_workspace_version_and_broadcast(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def _sync_canvas_file_links(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def _rebuild_canvas_search_index(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def _legacy_noop(**_kwargs: Any) -> Any:
        return None

    monkeypatch.setattr(service_module, "CanvasEditTool", _FakeCanvasEditTool)
    monkeypatch.setattr(
        service_module,
        "AppendCollaborationOperationsUseCase",
        _FakeAppendUseCase,
    )
    monkeypatch.setattr(
        service_module,
        "SupabaseCollaborationRepository",
        _FakeCollabRepo,
    )

    loop = asyncio.get_running_loop()
    db_client_future: asyncio.Future[Any] = loop.create_future()
    db_client_future.set_result(_Client())

    gateway = SimpleNamespace(
        _resolve_user_workspace=_resolve_user_workspace,
        config=SimpleNamespace(
            CANVAS_ENFORCE_CLIENT_IDS=False,
            CANVAS_REALTIME_WRITE_ENABLED=True,
            CANVAS_FORCE_LEGACY_WORKSPACES="w_legacy",
        ),
        logger=_Logger(),
        utils=SimpleNamespace(db=SimpleNamespace(client=db_client_future)),
        bump_workspace_version_and_broadcast=_bump_workspace_version_and_broadcast,
        _sync_canvas_file_links=_sync_canvas_file_links,
        rebuild_canvas_search_index=_rebuild_canvas_search_index,
        bump_canvas_server_version=lambda *_args, **_kwargs: asyncio.sleep(0, result=10),
    )

    service = CanvasCommandApplicationService(
        deps=CanvasCommandDependencies(gateway=gateway),
        legacy_handlers=CanvasCommandLegacyHandlers(
            save_canvas_version=_legacy_noop,
            delete_canvas_version=_legacy_noop,
            purge_deleted_canvases=_legacy_noop,
            hard_delete_canvas=_legacy_noop,
            restore_canvases_batch=_legacy_noop,
            purge_canvases_by_ids=_legacy_noop,
            ensure_thread_for_canvas=_legacy_noop,
        ),
    )

    payload = SimpleNamespace(operations=[{"op": "update_canvas", "patch": {"title": "x"}}])
    request = SimpleNamespace(headers={})

    result = await service.apply_canvas_operations(
        canvas_id="canvas_1",
        payload=payload,
        request=request,
        token=None,
        expected_version=None,
    )

    assert result["canvas"]["id"] == "canvas_1"
    assert tool_calls["kwargs"]["force_legacy_write"] is True
    assert tool_calls["kwargs"]["record_collaboration_ops"] is False
    assert len(append_calls) == 1
    assert append_calls[0]["session_id"] == "rest:u1"
    assert append_calls[0]["canvas_id"] == "canvas_1"
    assert append_calls[0]["workspace_id"] == "w_legacy"


@pytest.mark.asyncio
async def test_apply_survives_record_event_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.application.services import canvas_command_application_service as service_module

    append_calls: list[dict[str, Any]] = []
    record_calls: list[dict[str, Any]] = []

    class _FakeWriteService:
        async def apply_canvas_ops(self, **_kwargs: Any) -> dict[str, Any]:
            return {
                "canvas": {
                    "id": "canvas_1",
                    "title": "Canvas",
                    "nodes": [],
                    "connections": [],
                    "updatedAt": 123,
                    "serverVersion": 11,
                },
                "serverVersion": 11,
                "applied": [],
            }

    class _FakeAppendUseCase:
        def __init__(self, _repository: Any) -> None:
            return None

        async def execute(self, **kwargs: Any) -> Any:
            append_calls.append(kwargs)
            return None

    class _FakeCollabRepo:
        pass

    async def _record_event(*_args: Any, **kwargs: Any) -> None:
        record_calls.append(kwargs)
        raise RuntimeError("outbox down")

    class _Logger:
        def info(self, *_args: Any, **_kwargs: Any) -> None:
            return None

        def warning(self, *_args: Any, **_kwargs: Any) -> None:
            return None

        def error(self, *_args: Any, **_kwargs: Any) -> None:
            return None

    async def _resolve_user_workspace(_request: Any, _token: Any) -> tuple[str, str]:
        return "u1", "w1"

    async def _set_cached_snapshot(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def _legacy_noop(**_kwargs: Any) -> Any:
        return None

    monkeypatch.setattr(service_module, "CanvasWriteService", _FakeWriteService)
    monkeypatch.setattr(service_module, "AppendCollaborationOperationsUseCase", _FakeAppendUseCase)
    monkeypatch.setattr(service_module, "SupabaseCollaborationRepository", _FakeCollabRepo)
    monkeypatch.setattr(service_module, "record_event", _record_event)

    gateway = SimpleNamespace(
        _resolve_user_workspace=_resolve_user_workspace,
        config=SimpleNamespace(
            CANVAS_ENFORCE_CLIENT_IDS=False,
            CANVAS_REALTIME_WRITE_ENABLED=True,
            CANVAS_FORCE_LEGACY_WORKSPACES="",
        ),
        logger=_Logger(),
        _set_cached_snapshot=_set_cached_snapshot,
    )

    service = CanvasCommandApplicationService(
        deps=CanvasCommandDependencies(gateway=gateway),
        legacy_handlers=CanvasCommandLegacyHandlers(
            save_canvas_version=_legacy_noop,
            delete_canvas_version=_legacy_noop,
            purge_deleted_canvases=_legacy_noop,
            hard_delete_canvas=_legacy_noop,
            restore_canvases_batch=_legacy_noop,
            purge_canvases_by_ids=_legacy_noop,
            ensure_thread_for_canvas=_legacy_noop,
        ),
    )

    payload = SimpleNamespace(operations=[{"op": "update_canvas", "patch": {"title": "x"}}])
    request = SimpleNamespace(headers={})
    result = await service.apply_canvas_operations(
        canvas_id="canvas_1",
        payload=payload,
        request=request,
        token=None,
        expected_version=None,
    )

    assert result["serverVersion"] == 11
    assert record_calls
    assert len(append_calls) == 1


def test_canvas_legacy_api_symbol_references_are_valid() -> None:
    import core.canvas.api as legacy_canvas_api

    backend_root = Path(__file__).resolve().parents[1]
    targets = [
        backend_root / "core/application/services/canvas_command_application_service.py",
        backend_root / "core/interfaces/http/canvas/service_bindings.py",
    ]
    pattern = re.compile(r"legacy_canvas_api\\.([A-Za-z_][A-Za-z0-9_]*)")
    missing: list[str] = []

    for target in targets:
        content = target.read_text(encoding="utf-8")
        for symbol in sorted(set(pattern.findall(content))):
            if not hasattr(legacy_canvas_api, symbol):
                missing.append(f"{target}:{symbol}")

    assert not missing, f"Missing legacy canvas api symbols: {missing}"


@pytest.mark.asyncio
async def test_canvas_share_service_delegates_to_bound_handlers() -> None:
    calls: list[tuple[str, dict[str, Any]]] = []
    service = CanvasShareService(
        deps=CanvasShareDependencies(
            create_canvas_invite=_async_capture("create_canvas_invite", calls),
            list_canvas_invites=_async_capture("list_canvas_invites", calls),
            revoke_canvas_invite=_async_capture("revoke_canvas_invite", calls),
            verify_canvas_invite=_async_capture("verify_canvas_invite", calls),
            get_canvas_share_health=_async_capture("get_canvas_share_health", calls),
            get_canvas_share_status=_async_capture("get_canvas_share_status", calls),
            update_canvas_share=_async_capture("update_canvas_share", calls),
            get_public_canvas_snapshot=_async_capture("get_public_canvas_snapshot", calls),
            list_public_canvas_versions=_async_capture("list_public_canvas_versions", calls),
            list_public_canvas_timeline=_async_capture("list_public_canvas_timeline", calls),
        )
    )

    await service.update_canvas_share(
        canvas_id="c1",
        request="req",
        token="token",
        payload={"is_public": True},
    )
    await service.list_public_canvas_timeline(canvas_id="c1", order_direction="asc", limit=20)

    assert calls[0][0] == "update_canvas_share"
    assert calls[0][1]["payload"] == {"is_public": True}
    assert calls[1][0] == "list_public_canvas_timeline"


@pytest.mark.asyncio
async def test_canvas_ai_service_delegates_to_bound_handlers() -> None:
    calls: list[tuple[str, dict[str, Any]]] = []
    service = CanvasAIService(
        deps=CanvasAIDependencies(
            stream_canvas_selection_chat=_async_capture("stream_canvas_selection_chat", calls),
            generate_selection_infographic=_async_capture("generate_selection_infographic", calls),
            generate_canvas_title=_async_capture("generate_canvas_title", calls),
            resolve_external_video_metadata=_async_capture("resolve_external_video_metadata", calls),
            generate_canvas_media=_async_capture("generate_canvas_media", calls),
        )
    )

    await service.resolve_external_video_metadata(
        canvas_id="c1",
        request="req",
        token="token",
        payload={"url": "https://example.com/v"},
    )
    await service.generate_canvas_title(
        canvas_id="c1",
        request="req",
        token="token",
        payload={"title": "x"},
    )

    assert calls[0][0] == "resolve_external_video_metadata"
    assert calls[0][1]["payload"] == {"url": "https://example.com/v"}
    assert calls[1][0] == "generate_canvas_title"
