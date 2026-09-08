from __future__ import annotations
from decimal import Decimal
from core.services.supabase import DBConnection
from core.utils.cache import Cache
from core.utils.config import config
from core.utils.logger import logger
from .fx import resolve_usd_cny_rate

_FX_CACHE_KEY = "payment:usd_cny_rate"


async def get_usd_cny_rate(db: DBConnection) -> Decimal:
    """当前 USD/CNY 汇率:缓存 → payment_settings(管理员设定)→ config 默认(7)。"""
    cached = await Cache.get(_FX_CACHE_KEY)
    if cached is not None:
        return resolve_usd_cny_rate(live=cached, static=config.USD_CNY_RATE_STATIC)

    admin_rate = None
    try:
        client = await db.client
        res = await client.from_('payment_settings').select(
            'usd_cny_rate'
        ).eq('id', True).limit(1).execute()
        if res.data:
            admin_rate = res.data[0].get('usd_cny_rate')
    except Exception as exc:  # noqa: BLE001 — 读失败回退默认,不阻断建单
        logger.warning(f"[payments.fx] payment_settings read failed, using default: {exc}")

    rate = resolve_usd_cny_rate(live=admin_rate, static=config.USD_CNY_RATE_STATIC)
    await Cache.set(_FX_CACHE_KEY, str(rate), ttl=300)
    return rate


async def set_usd_cny_rate(db: DBConnection, rate: Decimal, updated_by: str | None = None) -> Decimal:
    """管理员设定汇率:校验正数 → upsert 单行 → 失效缓存。"""
    rate = Decimal(str(rate))
    if rate <= 0:
        raise ValueError("usd_cny_rate must be positive")
    client = await db.client
    await client.from_('payment_settings').upsert({
        'id': True,
        'usd_cny_rate': str(rate),
        'updated_by': updated_by,
    }).execute()
    await Cache.invalidate(_FX_CACHE_KEY)
    logger.info(f"[payments.fx] usd_cny_rate set to {rate} by {updated_by}")
    return rate
