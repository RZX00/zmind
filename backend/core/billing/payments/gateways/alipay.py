from __future__ import annotations
from decimal import Decimal
from typing import Any, Protocol
from ..contract import CheckoutResult, Currency, PaymentGatewayId, PaymentNotification

_PAID_STATUSES = {"TRADE_SUCCESS", "TRADE_FINISHED"}
_CLOSED_STATUSES = {"TRADE_CLOSED"}


class AlipayClient(Protocol):
    def precreate(self, *, out_trade_no: str, total_amount: str, subject: str, notify_url: str) -> dict: ...
    def page_pay(self, *, out_trade_no: str, total_amount: str, subject: str, notify_url: str, return_url: str) -> str: ...
    def query(self, *, out_trade_no: str) -> dict: ...
    def verify(self, params: dict) -> bool: ...


class AlipayGateway:
    gateway_id = PaymentGatewayId.ALIPAY

    def __init__(self, *, client: AlipayClient) -> None:
        self._client = client

    async def create_order_checkout(
        self, *, order_id: str, account_id: str, amount: Decimal, currency: Currency,
        public_base_url: str, notify_base_url: str | None = None,
        flow: str = "redirect", return_url: str | None = None,
    ) -> CheckoutResult:
        notify_url = f"{(notify_base_url or public_base_url).rstrip('/')}/billing/notify/alipay"
        subject = f"Credits top-up {order_id}"
        total = f"{Decimal(str(amount)).quantize(Decimal('0.01'))}"
        if flow == "qr":
            resp = self._client.precreate(out_trade_no=order_id, total_amount=total,
                                          subject=subject, notify_url=notify_url)
            qr = resp.get("qr_code", "")
            return CheckoutResult(checkout_url=qr, qr_payload=qr, gateway_payment_id=order_id)
        url = self._client.page_pay(
            out_trade_no=order_id, total_amount=total, subject=subject, notify_url=notify_url,
            return_url=return_url or f"{public_base_url.rstrip('/')}/billing/success?order_id={order_id}",
        )
        return CheckoutResult(checkout_url=url, gateway_payment_id=order_id)

    async def verify_notification(self, params: dict[str, Any]) -> PaymentNotification | None:
        if not self._client.verify(dict(params)):
            return None
        return self._to_notification(
            order_id=params.get("out_trade_no"), trade_no=params.get("trade_no"),
            status=params.get("trade_status", ""), amount=params.get("total_amount"), payload=params,
        )

    async def query_order_status(
        self, *, order_id: str, trade_no: str | None = None, gateway_payment_id: str | None = None,
    ) -> PaymentNotification | None:
        resp = self._client.query(out_trade_no=order_id)
        status = resp.get("trade_status", "")
        if not status:
            return None
        return self._to_notification(order_id=order_id, trade_no=resp.get("trade_no"),
                                     status=status, amount=resp.get("total_amount"), payload=resp)

    @staticmethod
    def _to_notification(*, order_id, trade_no, status, amount, payload) -> PaymentNotification:
        return PaymentNotification(
            order_id=order_id, amount=Decimal(str(amount or 0)), currency="CNY",
            trade_no=trade_no, gateway_status=status,
            paid=status in _PAID_STATUSES, failed=False, cancelled=status in _CLOSED_STATUSES,
            payload=dict(payload),
        )
