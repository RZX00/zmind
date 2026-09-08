from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.payments import settings as st


class _Resp:
    def __init__(self, data): self.data = data


class _Query:
    def __init__(self, store): self._store = store; self._patch = None
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def limit(self, n): return self
    def upsert(self, patch): self._store["upserts"].append(patch); return self
    async def execute(self):
        if self._store["upserts"] and self._store["upserts"][-1] is not None:
            return _Resp([{}])
        return _Resp(self._store["rows"])


class _FakeClient:
    def __init__(self, store): self._store = store
    def from_(self, table): return _Query(self._store)


class _DB:
    def __init__(self, store): self._store = store
    @property
    async def client(self): return _FakeClient(self._store)


@pytest.fixture(autouse=True)
def _patch_cache_config(monkeypatch):
    cache = {}
    async def _get(k): return cache.get(k)
    async def _set(k, v, ttl=None): cache[k] = v
    async def _inv(k): cache.pop(k, None)
    monkeypatch.setattr("core.billing.payments.settings.Cache.get", _get)
    monkeypatch.setattr("core.billing.payments.settings.Cache.set", _set)
    monkeypatch.setattr("core.billing.payments.settings.Cache.invalidate", _inv)
    monkeypatch.setattr("core.billing.payments.settings.config.USD_CNY_RATE_STATIC", 7, raising=False)


async def test_get_rate_reads_admin_value():
    db = _DB({"rows": [{"usd_cny_rate": "7.35"}], "upserts": []})
    assert await st.get_usd_cny_rate(db) == Decimal("7.35")


async def test_get_rate_falls_back_to_default_7():
    db = _DB({"rows": [], "upserts": []})
    assert await st.get_usd_cny_rate(db) == Decimal("7")


async def test_set_rate_rejects_nonpositive():
    db = _DB({"rows": [], "upserts": []})
    with pytest.raises(ValueError):
        await st.set_usd_cny_rate(db, Decimal("0"))


async def test_set_rate_writes_and_returns():
    db = _DB({"rows": [], "upserts": []})
    out = await st.set_usd_cny_rate(db, Decimal("7.1"), updated_by="admin-1")
    assert out == Decimal("7.1")
