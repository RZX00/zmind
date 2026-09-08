from __future__ import annotations
from decimal import Decimal
from types import SimpleNamespace
import pytest
from core.billing import pricing


def _fake_model(input_pm, output_pm):
    return SimpleNamespace(pricing=SimpleNamespace(
        input_cost_per_million_tokens=input_pm, output_cost_per_million_tokens=output_pm))


def test_known_model_applies_markup(monkeypatch):
    monkeypatch.setattr(pricing.model_manager, "resolve_model_id", lambda m: m)
    monkeypatch.setattr(pricing.model_manager, "get_model", lambda m: _fake_model(1.0, 2.0))
    # (1M*1/1e6 + 1M*2/1e6) * 1.2 = (1 + 2)*1.2 = 3.6
    cost = pricing.calculate_token_cost(1_000_000, 1_000_000, "x")
    assert cost == Decimal("3.6")


def test_unknown_model_falls_back(monkeypatch):
    monkeypatch.setattr(pricing.model_manager, "resolve_model_id", lambda m: m)
    monkeypatch.setattr(pricing.model_manager, "get_model", lambda m: None)
    assert pricing.calculate_token_cost(100, 100, "unknown") == pricing.DEFAULT_UNKNOWN_MODEL_COST


def test_api_reexports_same_function():
    from core.billing import api
    assert api.calculate_token_cost is pricing.calculate_token_cost
