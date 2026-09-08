from __future__ import annotations
import pytest
from core.billing.payments import bootstrap
from core.billing.payments.contract import PaymentGatewayId


def test_resolver_gates_on_config(monkeypatch):
    monkeypatch.setattr(bootstrap.config, "STRIPE_SECRET_KEY", "sk", raising=False)
    monkeypatch.setattr(bootstrap.config, "STRIPE_WEBHOOK_SECRET", "wh", raising=False)
    monkeypatch.setattr(bootstrap.config, "ALIPAY_APP_ID", None, raising=False)
    monkeypatch.setattr(bootstrap.config, "ALIPAY_PRIVATE_KEY", None, raising=False)
    bootstrap.reset_payments_singletons()
    r = bootstrap.build_resolver()
    assert r.has(PaymentGatewayId.STRIPE) and not r.has(PaymentGatewayId.ALIPAY)


def test_no_gateways_when_unconfigured(monkeypatch):
    for k in ("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "ALIPAY_APP_ID", "ALIPAY_PRIVATE_KEY"):
        monkeypatch.setattr(bootstrap.config, k, None, raising=False)
    bootstrap.reset_payments_singletons()
    assert bootstrap.build_resolver().available() == ()
