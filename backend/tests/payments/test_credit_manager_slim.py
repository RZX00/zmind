from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.credit_manager import CreditManager


class _FakeRpc:
    def __init__(self, row): self._row = row
    async def execute(self):
        class _R: pass
        r = _R(); r.data = [self._row]; return r


class _FakeClient:
    def __init__(self, row): self._row = row; self.rpc_calls = []; self.table_calls = []
    def rpc(self, name, params):
        self.rpc_calls.append((name, params)); return _FakeRpc(self._row)
    def from_(self, *a, **k):
        self.table_calls.append(a)
        raise AssertionError("add_credits must NOT touch credit_accounts/credit_ledger directly")


class _DB:
    def __init__(self, client): self._client = client
    @property
    async def client(self): return self._client


def _cm(row):
    cm = CreditManager.__new__(CreditManager)
    cm.db = _DB(_FakeClient(row))
    return cm


@pytest.fixture(autouse=True)
def _patch_cache(monkeypatch):
    async def _noop(*a, **k): return None
    monkeypatch.setattr("core.billing.credit_manager.Cache.invalidate", _noop)


async def test_add_credits_routes_through_rpc():
    row = {"success": True, "duplicate": False, "expiring_credits": 0,
           "non_expiring_credits": 5, "new_balance": 5, "transaction_id": "tx_1"}
    cm = _cm(row)
    res = await cm.add_credits(account_id="a1", amount=Decimal("5"), is_expiring=False,
                               description="Top-up o1", type="purchase",
                               billing_dedup_key="order:o1")
    assert res["success"] and res["total_balance"] == 5.0 and res["transaction_id"] == "tx_1"
    client = await cm.db.client
    assert client.rpc_calls[0][0] == "add_credits_idempotent"
    assert client.rpc_calls[0][1]["p_billing_dedup_key"] == "order:o1"


async def test_add_credits_reports_duplicate():
    row = {"success": True, "duplicate": True, "expiring_credits": 0,
           "non_expiring_credits": 5, "new_balance": 5, "transaction_id": "tx_1"}
    res = await _cm(row).add_credits(account_id="a1", amount=Decimal("5"),
                                     is_expiring=False, billing_dedup_key="order:o1")
    assert res["success"] and res["duplicate_prevented"] is True


async def test_add_credits_requires_dedup_key():
    res = await _cm({}).add_credits(account_id="a1", amount=Decimal("5"), is_expiring=False)
    assert res["success"] is False and "billing_dedup_key" in res["error"]
