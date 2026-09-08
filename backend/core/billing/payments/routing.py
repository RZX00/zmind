from __future__ import annotations
from .contract import PaymentGatewayId

CN_REGIONS = {"CN", "CHN", "CHINA"}


def route_gateway(
    *, account_region: str | None = None, currency_hint: str | None = None,
    accept_language: str | None = None, explicit: PaymentGatewayId | str | None = None,
) -> PaymentGatewayId:
    if explicit is not None:
        return PaymentGatewayId(explicit)
    if currency_hint and currency_hint.strip().upper() == "CNY":
        return PaymentGatewayId.ALIPAY
    if account_region and account_region.strip().upper() in CN_REGIONS:
        return PaymentGatewayId.ALIPAY
    if accept_language and accept_language.strip().lower().startswith("zh"):
        return PaymentGatewayId.ALIPAY
    return PaymentGatewayId.STRIPE
