from __future__ import annotations
import asyncio
import dramatiq
from core.utils.logger import logger
from .bootstrap import get_order_service
from .sweeper import ReconcileSweeper


def _build_sweeper() -> ReconcileSweeper:
    svc = get_order_service()
    return ReconcileSweeper(store=svc.store, resolver=svc.resolver, order_service=svc)


async def run_reconcile_once_async() -> dict:
    return await _build_sweeper().run_once()


@dramatiq.actor(queue_name="billing", max_retries=0)
def reconcile_payment_orders() -> None:
    result = asyncio.run(run_reconcile_once_async())
    logger.info(f"[payments.sweeper] reconcile run: {result}")
