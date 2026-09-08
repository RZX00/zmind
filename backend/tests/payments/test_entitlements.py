from __future__ import annotations
import pytest
from core.billing import entitlements as ent
from core.billing.config import get_storage_limits


async def test_get_account_entitlements_unified():
    e = await ent.get_account_entitlements("acct-1")
    assert e.tier_name == "standard"
    assert e.is_paid is True and e.can_purchase_credits is True
    assert e.agent_limit >= 1 and e.project_limit >= 1
    e2 = await ent.get_account_entitlements("acct-2")
    assert e == e2


async def test_shim_shape_compatible():
    info = await ent.get_user_subscription_tier("acct-1")
    for key in ("name", "display_name", "credits", "can_purchase_credits",
                "project_limit", "is_trial"):
        assert key in info, f"missing {key}"
    assert info["name"] == "standard"
    assert info["is_trial"] is False


def test_storage_limits_has_standard():
    limits = get_storage_limits("standard")
    none_limits = get_storage_limits("none")
    assert limits.max_total_bytes >= none_limits.max_total_bytes


def test_agent_limits_has_standard():
    from core.utils.config import config
    assert "standard" in config.AGENT_LIMITS
