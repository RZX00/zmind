from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.payments.contract import (
    CheckoutResult, PaymentGatewayId, PaymentNotification)
from core.billing.payments.resolver import PaymentGatewayResolver
from core.billing.payments.orders import OrderService, InMemoryOrderStore


class _FakeGateway:
    def __init__(self, gid): self.gateway_id = gid; self.checkout_calls = []
    async def create_order_checkout(self, **kw):
        self.checkout_calls.append(kw)
        return CheckoutResult(checkout_url="https://pay/x", gateway_payment_id="gp_1")
    async def query_order_status(self, **kw): return None
    async def verify_notification(self, params): return None


class _FakeCreditManager:
    def __init__(self): self.calls = []
    async def add_credits(self, **kw):
        self.calls.append(kw)
        return {"success": True, "transaction_id": "tx_1", "total_balance": 10.0}


async def _fx_seven_two() -> Decimal:
    return Decimal("7.2")


def _svc(gateway):
    return OrderService(
        store=InMemoryOrderStore(),
        resolver=PaymentGatewayResolver([gateway]),
        credit_manager=_FakeCreditManager(),
        fx_rate_provider=_fx_seven_two,   # async 无参 → 返回 Decimal
    )


async def test_create_order_usd_persists_pending_and_calls_gateway():
    gw = _FakeGateway(PaymentGatewayId.STRIPE)
    svc = _svc(gw)
    order_id, checkout = await svc.create_order(
        account_id="a1", gateway_id=PaymentGatewayId.STRIPE, currency="USD",
        amount=Decimal("5"), offer_id="usd_5", public_base_url="https://api.test")
    order = await svc.store.get(order_id)
    assert order["status"] == "pending" and order["credit_amount_usd"] == Decimal("5")
    assert order["fx_rate_usd_cny"] is None and order["gateway_payment_id"] == "gp_1"
    assert checkout.gateway_payment_id == "gp_1"
    assert gw.checkout_calls[0]["amount"] == Decimal("5")


async def test_create_order_cny_converts_via_fx():
    gw = _FakeGateway(PaymentGatewayId.ALIPAY)
    svc = _svc(gw)
    order_id, _ = await svc.create_order(
        account_id="a1", gateway_id=PaymentGatewayId.ALIPAY, currency="CNY",
        amount=Decimal("72"), offer_id=None, public_base_url="https://api.test")
    order = await svc.store.get(order_id)
    assert order["fx_rate_usd_cny"] == Decimal("7.2")
    assert order["credit_amount_usd"] == Decimal("10.0000")  # 72/7.2


async def test_settle_paid_credits_once():
    gw = _FakeGateway(PaymentGatewayId.STRIPE)
    svc = _svc(gw)
    order_id, _ = await svc.create_order(
        account_id="a1", gateway_id=PaymentGatewayId.STRIPE, currency="USD",
        amount=Decimal("5"), offer_id="usd_5", public_base_url="https://api.test")
    notif = PaymentNotification(order_id=order_id, amount=Decimal("5"), currency="USD",
        trade_no="pi_1", gateway_status="checkout.session.completed",
        paid=True, failed=False, cancelled=False, payload={})
    res1 = await svc.settle(notif)
    res2 = await svc.settle(notif)  # 重复通知
    assert res1["status"] == "credited"
    assert res2["status"] == "already_credited"
    assert len(svc.credit_manager.calls) == 1
    assert svc.credit_manager.calls[0]["billing_dedup_key"] == f"order:{order_id}"
    assert svc.credit_manager.calls[0]["is_expiring"] is False
    order = await svc.store.get(order_id)
    assert order["status"] == "paid" and order["credited_at"] is not None


async def test_settle_unknown_order():
    svc = _svc(_FakeGateway(PaymentGatewayId.STRIPE))
    notif = PaymentNotification(order_id="missing", amount=Decimal("5"), currency="USD",
        trade_no=None, gateway_status="x", paid=True, failed=False, cancelled=False, payload={})
    assert (await svc.settle(notif))["status"] == "unknown_order"


async def test_settle_cancelled_marks_status():
    gw = _FakeGateway(PaymentGatewayId.ALIPAY)
    svc = _svc(gw)
    order_id, _ = await svc.create_order(
        account_id="a1", gateway_id=PaymentGatewayId.ALIPAY, currency="CNY",
        amount=Decimal("30"), offer_id="cny_30", public_base_url="https://api.test")
    notif = PaymentNotification(order_id=order_id, amount=Decimal("30"), currency="CNY",
        trade_no=None, gateway_status="TRADE_CLOSED", paid=False, failed=False, cancelled=True, payload={})
    assert (await svc.settle(notif))["status"] == "cancelled"
    assert len(svc.credit_manager.calls) == 0
