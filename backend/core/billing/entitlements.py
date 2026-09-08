from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from core.utils.config import config
from .config import get_storage_limits

UNIFIED_TIER_NAME = "standard"
_MB = 1024 * 1024


@dataclass(frozen=True)
class Entitlements:
    """纯预付费(D1/D4)下的统一功能限额。不再随 tier/订阅变化。"""
    tier_name: str
    project_limit: int
    agent_limit: int
    file_size_limit_mb: int
    total_storage_limit_mb: int
    can_purchase_credits: bool
    is_paid: bool


def _build_unified() -> Entitlements:
    storage = get_storage_limits(UNIFIED_TIER_NAME)
    agent_limit = config.AGENT_LIMITS.get(UNIFIED_TIER_NAME, config.AGENT_LIMITS.get("free", 2))
    return Entitlements(
        tier_name=UNIFIED_TIER_NAME,
        project_limit=agent_limit,                 # 项目与 Agent 数同档(统一限额)
        agent_limit=agent_limit,
        file_size_limit_mb=storage.max_file_bytes // _MB,
        total_storage_limit_mb=storage.max_total_bytes // _MB,
        can_purchase_credits=True,
        is_paid=True,
    )


async def get_account_entitlements(account_id: str) -> Entitlements:
    # 纯预付费:全员统一限额,不读 tier/subscription/trial。
    # account_id 入参保留以便未来按"是否充过值"分档(本计划全员同额)。
    return _build_unified()


async def get_user_subscription_tier(account_id: str) -> dict:
    """兼容 shim:形状对齐旧 SubscriptionService.get_user_subscription_tier。

    旧形状: {name, display_name, credits, can_purchase_credits, models, project_limit, is_trial}
    """
    e = await get_account_entitlements(account_id)
    return {
        "name": e.tier_name,
        "display_name": "Standard",
        "credits": 0.0,                # 纯预付费无月度 credits 概念;旧调用点不依赖具体值
        "can_purchase_credits": e.can_purchase_credits,
        "models": None,                # 旧调用点不读 models(模型门控已移除,D4)
        "project_limit": e.project_limit,
        "is_trial": False,
    }
