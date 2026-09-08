"""
Skill matching utilities.

Provide lightweight heuristics to suggest relevant skills for a user message.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

from core.skills.registry import load_all_skills
from core.skills.types import SkillDefinition
from core.services.supabase import DBConnection
from core.utils.logger import logger


TOKEN_RE = re.compile(r"[a-z0-9]+", re.IGNORECASE)


@dataclass(frozen=True)
class SkillMatch:
    name: str
    score: int


def _tokenize(text: str) -> set[str]:
    return set(TOKEN_RE.findall(text.lower()))


def _score_skill(skill: SkillDefinition, *, message: str, tokens: set[str]) -> int:
    score = 0
    lower_message = message.lower()

    if skill.name and skill.name in lower_message:
        score += 4

    name_tokens = _tokenize(skill.name.replace("-", " "))
    if name_tokens & tokens:
        score += 2

    summary = " ".join(
        part
        for part in [skill.name, skill.description, skill.argument_hint or ""]
        if part
    )
    summary_tokens = _tokenize(summary)
    score += len(summary_tokens & tokens)

    # Heuristic boosts for built-in skills
    if skill.name == "ppt-plan":
        if any(key in lower_message for key in ("ppt", "slide", "slides", "deck", "演示", "幻灯", "汇报")):
            score += 3
    if skill.name == "note-to-structure":
        if any(key in lower_message for key in ("note", "notes", "笔记", "整理", "结构", "结构化", "归纳", "主题")):
            score += 3

    return score


def match_skills_with_scores(
    message: str,
    skills: Iterable[SkillDefinition],
    *,
    max_results: int = 3,
    min_score: int = 2,
) -> list[SkillMatch]:
    text = (message or "").strip()
    if not text:
        return []
    tokens = _tokenize(text)

    scored: list[tuple[int, SkillDefinition]] = []
    for skill in skills:
        if not skill or not skill.user_invocable:
            continue
        if skill.disable_model_invocation:
            continue
        score = _score_skill(skill, message=text, tokens=tokens)
        if score >= min_score:
            scored.append((score, skill))

    scored.sort(key=lambda item: (-item[0], item[1].name))
    return [SkillMatch(name=skill.name, score=score) for score, skill in scored[:max_results]]


def match_skills(
    message: str,
    skills: Iterable[SkillDefinition],
    *,
    max_results: int = 3,
    min_score: int = 2,
) -> list[str]:
    return [match.name for match in match_skills_with_scores(
        message,
        skills,
        max_results=max_results,
        min_score=min_score,
    )]


async def suggest_skills(
    message: str,
    *,
    db: DBConnection,
    account_id: str,
    max_results: int = 3,
) -> list[str]:
    try:
        skills = await load_all_skills(
            db=db,
            account_id=account_id,
            include_disabled=False,
        )
    except Exception as exc:
        logger.debug("Skill matcher: failed to load skills", error=str(exc))
        return []

    return match_skills(message, skills, max_results=max_results)


async def suggest_skills_with_scores(
    message: str,
    *,
    db: DBConnection,
    account_id: str,
    max_results: int = 3,
) -> list[SkillMatch]:
    try:
        skills = await load_all_skills(
            db=db,
            account_id=account_id,
            include_disabled=False,
        )
    except Exception as exc:
        logger.debug("Skill matcher: failed to load skills", error=str(exc))
        return []

    return match_skills_with_scores(message, skills, max_results=max_results)
