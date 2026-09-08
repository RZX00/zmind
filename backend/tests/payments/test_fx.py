from __future__ import annotations
from decimal import Decimal
from core.billing.payments import fx


def test_prefers_live_then_cached_then_static():
    assert fx.resolve_usd_cny_rate(live=7.1, cached=7.3, static=7.5) == Decimal("7.1")
    assert fx.resolve_usd_cny_rate(live=None, cached=7.3, static=7.5) == Decimal("7.3")
    assert fx.resolve_usd_cny_rate(live=None, cached=None, static=7.5) == Decimal("7.5")


def test_skips_nonpositive_and_falls_back_to_default():
    assert fx.resolve_usd_cny_rate(live=0, cached=-1, static=None) == fx.DEFAULT_USD_CNY_RATE


def test_cny_to_usd_credits_quantizes_to_4dp():
    # 72 CNY / 7.2 = 10.0000
    assert fx.cny_to_usd_credits(72, Decimal("7.2")) == Decimal("10.0000")
    # 30 / 7.2 = 4.1667 (round half up)
    assert fx.cny_to_usd_credits(30, Decimal("7.2")) == Decimal("4.1667")
