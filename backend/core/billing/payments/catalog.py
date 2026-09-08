from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal
from .contract import Currency, PaymentGatewayId

CATALOG_VERSION = "2026-06-21"


class CatalogError(Exception):
    """充值金额不在目录/自定义区间内,或币种与网关不匹配。"""


@dataclass(frozen=True)
class TopupOffer:
    id: str
    gateway: PaymentGatewayId
    currency: Currency
    amount: Decimal


@dataclass(frozen=True)
class ResolvedOffer:
    offer_id: str
    gateway: PaymentGatewayId
    currency: Currency
    amount: Decimal
    catalog_version: str
    price_snapshot: Decimal


# 网关↔币种约束
_GATEWAY_CURRENCY = {PaymentGatewayId.ALIPAY: "CNY", PaymentGatewayId.STRIPE: "USD"}

ALIPAY_TOPUP_OFFERS = (
    TopupOffer("cny_30", PaymentGatewayId.ALIPAY, "CNY", Decimal("30")),
    TopupOffer("cny_98", PaymentGatewayId.ALIPAY, "CNY", Decimal("98")),
    TopupOffer("cny_298", PaymentGatewayId.ALIPAY, "CNY", Decimal("298")),
)
STRIPE_TOPUP_OFFERS = (
    TopupOffer("usd_5", PaymentGatewayId.STRIPE, "USD", Decimal("5")),
    TopupOffer("usd_15", PaymentGatewayId.STRIPE, "USD", Decimal("15")),
    TopupOffer("usd_50", PaymentGatewayId.STRIPE, "USD", Decimal("50")),
)
_ALL_OFFERS = {o.id: o for o in (*ALIPAY_TOPUP_OFFERS, *STRIPE_TOPUP_OFFERS)}

# 自定义额度边界(按币种)
CUSTOM_MIN = {"CNY": Decimal("10"), "USD": Decimal("2")}
CUSTOM_MAX = {"CNY": Decimal("5000"), "USD": Decimal("1000")}
_AMOUNT_TOLERANCE = Decimal("0.01")


def resolve_offer(*, gateway: PaymentGatewayId, currency: Currency, amount: Decimal,
                  offer_id: str | None = None) -> ResolvedOffer:
    gateway = PaymentGatewayId(gateway)
    if _GATEWAY_CURRENCY[gateway] != currency:
        raise CatalogError(f"Gateway {gateway} requires {_GATEWAY_CURRENCY[gateway]}, got {currency}")
    amount = Decimal(str(amount))

    if offer_id is not None:
        offer = _ALL_OFFERS.get(offer_id)
        if offer is None or offer.gateway != gateway or offer.currency != currency:
            raise CatalogError(f"Unknown offer '{offer_id}' for {gateway}/{currency}")
        if abs(offer.amount - amount) > _AMOUNT_TOLERANCE:
            raise CatalogError(f"Amount {amount} != catalog price {offer.amount} for '{offer_id}'")
        return ResolvedOffer(offer.id, gateway, currency, offer.amount, CATALOG_VERSION, offer.amount)

    if not (CUSTOM_MIN[currency] <= amount <= CUSTOM_MAX[currency]):
        raise CatalogError(f"Custom amount {amount} {currency} out of range "
                           f"[{CUSTOM_MIN[currency]}, {CUSTOM_MAX[currency]}]")
    return ResolvedOffer("custom", gateway, currency, amount, CATALOG_VERSION, amount)
