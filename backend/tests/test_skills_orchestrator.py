from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from core.langgraph_engine.supervisor.router import RouteHint
from core.skills.matcher import SkillMatch
from core.skills.orchestrator import build_skill_routing_plan


@pytest.mark.asyncio
async def test_build_skill_routing_plan_filters_and_auto_invokes() -> None:
    route_hint = RouteHint(
        agents=("canvas_agent",),
        reason="semantic",
        keywords=(),
        should_delegate=True,
        skills=(),
    )

    invocable = SimpleNamespace(user_invocable=True, disable_model_invocation=False)
    blocked = SimpleNamespace(user_invocable=False, disable_model_invocation=False)

    with (
        patch(
            "core.skills.orchestrator.suggest_skills_with_scores",
            new_callable=AsyncMock,
            return_value=[SkillMatch(name="good-skill", score=9), SkillMatch(name="blocked-skill", score=10)],
        ) as mock_suggest,
        patch("core.skills.orchestrator.get_skill_by_name", new_callable=AsyncMock) as mock_get_skill,
    ):
        async def _fake_get(name: str, **_: object):
            return invocable if name == "good-skill" else blocked

        mock_get_skill.side_effect = _fake_get

        plan = await build_skill_routing_plan(
            route_hint=route_hint,
            message="please help me run the skill",
            has_attachments=False,
            db=object(),
            account_id="acc-1",
            auto_run_enabled=True,
            auto_run_threshold=7,
        )

    mock_suggest.assert_awaited_once()
    assert plan.route_hint.skills == ("good-skill",)
    assert plan.auto_invocation is not None
    assert plan.auto_invocation.skill_id == "good-skill"
    assert plan.auto_invocation.score == 9


@pytest.mark.asyncio
async def test_build_skill_routing_plan_uses_hint_skills_without_matcher() -> None:
    route_hint = RouteHint(
        agents=(),
        reason="hint",
        keywords=(),
        should_delegate=False,
        skills=("hinted-skill",),
    )

    invocable = SimpleNamespace(user_invocable=True, disable_model_invocation=False)

    with (
        patch(
            "core.skills.orchestrator.suggest_skills_with_scores",
            new_callable=AsyncMock,
            return_value=[],
        ) as mock_suggest,
        patch(
            "core.skills.orchestrator.get_skill_by_name",
            new_callable=AsyncMock,
            return_value=invocable,
        ) as mock_get_skill,
    ):
        plan = await build_skill_routing_plan(
            route_hint=route_hint,
            message="anything",
            has_attachments=False,
            db=object(),
            account_id="acc-2",
            auto_run_enabled=False,
            auto_run_threshold=7,
        )

    mock_suggest.assert_not_called()
    mock_get_skill.assert_awaited_once()
    assert plan.route_hint.skills == ("hinted-skill",)
    assert plan.auto_invocation is None


@pytest.mark.asyncio
async def test_build_skill_routing_plan_disables_auto_invoke_with_attachments() -> None:
    route_hint = RouteHint(
        agents=(),
        reason="hint",
        keywords=(),
        should_delegate=False,
        skills=("skill-a",),
    )
    invocable = SimpleNamespace(user_invocable=True, disable_model_invocation=False)

    with patch(
        "core.skills.orchestrator.get_skill_by_name",
        new_callable=AsyncMock,
        return_value=invocable,
    ):
        plan = await build_skill_routing_plan(
            route_hint=route_hint,
            message="run it",
            has_attachments=True,
            db=object(),
            account_id="acc-3",
            auto_run_enabled=True,
            auto_run_threshold=1,
        )

    assert plan.route_hint.skills == ("skill-a",)
    assert plan.auto_invocation is None
