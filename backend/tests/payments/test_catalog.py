from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.payments.contract import PaymentGatewayId
from core.billing.payments import catalog


def test_resolve_known_offer_by_id():
    r = catalog.resolve_offer(gateway=PaymentGatewayId.STRIPE, currency="USD",
                              amount=Decimal("5"), offer_id="usd_5")
    assert r.amount == Decimal("5") and r.offer_id == "usd_5"
    assert r.catalog_version == catalog.CATALOG_VERSION
    assert r.price_snapshot == Decimal("5")


def test_offer_amount_mismatch_rejected():
    with pytest.raises(catalog.CatalogError):
        catalog.resolve_offer(gateway=PaymentGatewayId.STRIPE, currency="USD",
                              amount=Decimal("4.50"), offer_id="usd_5")


def test_custom_amount_in_range_ok():
    r = catalog.resolve_offer(gateway=PaymentGatewayId.ALIPAY, currency="CNY",
                              amount=Decimal("66"), offer_id=None)
    assert r.offer_id == "custom" and r.amount == Decimal("66")


def test_custom_amount_out_of_range_rejected():
    with pytest.raises(catalog.CatalogError):
        catalog.resolve_offer(gateway=PaymentGatewayId.ALIPAY, currency="CNY",
                              amount=Decimal("1"), offer_id=None)  # below min


def test_currency_must_match_gateway():
    with pytest.raises(catalog.CatalogError):
        catalog.resolve_offer(gateway=PaymentGatewayId.STRIPE, currency="CNY",
                              amount=Decimal("5"), offer_id=None)
