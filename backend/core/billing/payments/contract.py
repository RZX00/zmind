from __future__ import annotations
from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum
from typing import Any, Literal, Protocol, runtime_checkable


class PaymentGatewayId(StrEnum):
    ALIPAY = "alipay"
    STRIPE = "stripe"


Currency = Literal["CNY", "USD"]


@dataclass(frozen=True)
class CheckoutResult:
    checkout_url: str
    qr_payload: str | None = None
    qr_code_data_url: str | None = None
    gateway_payment_id: str | None = None


@dataclass(frozen=True)
class PaymentNotification:
    order_id: str
    amount: Decimal
    currency: Currency
    trade_no: str | None
    gateway_status: str
    paid: bool
    failed: bool
    cancelled: bool
    payload: dict[str, Any] = field(default_factory=dict)


class PaymentGatewayError(Exception):
    """Base class for payment-gateway errors."""


class PaymentGatewayNotConfigured(PaymentGatewayError):
    def __init__(self, gateway_id: PaymentGatewayId | str) -> None:
        super().__init__(f"Payment gateway '{gateway_id}' is not configured.")
        self.gateway_id = gateway_id


class PaymentSignatureError(PaymentGatewayError):
    """Raised ONLY when a webhook/notify signature fails verification (→ 4xx, permanent)."""


@runtime_checkable
class PaymentGateway(Protocol):
    gateway_id: PaymentGatewayId

    async def create_order_checkout(
        self, *, order_id: str, account_id: str, amount: Decimal, currency: Currency,
        public_base_url: str, notify_base_url: str | None = None,
        flow: str = "redirect", return_url: str | None = None,
    ) -> CheckoutResult: ...

    async def query_order_status(
        self, *, order_id: str, trade_no: str | None = None,
        gateway_payment_id: str | None = None,
    ) -> PaymentNotification | None: ...

    async def verify_notification(self, params: dict[str, Any]) -> PaymentNotification | None: ...
