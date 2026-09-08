from __future__ import annotations

import pytest
from pydantic import BaseModel

from core.langgraph_engine.contracts import SideEffectLevel, ToolSpec
from core.langgraph_engine.tools.registry import InMemoryToolRegistry


class _NoArgs(BaseModel):
    pass


async def _ok_handler(args, context):
    return {"success": True}


def _registry_with_tool(name: str, level: SideEffectLevel) -> InMemoryToolRegistry:
    registry = InMemoryToolRegistry()
    registry.register(
        ToolSpec(
            name=name,
            description="dummy",
            args_model=_NoArgs,
            handler=_ok_handler,
            side_effect_level=level,
        )
    )
    return registry


@pytest.mark.asyncio
async def test_shadow_blocks_non_read_only():
    registry = _registry_with_tool("rev_tool", SideEffectLevel.REVERSIBLE_WRITE)
    res = await registry.execute_tool_call(
        {"id": "tc1", "name": "rev_tool", "arguments": {}},
        {"is_shadow": True, "side_effect_policy": "allow_all"},
    )
    assert res["success"] is False
    assert res.get("error") == "disabled_in_shadow"


@pytest.mark.asyncio
async def test_shadow_allows_read_only():
    registry = _registry_with_tool("read_tool", SideEffectLevel.READ_ONLY)
    res = await registry.execute_tool_call(
        {"id": "tc2", "name": "read_tool", "arguments": {}},
        {"is_shadow": True, "side_effect_policy": "allow_all"},
    )
    assert res["success"] is True


@pytest.mark.asyncio
async def test_dry_run_blocks_writes_in_primary():
    registry = _registry_with_tool("write_tool", SideEffectLevel.REVERSIBLE_WRITE)
    res = await registry.execute_tool_call(
        {"id": "tc3", "name": "write_tool", "arguments": {}},
        {"is_shadow": False, "side_effect_policy": "dry_run"},
    )
    assert res["success"] is False
    assert res.get("error") == "disabled_in_shadow"


@pytest.mark.asyncio
async def test_allow_all_permits_writes_in_primary():
    registry = _registry_with_tool("write_tool", SideEffectLevel.REVERSIBLE_WRITE)
    res = await registry.execute_tool_call(
        {"id": "tc4", "name": "write_tool", "arguments": {}},
        {"is_shadow": False, "side_effect_policy": "allow_all"},
    )
    assert res["success"] is True
