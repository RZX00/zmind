from __future__ import annotations

import pytest
from pydantic import BaseModel, Field

from core.langgraph_engine.contracts import SideEffectLevel, ToolSpec
from core.langgraph_engine.tools.registry import InMemoryToolRegistry


class _DocUpdateTitleArgs(BaseModel):
    doc_item_id: str | None = None
    title: str = Field(min_length=1)


class _RequiredTitleArgs(BaseModel):
    title: str = Field(min_length=1)


class _DocGenerateImageArgs(BaseModel):
    prompt: str = Field(min_length=1)
    summary: str | None = None


@pytest.mark.asyncio
async def test_registry_repairs_doc_update_title_from_latest_user_text() -> None:
    registry = InMemoryToolRegistry()
    captured: dict[str, object] = {}

    async def _handler(args, context):
        captured["args"] = args
        return {"success": True, "output": {"title": args.get("title")}}

    registry.register(
        ToolSpec(
            name="doc_update_title",
            description="update doc title",
            args_model=_DocUpdateTitleArgs,
            handler=_handler,
            side_effect_level=SideEffectLevel.REVERSIBLE_WRITE,
        )
    )

    res = await registry.execute_tool_call(
        {"id": "tc1", "name": "doc_update_title", "arguments": {}},
        {"latest_user_text": "把标题改成“Docker 部署实战教程”"},
    )

    assert res["success"] is True
    assert captured["args"] == {"doc_item_id": None, "title": "Docker 部署实战教程"}


@pytest.mark.asyncio
async def test_registry_skips_doc_update_title_when_missing_and_unrepairable() -> None:
    registry = InMemoryToolRegistry()
    called = {"count": 0}

    async def _handler(args, context):
        called["count"] += 1
        return {"success": True}

    registry.register(
        ToolSpec(
            name="doc_update_title",
            description="update doc title",
            args_model=_DocUpdateTitleArgs,
            handler=_handler,
            side_effect_level=SideEffectLevel.REVERSIBLE_WRITE,
        )
    )

    res = await registry.execute_tool_call(
        {"id": "tc2", "name": "doc_update_title", "arguments": {}},
        {"latest_user_text": "继续写正文，不改标题"},
    )

    assert res["success"] is True
    assert res["output"] == {"skipped": True, "reason": "missing_required_title"}
    assert called["count"] == 0


@pytest.mark.asyncio
async def test_registry_repairs_doc_generate_image_prompt_from_latest_user_text() -> None:
    registry = InMemoryToolRegistry()
    captured: dict[str, object] = {}

    async def _handler(args, context):
        captured["args"] = args
        return {"success": True}

    registry.register(
        ToolSpec(
            name="doc_generate_image_and_insert",
            description="generate and insert image",
            args_model=_DocGenerateImageArgs,
            handler=_handler,
            side_effect_level=SideEffectLevel.REVERSIBLE_WRITE,
        )
    )

    res = await registry.execute_tool_call(
        {"id": "tc_img", "name": "doc_generate_image_and_insert", "arguments": {}},
        {"latest_user_text": "生成一张 Docker Build Ship Run 的信息图"},
    )

    assert res["success"] is True
    assert captured["args"] == {"prompt": "生成一张 Docker Build Ship Run 的信息图", "summary": None}


@pytest.mark.asyncio
async def test_registry_skips_doc_generate_image_when_missing_and_unrepairable() -> None:
    registry = InMemoryToolRegistry()
    called = {"count": 0}

    async def _handler(args, context):
        called["count"] += 1
        return {"success": True}

    registry.register(
        ToolSpec(
            name="doc_generate_image_and_insert",
            description="generate and insert image",
            args_model=_DocGenerateImageArgs,
            handler=_handler,
            side_effect_level=SideEffectLevel.REVERSIBLE_WRITE,
        )
    )

    res = await registry.execute_tool_call(
        {"id": "tc_img_skip", "name": "doc_generate_image_and_insert", "arguments": {}},
        {"latest_user_text": ""},
    )

    assert res["success"] is True
    assert res["output"] == {"skipped": True, "reason": "missing_required_prompt"}
    assert called["count"] == 0


@pytest.mark.asyncio
async def test_registry_repairs_doc_update_title_from_state_messages_context() -> None:
    registry = InMemoryToolRegistry()
    captured: dict[str, object] = {}

    async def _handler(args, context):
        captured["args"] = args
        return {"success": True}

    registry.register(
        ToolSpec(
            name="doc_update_title",
            description="update doc title",
            args_model=_DocUpdateTitleArgs,
            handler=_handler,
            side_effect_level=SideEffectLevel.REVERSIBLE_WRITE,
        )
    )

    res = await registry.execute_tool_call(
        {"id": "tc_ctx", "name": "doc_update_title", "arguments": {}},
        {
            "state": {
                "messages_context": [
                    {"role": "assistant", "content": "ok"},
                    {"role": "user", "content": "请把标题改成《系统设计总览》"},
                ]
            }
        },
    )

    assert res["success"] is True
    assert captured["args"] == {"doc_item_id": None, "title": "系统设计总览"}


@pytest.mark.asyncio
async def test_registry_keeps_validation_error_for_non_doc_tools() -> None:
    registry = InMemoryToolRegistry()

    async def _handler(args, context):
        return {"success": True}

    registry.register(
        ToolSpec(
            name="strict_title_tool",
            description="strict title",
            args_model=_RequiredTitleArgs,
            handler=_handler,
            side_effect_level=SideEffectLevel.READ_ONLY,
        )
    )

    res = await registry.execute_tool_call(
        {"id": "tc3", "name": "strict_title_tool", "arguments": {}},
        {},
    )

    assert res["success"] is False
    assert str(res.get("error") or "").startswith("args_validation_error:")
