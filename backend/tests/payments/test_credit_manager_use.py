from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.credit_manager import CreditManager


class _Resp:
    def __init__(self, data): self.data = data


class _Query:
    def __init__(self, store, table): self._store = store; self._table = table; self._patch = None
    def select(self, *a, **k):
        if a:
            self._store["selects"].append(a[0])
        return self
    def eq(self, *a, **k): return self
    def update(self, patch): self._patch = patch; return self
    async def execute(self):
        if self._patch is not None:
            self._store["updates"].append(self._patch); return _Resp([{}])
        return _Resp(self._store["rows"])


class _FakeClient:
    def __init__(self, store): self._store = store
    def from_(self, table): return _Query(self._store, table)


class _DB:
    def __init__(self, client): self._client = client
    @property
    async def client(self): return self._client


def _cm(rows):
    store = {"rows": rows, "updates": [], "selects": []}
    cm = CreditManager.__new__(CreditManager)
    cm.db = _DB(_FakeClient(store))
    return cm, store


@pytest.fixture(autouse=True)
def _patch_io(monkeypatch):
    async def _noop(*a, **k): return None
    monkeypatch.setattr("core.billing.credit_manager.Cache.invalidate", _noop)

    class _UC:
        def __init__(self, *a, **k): ...
        async def execute(self, **k): return None
    monkeypatch.setattr("core.billing.credit_manager.RecordUsageUseCase", _UC)
    monkeypatch.setattr("core.billing.credit_manager.SupabaseBillingRepository",
                        lambda *a, **k: object())


async def test_deducts_expiring_first_then_non_expiring():
    cm, store = _cm([{"expiring_credits": 3, "non_expiring_credits": 10,
                      "balance": 13, "daily_login_remaining": 0}])
    res = await cm.use_credits(account_id="a1", amount=Decimal("5"), description="x")
    assert res["success"] and res["from_expiring"] == 3.0 and res["from_non_expiring"] == 2.0
    assert res["new_total"] == 8.0
    assert "unlimited" not in res
    assert store["updates"][0]["expiring_credits"] == 0.0
    assert store["updates"][0]["non_expiring_credits"] == 8.0


async def test_insufficient_credits_rejected():
    cm, _ = _cm([{"expiring_credits": 1, "non_expiring_credits": 1,
                  "balance": 2, "daily_login_remaining": 0}])
    res = await cm.use_credits(account_id="a1", amount=Decimal("5"), description="x")
    assert res["success"] is False and res["error"] == "Insufficient credits"
    assert res["required"] == 5.0 and res["available"] == 2.0


async def test_no_account_rejected():
    cm, _ = _cm([])
    res = await cm.use_credits(account_id="a1", amount=Decimal("1"), description="x")
    assert res["success"] is False and res["error"] == "No credit account found"


async def test_does_not_select_tier_or_subscription_columns():
    cm, store = _cm([{"expiring_credits": 0, "non_expiring_credits": 5,
                      "balance": 5, "daily_login_remaining": 0}])
    res = await cm.use_credits(account_id="a1", amount=Decimal("5"), description="x")
    assert res["success"] and res["from_non_expiring"] == 5.0
    assert "unlimited" not in res
    selected = " ".join(store["selects"])
    assert "tier" not in selected
    assert "subscription_id" not in selected
