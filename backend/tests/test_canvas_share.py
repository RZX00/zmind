from __future__ import annotations

import pytest
from fastapi import HTTPException

from core.canvas import api as canvas_api


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeTable:
    def __init__(self, client, table, schema=None):
        self.client = client
        self.table = table
        self.schema = schema
        self._select = None
        self._update = None
        self._filters = {}

    def select(self, fields):
        self._select = fields
        return self

    def update(self, payload):
        self._update = payload
        return self

    def eq(self, key, value):
        self._filters[key] = value
        return self

    def limit(self, _n):
        return self

    async def execute(self):
        if self.schema == "basejump" and self.table == "account_user":
            return FakeResponse([{"account_role": self.client.account_role}])

        if self.table == "canvases":
            if not self.client.canvas_row:
                return FakeResponse([])
            if self._update is not None:
                self.client.canvas_row.update(self._update)
                return FakeResponse([self.client.canvas_row])

            cols = []
            if isinstance(self._select, str):
                cols = [c.strip() for c in self._select.split(",") if c.strip()]
            elif self._select is None:
                cols = list(self.client.canvas_row.keys())
            else:
                cols = list(self._select)

            for col in cols:
                if col in ("id", "account_id"):
                    continue
                if col not in self.client.share_columns:
                    raise Exception(f"column {col} does not exist")

            row = {k: self.client.canvas_row.get(k) for k in cols}
            if "id" in cols:
                row["id"] = self.client.canvas_row.get("id")
            if "account_id" in cols:
                row["account_id"] = self.client.canvas_row.get("account_id")
            return FakeResponse([row])

        if self.table == "public_canvas_shares":
            if not self.client.public_share_row:
                return FakeResponse([])
            canvas_filter = self._filters.get("canvas_id")
            if canvas_filter and self.client.public_share_row.get("canvas_id") != canvas_filter:
                return FakeResponse([])

            cols = []
            if isinstance(self._select, str):
                cols = [c.strip() for c in self._select.split(",") if c.strip()]
            elif self._select is None:
                cols = list(self.client.public_share_row.keys())
            else:
                cols = list(self._select)

            row = {k: self.client.public_share_row.get(k) for k in cols}
            return FakeResponse([row])

        return FakeResponse([])


class FakeSchema:
    def __init__(self, client, schema):
        self.client = client
        self.schema = schema

    def from_(self, table):
        return FakeTable(self.client, table, schema=self.schema)


class FakeClient:
    def __init__(
        self,
        canvas_row,
        share_columns=None,
        account_role="owner",
        public_share_row=None,
    ):
        self.canvas_row = canvas_row
        self.share_columns = set(share_columns or (canvas_row.keys() if canvas_row else []))
        self.account_role = account_role
        self.public_share_row = public_share_row

    def table(self, name):
        return FakeTable(self, name)

    def schema(self, name):
        return FakeSchema(self, name)


class DummyDB:
    def __init__(self, client):
        self._client = client

    @property
    async def client(self):
        return self._client


async def _fake_resolve_user_workspace(_request=None, _token=None):
    return "user-1", "workspace-1"


async def _noop(*_args, **_kwargs):
    return None


@pytest.mark.asyncio
async def test_share_health_missing_schema(monkeypatch):
    client = FakeClient(
        canvas_row={"id": "c1", "account_id": "workspace-1"},
        share_columns={"id", "account_id"},
    )
    monkeypatch.setattr(canvas_api.utils, "db", DummyDB(client))
    monkeypatch.setattr(canvas_api, "_resolve_user_workspace", _fake_resolve_user_workspace)

    resp = await canvas_api.get_canvas_share_health(request=None, token=None)
    assert resp["share_supported"] is False
    assert "is_public" in resp["missing"]


