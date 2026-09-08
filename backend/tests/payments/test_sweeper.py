from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.payments.contract import PaymentGatewayId, PaymentNotification
from core.billing.payments.resolver import PaymentGatewayResolver
from core.billing.payments.sweeper import ReconcileSweeper


class _Gateway:
    def __init__(self, gid, status_map): self.gateway_id = gid; self._status_map = status_map
    async def query_order_status(self, *, order_id, trade_no=None, gateway_payment_id=None):
        paid = self._status_map.get(order_id)
        if paid is None: return None
        return PaymentNotification(order_id=order_id, amount=Decimal("5"), currency="USD",
            trade_no="t", gateway_status="paid" if paid else "pending",
            paid=paid, failed=False, cancelled=False, payload={})
    async def create_order_checkout(self, **kw): ...
    async def verify_notification(self, params): ...


class _Store:
    def __init__(self, pending, raise_on_list=False):
        self._pending = pending; self._raise = raise_on_list
    async def list_pending(self, *, older_than_seconds=0, limit=100):
        if self._raise: raise RuntimeError("db down")
        return list(self._pending)


class _OrderService:
    def __init__(self): self.settled = []
    async def settle(self, notif):
        # 真实 settle 仅对 paid 通知入账(crediting);非 paid 返回 pending。
        if not notif.paid:
            return {"status": "pending"}
        self.settled.append(notif.order_id)
        return {"status": "credited"}


def _sweeper(pending, status_map, raise_on_list=False):
    gw = _Gateway(PaymentGatewayId.STRIPE, status_map)
    sw = ReconcileSweeper(store=_Store(pending, raise_on_list),
                          resolver=PaymentGatewayResolver([gw]),
                          order_service=_OrderService())
    return sw, gw


async def test_settles_only_paid_orders():
    pending = [{"id": "o1", "gateway": "stripe", "gateway_payment_id": "g1"},
               {"id": "o2", "gateway": "stripe", "gateway_payment_id": "g2"}]
    sw, _ = _sweeper(pending, {"o1": True, "o2": False})
    res = await sw.run_once()
    assert res["checked"] == 2 and res["settled"] == 1 and res["errors"] == 0
    assert sw._order_service.settled == ["o1"]


async def test_query_none_skips():
    pending = [{"id": "o3", "gateway": "stripe", "gateway_payment_id": "g3"}]
    sw, _ = _sweeper(pending, {})  # query 返回 None
    res = await sw.run_once()
    assert res["settled"] == 0 and res["errors"] == 0


async def test_list_failure_does_not_raise():
    sw, _ = _sweeper([], {}, raise_on_list=True)
    res = await sw.run_once()
    assert res == {"checked": 0, "settled": 0, "errors": 1}
