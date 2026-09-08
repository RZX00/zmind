from __future__ import annotations
from decimal import Decimal, ROUND_HALF_UP

DEFAULT_USD_CNY_RATE = Decimal("7")


def resolve_usd_cny_rate(*, live=None, cached=None, static=None) -> Decimal:
    for candidate in (live, cached, static, DEFAULT_USD_CNY_RATE):
        if candidate is None:
            continue
        rate = Decimal(str(candidate))
        if rate > 0:
            return rate
    return DEFAULT_USD_CNY_RATE


def cny_to_usd_credits(amount_cny, fx_rate) -> Decimal:
    usd = Decimal(str(amount_cny)) / Decimal(str(fx_rate))
    return usd.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
