from __future__ import annotations
import dataclasses
from decimal import Decimal
import pytest
from core.billing.payments.contract import (
    PaymentGatewayId, CheckoutResult, PaymentNotification, PaymentGatewayNotConfigured,
)


def test_gateway_id_values():
    assert PaymentGatewayId.ALIPAY == "alipay"
    assert PaymentGatewayId.STRIPE == "stripe"
    assert PaymentGatewayId("alipay") is PaymentGatewayId.ALIPAY


def test_checkout_result_defaults_and_frozen():
    r = CheckoutResult(checkout_url="https://x")
    assert r.qr_payload is None and r.gateway_payment_id is None
    with pytest.raises(dataclasses.FrozenInstanceError):
        r.checkout_url = "y"  # type: ignore[misc]


def test_payment_notification_is_frozen_and_carries_payload():
    n = PaymentNotification(order_id="o1", amount=Decimal("9.9"), currency="CNY",
                            trade_no="t1", gateway_status="TRADE_SUCCESS",
                            paid=True, failed=False, cancelled=False, payload={"k": 1})
    assert n.paid and n.payload == {"k": 1}
    with pytest.raises(dataclasses.FrozenInstanceError):
        n.paid = False  # type: ignore[misc]


def test_not_configured_error_keeps_gateway_id():
    err = PaymentGatewayNotConfigured(PaymentGatewayId.STRIPE)
    assert err.gateway_id == PaymentGatewayId.STRIPE
    assert "stripe" in str(err)
