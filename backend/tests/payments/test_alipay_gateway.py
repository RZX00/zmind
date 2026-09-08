from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.payments.gateways.alipay import AlipayGateway


class _FakeAlipayClient:
    def __init__(self, *, verify_ok=True, query_status="TRADE_SUCCESS"):
        self.verify_ok = verify_ok
        self.query_status = query_status
        self.precreate_args = None
        self.page_pay_args = None

    def precreate(self, *, out_trade_no, total_amount, subject, notify_url):
        self.precreate_args = dict(out_trade_no=out_trade_no, total_amount=total_amount,
                                   subject=subject, notify_url=notify_url)
        return {"qr_code": f"https://qr.alipay/{out_trade_no}"}

    def page_pay(self, *, out_trade_no, total_amount, subject, notify_url, return_url):
        self.page_pay_args = dict(out_trade_no=out_trade_no, total_amount=total_amount,
                                  notify_url=notify_url, return_url=return_url)
        return f"https://openapi.alipay/pay?biz={out_trade_no}"

    def query(self, *, out_trade_no):
        return {"out_trade_no": out_trade_no, "trade_no": "2026T1",
                "trade_status": self.query_status, "total_amount": "30.00"}

    def verify(self, params):
        return self.verify_ok


async def test_qr_checkout():
    c = _FakeAlipayClient()
    gw = AlipayGateway(client=c)
    r = await gw.create_order_checkout(order_id="o1", account_id="a1", amount=Decimal("30"),
                                       currency="CNY", public_base_url="https://api.test", flow="qr")
    assert r.qr_payload == "https://qr.alipay/o1" and r.gateway_payment_id == "o1"
    assert c.precreate_args["total_amount"] == "30.00"
    assert c.precreate_args["notify_url"] == "https://api.test/billing/notify/alipay"


async def test_redirect_checkout():
    c = _FakeAlipayClient()
    gw = AlipayGateway(client=c)
    r = await gw.create_order_checkout(order_id="o2", account_id="a1", amount=Decimal("98"),
                                       currency="CNY", public_base_url="https://api.test")
    assert r.checkout_url.startswith("https://openapi.alipay/pay")
    assert c.page_pay_args["total_amount"] == "98.00"


async def test_notify_paid_maps_true():
    c = _FakeAlipayClient(verify_ok=True)
    gw = AlipayGateway(client=c)
    n = await gw.verify_notification({"out_trade_no": "o1", "trade_no": "2026T1",
        "trade_status": "TRADE_SUCCESS", "total_amount": "30.00", "sign": "x", "sign_type": "RSA2"})
    assert n.paid and n.currency == "CNY" and n.amount == Decimal("30.00") and n.trade_no == "2026T1"


async def test_notify_bad_signature_returns_none():
    c = _FakeAlipayClient(verify_ok=False)
    gw = AlipayGateway(client=c)
    assert await gw.verify_notification({"out_trade_no": "o1", "trade_status": "TRADE_SUCCESS",
                                         "total_amount": "30.00", "sign": "bad"}) is None


async def test_notify_closed_maps_cancelled():
    c = _FakeAlipayClient(verify_ok=True)
    gw = AlipayGateway(client=c)
    n = await gw.verify_notification({"out_trade_no": "o1", "trade_status": "TRADE_CLOSED",
                                      "total_amount": "30.00", "sign": "x"})
    assert n.cancelled and not n.paid


async def test_query_order_status():
    c = _FakeAlipayClient(query_status="TRADE_SUCCESS")
    gw = AlipayGateway(client=c)
    n = await gw.query_order_status(order_id="o1")
    assert n.paid and n.trade_no == "2026T1" and n.amount == Decimal("30.00")
