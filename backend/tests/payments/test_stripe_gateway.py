from __future__ import annotations
from decimal import Decimal
from types import SimpleNamespace
import pytest
from core.billing.payments.contract import PaymentSignatureError
from core.billing.payments.gateways.stripe import StripeGateway


class _SignatureVerificationError(Exception):  # 名称需与 stripe.error.SignatureVerificationError 一致
    pass


class _FakeStripe:
    def __init__(self):
        self.created = None
        self.error = SimpleNamespace(SignatureVerificationError=_SignatureVerificationError)
        self._event = None
        self.checkout = SimpleNamespace(Session=SimpleNamespace(
            create=self._create, retrieve=self._retrieve))
        self.Webhook = SimpleNamespace(construct_event=self._construct)

    def _create(self, **kwargs):
        self.created = kwargs
        return {"id": "cs_test_1", "url": "https://stripe.test/checkout/cs_test_1"}

    def _retrieve(self, sid):
        return {"id": sid, "payment_status": "paid", "amount_total": 500, "payment_intent": "pi_1"}

    def _construct(self, payload, sig, secret):
        if sig == "bad":
            raise _SignatureVerificationError("bad sig")
        return self._event


async def test_create_checkout_shape():
    fake = _FakeStripe()
    gw = StripeGateway(client=fake, webhook_secret="whsec")
    r = await gw.create_order_checkout(order_id="o1", account_id="a1", amount=Decimal("5"),
                                       currency="USD", public_base_url="https://api.test")
    assert r.checkout_url.endswith("cs_test_1") and r.gateway_payment_id == "cs_test_1"
    c = fake.created
    assert c["mode"] == "payment"
    assert c["client_reference_id"] == "o1"
    assert c["line_items"][0]["price_data"]["unit_amount"] == 500  # $5 → 500 cents
    assert c["idempotency_key"] == "checkout-o1"


@pytest.mark.parametrize("etype,paid,failed,cancelled", [
    ("checkout.session.completed", True, False, False),
    ("checkout.session.async_payment_succeeded", True, False, False),
    ("checkout.session.async_payment_failed", False, True, False),
    ("checkout.session.expired", False, False, True),
])
async def test_normalize_event(etype, paid, failed, cancelled):
    fake = _FakeStripe()
    fake._event = {"type": etype, "data": {"object": {
        "client_reference_id": "o9", "amount_total": 1500, "payment_intent": "pi_9"}}}
    gw = StripeGateway(client=fake, webhook_secret="whsec")
    n = await gw.verify_notification({"raw_body": b"{}", "signature": "good"})
    assert (n.paid, n.failed, n.cancelled) == (paid, failed, cancelled)
    assert n.order_id == "o9" and n.currency == "USD" and n.amount == Decimal("15")


async def test_unhandled_event_returns_none():
    fake = _FakeStripe()
    fake._event = {"type": "charge.refunded", "data": {"object": {}}}
    gw = StripeGateway(client=fake, webhook_secret="whsec")
    assert await gw.verify_notification({"raw_body": b"{}", "signature": "good"}) is None


async def test_signature_error_raises_typed():
    fake = _FakeStripe()
    gw = StripeGateway(client=fake, webhook_secret="whsec")
    with pytest.raises(PaymentSignatureError):
        await gw.verify_notification({"raw_body": b"{}", "signature": "bad"})


async def test_query_order_status_paid():
    fake = _FakeStripe()
    gw = StripeGateway(client=fake, webhook_secret="whsec")
    n = await gw.query_order_status(order_id="o1", gateway_payment_id="cs_test_1")
    assert n.paid and n.amount == Decimal("5") and n.trade_no == "pi_1"
