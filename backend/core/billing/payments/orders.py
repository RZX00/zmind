from __future__ import annotations
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Awaitable, Callable, Protocol
from uuid import uuid4
from core.utils.logger import logger
from .catalog import resolve_offer
from .contract import CheckoutResult, Currency, PaymentGatewayId, PaymentNotification
from .fx import cny_to_usd_credits
from .resolver import PaymentGatewayResolver


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class OrderStore(Protocol):
    async def insert(self, order: dict) -> dict: ...
    async def get(self, order_id: str) -> dict | None: ...
    async def update(self, order_id: str, patch: dict) -> dict: ...
    async def list_pending(self, *, older_than_seconds: int = 0, limit: int = 100) -> list[dict]: ...


class OrderService:
    def __init__(self, *, store: OrderStore, resolver: PaymentGatewayResolver,
                 credit_manager: Any, fx_rate_provider: Callable[[], Awaitable[Decimal]]) -> None:
        self.store = store                 # 公开:路由/ sweeper 需访问
        self.resolver = resolver           # 公开:webhook 路由需访问
        self.credit_manager = credit_manager
        self._fx_rate_provider = fx_rate_provider

    async def create_order(
        self, *, account_id: str, gateway_id: PaymentGatewayId, currency: Currency,
        amount: Decimal, public_base_url: str, offer_id: str | None = None,
        flow: str = "redirect", return_url: str | None = None, notify_base_url: str | None = None,
    ) -> tuple[str, CheckoutResult]:
        offer = resolve_offer(gateway=gateway_id, currency=currency, amount=amount, offer_id=offer_id)
        if currency == "USD":
            credit_usd = offer.amount
            fx_rate: Decimal | None = None
        else:
            fx_rate = Decimal(str(await self._fx_rate_provider()))
            credit_usd = cny_to_usd_credits(offer.amount, fx_rate)

        order_id = str(uuid4())
        await self.store.insert({
            "id": order_id, "account_id": account_id, "gateway": str(gateway_id),
            "status": "pending", "pay_currency": currency, "pay_amount": offer.amount,
            "credit_amount_usd": credit_usd, "fx_rate_usd_cny": fx_rate,
            "catalog_id": offer.offer_id, "catalog_version": offer.catalog_version,
            "price_snapshot": offer.price_snapshot, "gateway_payment_id": None,
            "trade_no": None, "gateway_status": None, "notify_payload": None,
            "credited_at": None, "fulfilled_at": None, "created_at": _now(), "updated_at": _now(),
        })
        gateway = self.resolver.resolve(gateway_id)
        checkout = await gateway.create_order_checkout(
            order_id=order_id, account_id=account_id, amount=offer.amount, currency=currency,
            public_base_url=public_base_url, notify_base_url=notify_base_url, flow=flow,
            return_url=return_url)
        await self.store.update(order_id, {"gateway_payment_id": checkout.gateway_payment_id})
        return order_id, checkout

    async def settle(self, notification: PaymentNotification) -> dict:
        order = await self.store.get(notification.order_id)
        if order is None:
            return {"status": "unknown_order"}
        if order.get("credited_at"):
            return {"status": "already_credited"}

        if notification.paid:
            res = await self.credit_manager.add_credits(
                account_id=order["account_id"],
                amount=Decimal(str(order["credit_amount_usd"])),
                is_expiring=False, type="purchase",
                description=f"Top-up {order['id']}",
                billing_dedup_key=f"order:{order['id']}",
            )
            if not res.get("success"):
                logger.error(f"[payments] credit add failed for order {order['id']}: {res.get('error')}")
                return {"status": "credit_failed", "error": res.get("error")}
            await self.store.update(order["id"], {
                "status": "paid", "trade_no": notification.trade_no,
                "gateway_status": notification.gateway_status, "notify_payload": notification.payload,
                "credited_at": _now(), "fulfilled_at": _now(), "updated_at": _now()})
            return {"status": "credited", "transaction_id": res.get("transaction_id")}

        if notification.cancelled:
            await self.store.update(order["id"], {"status": "cancelled",
                "gateway_status": notification.gateway_status, "updated_at": _now()})
            return {"status": "cancelled"}
        if notification.failed:
            await self.store.update(order["id"], {"status": "failed",
                "gateway_status": notification.gateway_status, "updated_at": _now()})
            return {"status": "failed"}
        return {"status": "pending"}


class InMemoryOrderStore:
    """测试/参考实现。"""
    def __init__(self) -> None:
        self._rows: dict[str, dict] = {}

    async def insert(self, order: dict) -> dict:
        self._rows[order["id"]] = dict(order)
        return self._rows[order["id"]]

    async def get(self, order_id: str) -> dict | None:
        row = self._rows.get(order_id)
        return dict(row) if row else None

    async def update(self, order_id: str, patch: dict) -> dict:
        self._rows[order_id].update(patch)
        return dict(self._rows[order_id])

    async def list_pending(self, *, older_than_seconds: int = 0, limit: int = 100) -> list[dict]:
        return [dict(r) for r in self._rows.values() if r["status"] == "pending"][:limit]


class SupabaseOrderStore:
    """真实实现:Supabase payment_orders。Decimal 入库转 str 防浮点漂移。"""
    def __init__(self, db) -> None:
        self._db = db

    @staticmethod
    def _ser(order: dict) -> dict:
        out = dict(order)
        for k in ("pay_amount", "credit_amount_usd", "fx_rate_usd_cny", "price_snapshot"):
            if out.get(k) is not None:
                out[k] = str(out[k])
        return out

    async def insert(self, order: dict) -> dict:
        client = await self._db.client
        res = await client.from_("payment_orders").insert(self._ser(order)).execute()
        return res.data[0] if res.data else order

    async def get(self, order_id: str) -> dict | None:
        client = await self._db.client
        res = await client.from_("payment_orders").select("*").eq("id", order_id).limit(1).execute()
        return res.data[0] if res.data else None

    async def update(self, order_id: str, patch: dict) -> dict:
        client = await self._db.client
        res = await client.from_("payment_orders").update(self._ser(patch)).eq("id", order_id).execute()
        return res.data[0] if res.data else {}

    async def list_pending(self, *, older_than_seconds: int = 0, limit: int = 100) -> list[dict]:
        from datetime import timedelta
        client = await self._db.client
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=older_than_seconds)).isoformat()
        res = (await client.from_("payment_orders").select("*").eq("status", "pending")
               .lte("created_at", cutoff).order("created_at").limit(limit).execute())
        return res.data or []
