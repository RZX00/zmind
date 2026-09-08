from __future__ import annotations
import pytest
from core.billing.payments.contract import PaymentGatewayId, PaymentGatewayNotConfigured
from core.billing.payments.resolver import PaymentGatewayResolver


class _FakeGateway:
    def __init__(self, gid): self.gateway_id = gid


def test_resolve_returns_same_instance():
    g = _FakeGateway(PaymentGatewayId.ALIPAY)
    r = PaymentGatewayResolver([g])
    assert r.resolve(PaymentGatewayId.ALIPAY) is g
    assert r.resolve("alipay") is g  # 字符串也可


def test_unregistered_raises():
    r = PaymentGatewayResolver([_FakeGateway(PaymentGatewayId.ALIPAY)])
    with pytest.raises(PaymentGatewayNotConfigured):
        r.resolve(PaymentGatewayId.STRIPE)


def test_empty_resolver_raises_for_any():
    r = PaymentGatewayResolver([])
    assert r.available() == ()
    with pytest.raises(PaymentGatewayNotConfigured):
        r.resolve(PaymentGatewayId.ALIPAY)


def test_last_wins_on_duplicate_ids():
    g1, g2 = _FakeGateway(PaymentGatewayId.STRIPE), _FakeGateway(PaymentGatewayId.STRIPE)
    r = PaymentGatewayResolver([g1, g2])
    assert r.resolve(PaymentGatewayId.STRIPE) is g2


def test_available_and_has():
    r = PaymentGatewayResolver([_FakeGateway(PaymentGatewayId.ALIPAY)])
    assert r.available() == (PaymentGatewayId.ALIPAY,)
    assert r.has(PaymentGatewayId.ALIPAY) and not r.has(PaymentGatewayId.STRIPE)
