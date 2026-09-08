from __future__ import annotations
from decimal import Decimal
from core.utils.config import config
from core.utils.logger import logger
from core.services.supabase import DBConnection
from core.billing.credit_manager import credit_manager
from .gateways.stripe import StripeGateway
from .orders import OrderService, SupabaseOrderStore
from .resolver import PaymentGatewayResolver
from .settings import get_usd_cny_rate

_order_service: OrderService | None = None


def build_resolver() -> PaymentGatewayResolver:
    gateways = []
    if config.STRIPE_SECRET_KEY and config.STRIPE_WEBHOOK_SECRET:
        import stripe
        stripe.api_key = config.STRIPE_SECRET_KEY
        gateways.append(StripeGateway(client=stripe, webhook_secret=config.STRIPE_WEBHOOK_SECRET))
    if config.ALIPAY_APP_ID and config.ALIPAY_PRIVATE_KEY:
        try:
            from .gateways.alipay import AlipayGateway
            from .gateways.alipay_client import RealAlipayClient
            gateways.append(AlipayGateway(client=RealAlipayClient()))
        except Exception as exc:  # noqa: BLE001 — 依赖未装/配置缺失时优雅缺席
            logger.error(f"[payments] Alipay gateway unavailable: {exc}")
    return PaymentGatewayResolver(gateways)


async def _fx_rate_provider() -> Decimal:
    # 管理员可改的 USD/CNY 汇率(payment_settings,带缓存);无设定值时回退
    # config.USD_CNY_RATE_STATIC(默认 7)。详见 settings.get_usd_cny_rate。
    return await get_usd_cny_rate(DBConnection())


def get_order_service() -> OrderService:
    global _order_service
    if _order_service is None:
        _order_service = OrderService(
            store=SupabaseOrderStore(DBConnection()),
            resolver=build_resolver(),
            credit_manager=credit_manager,
            fx_rate_provider=_fx_rate_provider,
        )
    return _order_service


def reset_payments_singletons() -> None:
    global _order_service
    _order_service = None
