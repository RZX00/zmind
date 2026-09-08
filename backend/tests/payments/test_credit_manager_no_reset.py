from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.credit_manager import CreditManager


class _FakeClient:
    def from_(self, *a, **k):
        raise AssertionError("reset_expiring_credits must be inert (no DB writes under prepaid / D1)")


class _DB:
    def __init__(self, c): self._c = c
    @property
    async def client(self): return self._c


def _cm():
    cm = CreditManager.__new__(CreditManager)
    cm.db = _DB(_FakeClient())
    return cm


async def test_reset_expiring_credits_is_inert_noop():
    res = await _cm().reset_expiring_credits(
        account_id="a1", new_credits=Decimal("20"), description="Monthly renewal")
    assert res["success"] is False
    assert res["skipped"] is True and res["reason"] == "prepaid_no_renewal"
    for key in ("new_expiring", "non_expiring", "total_balance"):
        assert key in res
