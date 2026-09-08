from __future__ import annotations
from typing import Any
from core.utils.logger import logger
from .contract import PaymentGatewayId
from .orders import OrderService, OrderStore
from .resolver import PaymentGatewayResolver


class ReconcileSweeper:
    def __init__(self, *, store: OrderStore, resolver: PaymentGatewayResolver,
                 order_service: OrderService) -> None:
        self.store = store
        self.resolver = resolver
        self._order_service = order_service

    async def run_once(self, *, older_than_seconds: int = 120, limit: int = 100) -> dict:
        try:
            pending = await self.store.list_pending(older_than_seconds=older_than_seconds, limit=limit)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"[payments.sweeper] list_pending failed: {exc}")
            return {"checked": 0, "settled": 0, "errors": 1}

        settled = errors = 0
        for order in pending:
            try:
                gateway = self.resolver.resolve(PaymentGatewayId(order["gateway"]))
                notif = await gateway.query_order_status(
                    order_id=order["id"], trade_no=order.get("trade_no"),
                    gateway_payment_id=order.get("gateway_payment_id"))
                if notif is None:
                    continue
                res = await self._order_service.settle(notif)
                if res.get("status") == "credited":
                    settled += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"[payments.sweeper] order {order.get('id')} failed: {exc}")
                errors += 1
                continue
        return {"checked": len(pending), "settled": settled, "errors": errors}
