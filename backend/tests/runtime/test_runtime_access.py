from __future__ import annotations

from types import SimpleNamespace
from typing import Any, List

import pytest
from fastapi import HTTPException

from core.runtime.access import resolve_runtime_context_by_project_ref, verify_runtime_access


class _FakeQuery:
    def __init__(self, outcomes: List[Any]) -> None:
        self._outcomes = list(outcomes)

    def select(self, *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        return self

    def eq(self, *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        return self

    def limit(self, *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        return self

    async def execute(self) -> SimpleNamespace:
        if not self._outcomes:
            raise AssertionError("No scripted outcome left for execute()")
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return SimpleNamespace(data=outcome)


class _FakeSchemaProxy:
    def __init__(self, client: "_FakeClient") -> None:
        self._client = client

    def from_(self, name: str) -> _FakeQuery:
        return self._client.table(name)


class _FakeClient:
    def __init__(self, scripted_queries: List[List[Any]]) -> None:
        self._scripted_queries = [list(item) for item in scripted_queries]
        self.table_calls: List[str] = []

    def table(self, name: str) -> _FakeQuery:
        self.table_calls.append(name)
        if not self._scripted_queries:
            raise AssertionError(f"No scripted query left for table({name})")
        return _FakeQuery(self._scripted_queries.pop(0))

    def schema(self, _name: str) -> _FakeSchemaProxy:
        return _FakeSchemaProxy(self)


def _project_row(*, project_id: str = "project_1", account_id: str = "acc_1", is_public: bool = False) -> dict[str, Any]:
    return {
        "project_id": project_id,
        "account_id": account_id,
        "name": "Demo Project",
        "description": None,
        "is_public": is_public,
    }


@pytest.mark.asyncio
async def test_resolve_runtime_context_by_project_ref_requires_runtime_ref() -> None:
    client = _FakeClient(scripted_queries=[])
    with pytest.raises(HTTPException) as exc_info:
        await resolve_runtime_context_by_project_ref(client, "")
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_verify_runtime_access_allows_public_runtime_without_auth() -> None:
    client = _FakeClient(scripted_queries=[[[ _project_row(is_public=True) ]]])
    result = await verify_runtime_access(
        client,
        "project_1",
        user_id=None,
        allow_anonymous_public=True,
    )

    assert result["project_id"] == "project_1"
    assert result["runtime"]["mode"] == "cloud"
    assert result["runtime"]["runtime_ref"] == "project_1"
    assert client.table_calls == ["projects"]


@pytest.mark.asyncio
async def test_verify_runtime_access_requires_auth_for_private_runtime() -> None:
    client = _FakeClient(scripted_queries=[[[ _project_row(is_public=False) ]]])
    with pytest.raises(HTTPException) as exc_info:
        await verify_runtime_access(
            client,
            "project_1",
            user_id=None,
            allow_anonymous_public=True,
        )
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_verify_runtime_access_allows_private_project_member() -> None:
    client = _FakeClient(
        scripted_queries=[
            [[_project_row(is_public=False)]],
            [[{"account_role": "owner"}]],
        ]
    )
    result = await verify_runtime_access(
        client,
        "project_1",
        user_id="user_1",
        allow_anonymous_public=False,
    )

    assert result["project_id"] == "project_1"
    assert result["runtime"]["mode"] == "cloud"
    assert client.table_calls == ["projects", "account_user"]


@pytest.mark.asyncio
async def test_verify_runtime_access_denies_non_member() -> None:
    client = _FakeClient(
        scripted_queries=[
            [[_project_row(is_public=False)]],
            [[]],
        ]
    )
    with pytest.raises(HTTPException) as exc_info:
        await verify_runtime_access(
            client,
            "project_1",
            user_id="user_1",
            allow_anonymous_public=False,
        )
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_verify_runtime_access_raises_not_found_for_missing_project() -> None:
    client = _FakeClient(scripted_queries=[[[]]])
    with pytest.raises(HTTPException) as exc_info:
        await verify_runtime_access(
            client,
            "missing_project",
            user_id="user_1",
            allow_anonymous_public=False,
        )
    assert exc_info.value.status_code == 404

