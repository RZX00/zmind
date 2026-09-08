from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.credit_manager import CreditManager


class _Resp:
    def __init__(self, data): self.data = data


class _Query:
    def __init__(self, behavior): self._b = behavior; self._limit = None
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def limit(self, n): self._limit = n; return self
    async def execute(self):
        if self._limit == 1:           # ledger existence check
            return _Resp(self._b["ledger"])
        return _Resp(self._b["account"])


class _FakeClient:
    def __init__(self, behavior): self._b = behavior
    def from_(self, table): return _Query(self._b)


class _DB:
    def __init__(self, c): self._c = c
    async def initialize(self): ...
    @property
    async def client(self): return self._c


@pytest.fixture(autouse=True)
def _prod(monkeypatch):
    from core.utils.config import EnvMode
    monkeypatch.setattr("core.billing.credit_manager.config.ENV_MODE",
                        EnvMode.PRODUCTION, raising=False)
    monkeypatch.setattr("core.billing.credit_manager.FREE_TIER_INITIAL_CREDITS",
                        Decimal("1.00"), raising=False)


def _cm(behavior):
    cm = CreditManager.__new__(CreditManager)
    cm.db = _DB(_FakeClient(behavior))
    return cm


async def test_welcome_bonus_granted_for_empty_account(monkeypatch):
    calls = {}
    async def _add(**kw): calls.update(kw); return {"success": True, "total_balance": 1.0}
    cm = _cm({"account": [{"balance": 0, "tier": "none"}], "ledger": []})
    monkeypatch.setattr(cm, "add_credits", _add)
    res = await cm.ensure_welcome_bonus("u1")
    assert res == Decimal("1.0")
    assert calls["billing_dedup_key"] == "welcome_bonus:u1"
    assert calls["is_expiring"] is False and calls["type"] == "welcome_bonus"


async def test_welcome_bonus_skipped_when_ledger_exists(monkeypatch):
    cm = _cm({"account": [{"balance": 0, "tier": "none"}], "ledger": [{"id": "x"}]})
    monkeypatch.setattr(cm, "add_credits",
                        lambda **kw: (_ for _ in ()).throw(AssertionError("must not grant")))
    assert await cm.ensure_welcome_bonus("u1") is None


async def test_welcome_bonus_skipped_when_balance_positive(monkeypatch):
    cm = _cm({"account": [{"balance": 5, "tier": "free"}], "ledger": []})
    monkeypatch.setattr(cm, "add_credits",
                        lambda **kw: (_ for _ in ()).throw(AssertionError("must not grant")))
    assert await cm.ensure_welcome_bonus("u1") is None