@pytest.mark.asyncio
async def test_share_status_returns_flags(monkeypatch):
    canvas_row = {
        "id": "c1",
        "account_id": "workspace-1",
        "is_public": True,
        "is_listed": False,
        "timeline_enabled": True,
        "public_shows_timeline": True,
        "listed_at": None,
    }
    client = FakeClient(
        canvas_row=canvas_row,
        share_columns=set(canvas_row.keys()),
    )
    monkeypatch.setattr(canvas_api.utils, "db", DummyDB(client))
    monkeypatch.setattr(canvas_api, "_resolve_user_workspace", _fake_resolve_user_workspace)

    resp = await canvas_api.get_canvas_share_status("c1", request=None, token=None)
    assert resp["is_public"] is True
    assert resp["is_listed"] is False
    assert resp["timeline_enabled"] is True


@pytest.mark.asyncio
async def test_share_update_requires_owner(monkeypatch):
    canvas_row = {
        "id": "c1",
        "account_id": "workspace-1",
        "is_public": False,
        "is_listed": False,
        "timeline_enabled": False,
        "public_shows_timeline": False,
        "listed_at": None,
    }
    client = FakeClient(
        canvas_row=canvas_row,
        share_columns=set(canvas_row.keys()),
        account_role="member",
    )
    monkeypatch.setattr(canvas_api.utils, "db", DummyDB(client))
    monkeypatch.setattr(canvas_api, "_resolve_user_workspace", _fake_resolve_user_workspace)

    with pytest.raises(HTTPException) as exc:
        await canvas_api.update_canvas_share(
            "c1",
            request=None,
            token=None,
            payload=canvas_api.CanvasShareUpdateRequest(is_public=True),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_share_update_sets_flags(monkeypatch):
    canvas_row = {
        "id": "c1",
        "account_id": "workspace-1",
        "is_public": False,
        "is_listed": False,
        "timeline_enabled": False,
        "public_shows_timeline": False,
        "listed_at": None,
    }
    client = FakeClient(
        canvas_row=canvas_row,
        share_columns=set(canvas_row.keys()),
        account_role="owner",
    )
    monkeypatch.setattr(canvas_api.utils, "db", DummyDB(client))
    monkeypatch.setattr(canvas_api, "_resolve_user_workspace", _fake_resolve_user_workspace)
    monkeypatch.setattr(canvas_api, "_sync_legacy_public_flags", _noop)

    resp = await canvas_api.update_canvas_share(
        "c1",
        request=None,
        token=None,
        payload=canvas_api.CanvasShareUpdateRequest(
            is_public=True,
            is_listed=True,
            timeline_enabled=True,
            public_shows_timeline=True,
        ),
    )
    assert resp["is_public"] is True
    assert resp["is_listed"] is True
    assert resp["timeline_enabled"] is True


@pytest.mark.asyncio
async def test_public_share_guard_prefers_canvas_when_projection_mismatch():
    canvas_row = {
        "id": "c1",
        "account_id": "workspace-1",
        "is_public": True,
        "public_shows_timeline": True,
        "timeline_enabled": True,
    }
    projection_row = {
        "canvas_id": "c1",
        "is_public": False,
        "public_shows_timeline": False,
        "timeline_enabled": False,
    }
    client = FakeClient(
        canvas_row=canvas_row,
        share_columns=set(canvas_row.keys()),
        public_share_row=projection_row,
    )
    row = await canvas_api._resolve_public_share_guard_row(client, "c1")
    assert row is not None
    assert bool(row.get("is_public")) is True
    assert bool(row.get("public_shows_timeline")) is True
    assert bool(row.get("timeline_enabled")) is True


@pytest.mark.asyncio
async def test_public_share_guard_uses_canvas_when_projection_missing():
    canvas_row = {
        "id": "c1",
        "account_id": "workspace-1",
        "is_public": True,
        "public_shows_timeline": False,
        "timeline_enabled": True,
    }
    client = FakeClient(
        canvas_row=canvas_row,
        share_columns=set(canvas_row.keys()),
        public_share_row=None,
    )
    row = await canvas_api._resolve_public_share_guard_row(client, "c1")
    assert row is not None
    assert bool(row.get("is_public")) is True
    assert bool(row.get("public_shows_timeline")) is False
