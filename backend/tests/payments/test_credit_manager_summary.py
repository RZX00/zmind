from __future__ import annotations
from core.billing.credit_manager import CreditManager


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, behavior):
        self._b = behavior

    def select(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def order(self, *a, **k):
        return self

    def limit(self, n):
        return self

    async def execute(self):
        return _Resp(self._b)


class _FakeClient:
    def __init__(self, account_rows, ledger_rows):
        self._account = account_rows
        self._ledger = ledger_rows

    def from_(self, table):
        return _Query(self._account if table == "credit_accounts" else self._ledger)


class _DB:
    def __init__(self, c):
        self._c = c

    @property
    async def client(self):
        return self._c


def _cm(account_rows, ledger_rows):
    cm = CreditManager.__new__(CreditManager)
    cm.db = _DB(_FakeClient(account_rows, ledger_rows))
    return cm


async def test_summary_shape():
    cm = _cm(
        [{"balance": 12, "tier": "standard", "last_grant_date": "2026-06-21T00:00:00Z"}],
        [
            {"type": "tier_grant", "amount": 5.0, "description": "grant"},
            {"type": "purchase", "amount": 7.0, "description": "topup"},
            {"type": "usage", "amount": -1.0, "description": "run"},
        ],
    )
    s = await cm.get_account_summary("a1")
    assert s["balance"] == "12"
    assert s["tier"] == "standard"
    assert s["lifetime_granted"] == 5.0
    assert s["lifetime_purchased"] == 7.0
    assert s["lifetime_used"] == 1.0


async def test_summary_no_account():
    cm = _cm([], [])
    s = await cm.get_account_summary("a1")
    assert s["tier"] == "free"
    assert s["lifetime_purchased"] == 0.0
    assert s["lifetime_used"] == 0.0
