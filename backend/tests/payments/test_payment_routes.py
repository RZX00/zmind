from __future__ import annotations
from decimal import Decimal
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from core.billing import api as billing_api
from core.billing.payments.contract import CheckoutResult, PaymentNotification, PaymentGatewayId


async def _owner_account() -> str:
    return "acct-1"


async def _member_account() -> str:
    return "acct-1"


def _client():
    app = FastAPI()
    app.include_router(billing_api.router)
    app.dependency_overrides[billing_api._get_workspace_owner_account_id] = _owner_account
    app.dependency_overrides[billing_api._get_workspace_account_id] = _member_account
    return TestClient(app)


def test_checkout_creates_order(monkeypatch):
    class _Svc:
        async def create_order(self, **kw):
            assert kw["account_id"] == "acct-1"
            assert kw["gateway_id"] == PaymentGatewayId.STRIPE
            return "ord-1", CheckoutResult(checkout_url="https://pay/x", gateway_payment_id="cs_1")
    monkeypatch.setattr(billing_api, "get_order_service", lambda: _Svc())
    r = _client().post("/billing/orders/checkout", json={
        "currency": "USD", "amount": "5", "offer_id": "usd_5", "gateway": "stripe",
        "public_base_url": "https://api.test"})
    assert r.status_code == 200
    body = r.json()
    assert body["order_id"] == "ord-1" and body["checkout_url"] == "https://pay/x"


def test_get_order_status(monkeypatch):
    class _Store:
        async def get(self, oid): return {"id": oid, "account_id": "acct-1", "status": "paid", "credit_amount_usd": "5"}
    class _Svc:
        store = _Store()
    monkeypatch.setattr(billing_api, "get_order_service", lambda: _Svc())
    r = _client().get("/billing/orders/ord-1")
    assert r.status_code == 200 and r.json()["status"] == "paid"


def test_stripe_webhook_settles(monkeypatch):
    settled = {}
    class _Gateway:
        async def verify_notification(self, params):
            return PaymentNotification(order_id="ord-1", amount=Decimal("5"), currency="USD",
                trade_no="pi_1", gateway_status="checkout.session.completed",
                paid=True, failed=False, cancelled=False, payload={})
    class _Resolver:
        def resolve(self, gid): return _Gateway()
    class _Svc:
        resolver = _Resolver()
        async def settle(self, notif): settled["id"] = notif.order_id; return {"status": "credited"}
    monkeypatch.setattr(billing_api, "get_order_service", lambda: _Svc())
    r = _client().post("/billing/webhook/stripe", content=b"{}",
                       headers={"stripe-signature": "good"})
    assert r.status_code == 200 and settled["id"] == "ord-1"


def test_stripe_webhook_bad_signature_returns_400(monkeypatch):
    from core.billing.payments.contract import PaymentSignatureError
    class _Gateway:
        async def verify_notification(self, params): raise PaymentSignatureError("bad")
    class _Resolver:
        def resolve(self, gid): return _Gateway()
    class _Svc:
        resolver = _Resolver()
        async def settle(self, notif): ...
    monkeypatch.setattr(billing_api, "get_order_service", lambda: _Svc())
    r = _client().post("/billing/webhook/stripe", content=b"{}",
                       headers={"stripe-signature": "bad"})
    assert r.status_code == 400


def test_alipay_notify_returns_plaintext(monkeypatch):
    class _Gateway:
        async def verify_notification(self, params):
            return PaymentNotification(order_id="ord-2", amount=Decimal("30"), currency="CNY",
                trade_no="t", gateway_status="TRADE_SUCCESS",
                paid=True, failed=False, cancelled=False, payload={})
    class _Resolver:
        def resolve(self, gid): return _Gateway()
    class _Svc:
        resolver = _Resolver()
        async def settle(self, notif): return {"status": "credited"}
    monkeypatch.setattr(billing_api, "get_order_service", lambda: _Svc())
    r = _client().post("/billing/notify/alipay",
                       data={"out_trade_no": "ord-2", "trade_status": "TRADE_SUCCESS", "sign": "x"})
    assert r.status_code == 200 and r.text == "success"
