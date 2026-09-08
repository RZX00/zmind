"""
Skill orchestration for routing-time matching and deterministic auto invocation.

This module keeps skill selection policy out of the worker entrypoint and makes
the decision pipeline explicit:
1) merge semantic-route hints with heuristic matcher results
2) filter to invocable skills only
3) optionally produce an auto-invocation plan
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from core.langgraph_engine.supervisor.router import RouteHint
from core.services.supabase import DBConnection
from core.utils.logger import logger

from .matcher import SkillMatch, suggest_skills_with_scores
from .registry import get_skill_by_name


@dataclass(frozen=True)
class AutoSkillInvocation:
    """A deterministic instruction to invoke `run_skill` before model planning."""

    skill_id: str
    input_text: str
    reason: str
    score: int | None = None
    threshold: int | None = None

    def to_tool_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "tool": "run_skill",
            "skill_id": self.skill_id,
            "input": self.input_text,
            "reason": self.reason,
        }
        if self.score is not None:
            payload["score"] = self.score
        if self.threshold is not None:
            payload["threshold"] = self.threshold
        return payload


@dataclass(frozen=True)
class SkillRoutingPlan:
    """Result of routing-time skill planning."""

    route_hint: RouteHint
    suggestions: tuple[SkillMatch, ...]
    auto_invocation: AutoSkillInvocation | None = None


def _dedupe_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        key = str(value or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


async def _filter_invocable_candidates(
    names: list[str],
    *,
    db: DBConnection,
    account_id: str,
) -> list[str]:
    """Keep only skills that exist and can be model-invoked."""
    filtered: list[str] = []
    for name in names:
        skill = await get_skill_by_name(name, db=db, account_id=account_id)
        if not skill:
            continue
        if not skill.user_invocable:
            continue
        if skill.disable_model_invocation:
            continue
        filtered.append(name)
    return filtered


async def build_skill_routing_plan(
    *,
    route_hint: RouteHint,
    message: str,
    has_attachments: bool,
    db: DBConnection,
    account_id: str,
    auto_run_enabled: bool,
    auto_run_threshold: int,
    max_results: int = 3,
) -> SkillRoutingPlan:
    """Build a routing plan for skills (including optional deterministic auto-run)."""
    text = (message or "").strip()

    suggestions: list[SkillMatch] = []
    merged_skills = list(route_hint.skills or ())

    if not merged_skills and text:
        try:
            suggestions = await suggest_skills_with_scores(
                text,
                db=db,
                account_id=account_id,
                max_results=max_results,
            )
            merged_skills = [match.name for match in suggestions]
        except Exception as exc:
            logger.debug("Skill orchestrator: matcher failed", error=str(exc))

    merged_skills = _dedupe_keep_order(merged_skills)
    if merged_skills:
        merged_skills = await _filter_invocable_candidates(
            merged_skills,
            db=db,
            account_id=account_id,
        )

    updated_hint = route_hint
    if tuple(merged_skills) != route_hint.skills:
        updated_hint = RouteHint(
            agents=route_hint.agents,
            reason=route_hint.reason or "skill_match",
            keywords=route_hint.keywords,
            should_delegate=route_hint.should_delegate,
            skills=tuple(merged_skills),
        )

    auto_invocation: Optional[AutoSkillInvocation] = None
    if auto_run_enabled and not has_attachments and text and merged_skills:
        score_map = {item.name: item.score for item in suggestions}
        first = merged_skills[0]
        first_score = score_map.get(first)

        if first_score is None or first_score >= auto_run_threshold:
            auto_invocation = AutoSkillInvocation(
                skill_id=first,
                input_text=text,
                reason="router_skill_hint" if first_score is None else "matcher_score",
                score=first_score,
                threshold=auto_run_threshold if first_score is not None else None,
            )

    return SkillRoutingPlan(
        route_hint=updated_hint,
        suggestions=tuple(suggestions),
        auto_invocation=auto_invocation,
    )
