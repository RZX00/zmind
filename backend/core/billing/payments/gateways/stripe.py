from __future__ import annotations
from decimal import Decimal
from typing import Any
from ..contract import (
    CheckoutResult, Currency, PaymentGatewayId, PaymentNotification, PaymentSignatureError,
)

_PAID = {"checkout.session.completed", "checkout.session.async_payment_succeeded"}
_FAILED = {"checkout.session.async_payment_failed"}
_CANCELLED = {"checkout.session.expired"}


class StripeGateway:
    gateway_id = PaymentGatewayId.STRIPE

    def __init__(self, *, client: Any, webhook_secret: str, currency: str = "usd") -> None:
        self._stripe = client
        self._webhook_secret = webhook_secret
        self._currency = currency

    async def create_order_checkout(
        self, *, order_id: str, account_id: str, amount: Decimal, currency: Currency,
        public_base_url: str, notify_base_url: str | None = None,
        flow: str = "redirect", return_url: str | None = None,
    ) -> CheckoutResult:
        unit_amount = int((Decimal(str(amount)) * 100).to_integral_value())
        session = self._stripe.checkout.Session.create(
            mode="payment",
            client_reference_id=order_id,
            success_url=return_url or f"{public_base_url}/billing/success?order_id={order_id}",
            cancel_url=f"{public_base_url}/billing/cancel?order_id={order_id}",
            line_items=[{
                "quantity": 1,
                "price_data": {
                    "currency": self._currency,
                    "unit_amount": unit_amount,
                    "product_data": {"name": f"Credits top-up {order_id}"},
                },
            }],
            metadata={"order_id": order_id, "account_id": account_id},
            idempotency_key=f"checkout-{order_id}",
        )
        return CheckoutResult(checkout_url=session["url"], gateway_payment_id=session["id"])

    async def verify_notification(self, params: dict[str, Any]) -> PaymentNotification | None:
        raw = params.get("raw_body")
        sig = params.get("signature")
        try:
            event = self._stripe.Webhook.construct_event(raw, sig, self._webhook_secret)
        except Exception as exc:  # noqa: BLE001
            if self._is_signature_error(exc):
                raise PaymentSignatureError(str(exc)) from exc
            raise
        return self._normalize_event(event)

    async def query_order_status(
        self, *, order_id: str, trade_no: str | None = None, gateway_payment_id: str | None = None,
    ) -> PaymentNotification | None:
        if not gateway_payment_id:
            return None
        session = self._stripe.checkout.Session.retrieve(gateway_payment_id)
        status = session.get("payment_status")
        return PaymentNotification(
            order_id=order_id, amount=Decimal(session.get("amount_total") or 0) / 100,
            currency="USD", trade_no=session.get("payment_intent"),
            gateway_status=str(status), paid=status == "paid", failed=False, cancelled=False,
            payload=dict(session),
        )

    def _normalize_event(self, event: Any) -> PaymentNotification | None:
        etype = event["type"]
        if etype not in _PAID | _FAILED | _CANCELLED:
            return None
        obj = event["data"]["object"]
        order_id = obj.get("client_reference_id") or (obj.get("metadata") or {}).get("order_id")
        return PaymentNotification(
            order_id=order_id, amount=Decimal(obj.get("amount_total") or 0) / 100,
            currency="USD", trade_no=obj.get("payment_intent") or obj.get("id"),
            gateway_status=etype, paid=etype in _PAID, failed=etype in _FAILED,
            cancelled=etype in _CANCELLED, payload=dict(event),
        )

    def _is_signature_error(self, exc: Exception) -> bool:
        sig_err = getattr(getattr(self._stripe, "error", None), "SignatureVerificationError", None)
        if sig_err is not None and isinstance(exc, sig_err):
            return True
        return type(exc).__name__ == "SignatureVerificationError"
