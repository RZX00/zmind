from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from core.langgraph_engine.contracts.engine_interface import RunConfig
from core.langgraph_engine.nodes.call_model import DefaultCallModelNode
from core.langgraph_engine.supervisor.router import RouteHint
from core.skills.matcher import SkillMatch
from core.skills.orchestrator import build_skill_routing_plan
from core.skills.types import SkillDefinition
from core.tools.skills_tool import SkillsTool


class _StubToolRegistry:
    def get(self, name: str) -> object | None:
        if name == "run_skill":
            return object()
        return None


@pytest.mark.asyncio
async def test_smoke_auto_route_to_forced_tool_and_fork_run() -> None:
    route_hint = RouteHint(
        agents=("presentation_agent",),
        reason="semantic",
        keywords=(),
        should_delegate=True,
        skills=(),
    )
    skill = SkillDefinition(
        name="ppt-plan",
        description="Generate a ppt plan",
        prompt="Build a plan for: {input}",
        context="fork",
        user_invocable=True,
        disable_model_invocation=False,
    )

    with (
        patch(
            "core.skills.orchestrator.suggest_skills_with_scores",
            new_callable=AsyncMock,
            return_value=[SkillMatch(name="ppt-plan", score=9)],
        ),
        patch(
            "core.skills.orchestrator.get_skill_by_name",
            new_callable=AsyncMock,
            return_value=skill,
        ),
    ):
        routing_plan = await build_skill_routing_plan(
            route_hint=route_hint,
            message="帮我做一个SaaS路演PPT大纲",
            has_attachments=False,
            db=object(),
            account_id="acc_1",
            auto_run_enabled=True,
            auto_run_threshold=7,
        )

    assert routing_plan.auto_invocation is not None
    forced_payload = routing_plan.auto_invocation.to_tool_payload()

    events: list[dict[str, Any]] = []

    async def _emit(event: dict[str, Any]) -> None:
        events.append(event)

    state = {
        "agent_run_id": "ar_1",
        "thread_id": "th_1",
        "model_name": "openai/gpt-4o-mini",
        "messages_context": [],
        "engine": "langgraph",
        "engine_version": "2.0",
        "iteration": 0,
    }
    ctx = SimpleNamespace(stop_event=None, emit=_emit, tool_context={"forced_tool_call": forced_payload})

    call_model = DefaultCallModelNode(tool_registry=_StubToolRegistry())
    result_state = await call_model(state, ctx)
    pending = result_state["pending_tool_calls"][0]
    assert pending["name"] == "run_skill"
    assert pending["arguments"]["skill_id"] == "ppt-plan"
    assert len(events) == 3

    run_config = RunConfig(
        agent_run_id="ar_1",
        thread_id="th_1",
        project_id="proj_1",
        account_id="acc_1",
        model_name="openai/gpt-4o-mini",
    )
    tool = SkillsTool(
        thread_id="th_1",
        account_id="acc_1",
        run_config=run_config,
        tool_context={"project_id": "proj_1"},
    )

    tool.fork_executor.execute = AsyncMock(
        return_value={
            "success": True,
            "fork_thread_id": "fork_1",
            "output": "done",
        }
    )
    with patch("core.tools.skills_tool.get_skill_by_name", new_callable=AsyncMock, return_value=skill):
        run_result = await tool.run_skill(
            skill_id=pending["arguments"]["skill_id"],
            input=pending["arguments"]["input"],
        )

    assert run_result.success is True
    payload = json.loads(run_result.output)
    assert payload["execution_mode"] == "fork"
    assert payload["skill_name"] == "ppt-plan"


@pytest.mark.asyncio
async def test_smoke_install_then_run_skill_with_canvas_tool_output() -> None:
    installed_skill = SkillDefinition(
        name="canvas-structurer",
        description="Organize notes into a canvas syntax tree",
        prompt="Return canvas syntax for: {input}",
        allowed_tools=["canvas_edit"],
        user_invocable=True,
        disable_model_invocation=False,
    )

    run_config = RunConfig(
        agent_run_id="ar_2",
        thread_id="th_2",
        project_id="proj_2",
        account_id="acc_2",
        model_name="openai/gpt-4o-mini",
    )
    tool = SkillsTool(
        thread_id="th_2",
        account_id="acc_2",
        run_config=run_config,
        tool_context={"project_id": "proj_2"},
    )

    import_service = AsyncMock()
    import_service.import_from_raw_markdown.return_value = {
        "skill": installed_skill,
        "compatibility": {"status": "compatible"},
        "created": True,
    }
    import_service.close = AsyncMock()

    with patch("core.tools.skills_tool.SkillsImportService", return_value=import_service):
        install_result = await tool.install_skill(
            source_type="manual",
            markdown_content=(
                "---\n"
                "name: canvas-structurer\n"
                "description: Organize notes\n"
                "allowed-tools:\n"
                "  - canvas_edit\n"
                "---\n\n"
                "Build canvas syntax."
            ),
            force=True,
        )

    assert install_result.success is True
    install_payload = json.loads(install_result.output)
    assert install_payload["skill"]["name"] == "canvas-structurer"
    assert install_payload["created"] is True

    class _CheckpointStore:
        async def load(self, *_: object) -> dict | None:
            return None

    class _Engine:
        def __init__(self, **_: object) -> None:
            pass

        async def run(self, _: RunConfig):
            yield {
                "type": "assistant_final",
                "content": {"role": "assistant", "content": ""},
            }
            yield {
                "type": "tool_message",
                "name": "canvas_edit",
                "content": json.dumps({"data": {"syntax": "tree", "nodes": [{"id": "n1"}]}}),
                "success": True,
                "error": None,
                "tool_call_id": "tc_1",
            }

    with (
        patch("core.tools.skills_tool.get_skill_by_name", new_callable=AsyncMock, return_value=installed_skill),
        patch("core.tools.skills_tool.build_registry", return_value=object()),
        patch("core.tools.skills_tool.SupabaseCheckpointStore", return_value=_CheckpointStore()),
        patch("core.tools.skills_tool.LangGraphEngine", _Engine),
    ):
        run_result = await tool.run_skill(
            skill_id="canvas-structurer",
            input="把我的笔记整理成画布结构",
        )

    assert run_result.success is True
    run_payload = json.loads(run_result.output)
    assert run_payload["skill_name"] == "canvas-structurer"
    assert run_payload["output"]["syntax"] == "tree"
    assert run_payload["output"]["nodes"][0]["id"] == "n1"
