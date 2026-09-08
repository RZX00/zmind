from __future__ import annotations


def test_default_billing_provider_is_payments():
    from core.utils.config import config
    assert config.BILLING_PROVIDER_DEFAULT == "payments"
