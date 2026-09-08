from __future__ import annotations
from decimal import Decimal
import pytest
import sys
import core.billing.billing_integration  # noqa: F401  ensure module is imported
from core.billing.billing_integration import BillingIntegration

# `from core.billing import billing_integration` would resolve to the singleton INSTANCE
# (re-exported by core/billing/__init__.py), so grab the actual module via sys.modules.
bi = sys.modules["core.billing.billing_integration"]


class _Model:
    def __init__(self, provider): self.provider = provider


class _Provider:
    def __init__(self, value): self.value = value


@pytest.fixture(autouse=True)
def _force_prod(monkeypatch):
    from core.utils.config import EnvMode
    monkeypatch.setattr(bi.config, "ENV_MODE", EnvMode.PRODUCTION, raising=False)


def _patch_models(monkeypatch, provider_value):
    class _MM:
        @staticmethod
        def resolve_model_id(m): return m
        @staticmethod
        def get_model(m): return _Model(_Provider(provider_value))
    import core.ai_models as aim
    monkeypatch.setattr(aim, "model_manager", _MM())


def test_deduct_usage_removed():
    assert not hasattr(BillingIntegration, "deduct_usage")


async def test_provider_disabled_blocks(monkeypatch):
    _patch_models(monkeypatch, "openai")

    class _Policy:
        enabled_providers = ["anthropic"]

    class _PPS:
        async def get_policy(self, account_id, client=None): return _Policy()
    monkeypatch.setattr(bi, "_load_provider_policy_service", lambda: _PPS(), raising=False)

    async def _bal(account_id): return {"total": 100.0}
    monkeypatch.setattr(bi.credit_manager, "get_balance", _bal)

    ok, msg, ctx = await BillingIntegration.check_model_and_billing_access("a1", "openai/gpt-x")
    assert ok is False and ctx["error_type"] == "model_access_denied"


async def test_insufficient_balance_blocks(monkeypatch):
    _patch_models(monkeypatch, "anthropic")

    class _Policy:
        enabled_providers = ["anthropic"]

    class _PPS:
        async def get_policy(self, account_id, client=None): return _Policy()
    monkeypatch.setattr(bi, "_load_provider_policy_service", lambda: _PPS(), raising=False)

    async def _bal(account_id): return {"total": 0.0}
    monkeypatch.setattr(bi.credit_manager, "get_balance", _bal)

    ok, msg, ctx = await BillingIntegration.check_model_and_billing_access("a1", "anthropic/claude")
    assert ok is False and ctx["error_type"] == "insufficient_credits"


async def test_allows_when_enabled_and_funded(monkeypatch):
    _patch_models(monkeypatch, "anthropic")

    class _Policy:
        enabled_providers = ["anthropic"]

    class _PPS:
        async def get_policy(self, account_id, client=None): return _Policy()
    monkeypatch.setattr(bi, "_load_provider_policy_service", lambda: _PPS(), raising=False)

    async def _bal(account_id): return {"total": 5.0}
    monkeypatch.setattr(bi.credit_manager, "get_balance", _bal)

    ok, msg, ctx = await BillingIntegration.check_model_and_billing_access("a1", "anthropic/claude")
    assert ok is True and "local_mode" not in ctx
