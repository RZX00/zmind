from __future__ import annotations

import asyncio

import pytest

from core.services.llm import _run_hedged_requests


@pytest.mark.asyncio
async def test_run_hedged_requests_returns_primary_when_fast() -> None:
    async def primary():
        await asyncio.sleep(0.005)
        return "primary"

    async def hedge():
        await asyncio.sleep(0.05)
        return "hedge"

    result = await _run_hedged_requests(
        primary_factory=primary,
        hedge_factory=hedge,
        delay_ms=20,
        primary_model="model-primary",
        hedge_model="model-hedge",
    )
    assert result == "primary"


@pytest.mark.asyncio
async def test_run_hedged_requests_falls_back_to_hedge_when_primary_fails() -> None:
    async def primary():
        await asyncio.sleep(0.03)
        raise RuntimeError("primary failed")

    async def hedge():
        await asyncio.sleep(0.005)
        return "hedge"

    result = await _run_hedged_requests(
        primary_factory=primary,
        hedge_factory=hedge,
        delay_ms=1,
        primary_model="model-primary",
        hedge_model="model-hedge",
    )
    assert result == "hedge"
