from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any, Iterable

from core.utils.logger import logger
from core.services.llm import make_llm_api_call
from core.langgraph_engine.research_graph.utils import extract_json_payload, normalize_message_content
from core.prompts.prompt_files import read_prompt_file_or_fallback


@dataclass(frozen=True)
class RouteHint:
    agents: tuple[str, ...]
    reason: str
    keywords: tuple[str, ...]
    should_delegate: bool
    skills: tuple[str, ...] = ()


@dataclass(frozen=True)
class LatestUserMessage:
    text: str
    has_attachments: bool
    cta_action: str | None = None

ALLOWED_ROUTE_AGENTS: tuple[str, ...] = (
    "canvas_agent",
    "presentation_agent",
    "deep_research_agent",
    "integration_agent",
)

DEFAULT_SEMANTIC_ROUTER_PROMPT = (
    "You are a routing module for a multi-agent assistant. The main agent can handle most tasks directly "
    "using tools, so delegate only when specialized context or restrictions apply.\n"
    "Return JSON only with keys: should_delegate (boolean), agents (array of agent names), reason (short), "
    "signals (optional array), skills (optional array of skill ids).\n"
    "Allowed agents: canvas_agent, presentation_agent, deep_research_agent, integration_agent.\n"
    "Rules:\n"
    "- Use canvas_agent when the user asks to create/edit/organize/visualize on the canvas, or to generate/draw images (infographics, illustrations, posters, concept art, photos). Any request involving canvas_generate_image must route to canvas_agent.\n"
    "- Use presentation_agent for PPT/slide/presentation generation requests.\n"
    "- Use deep_research_agent only for multi-source research with citations or deep exploration.\n"
    "- Use integration_agent for external API/MCP/data provider actions or connections.\n"
    "- Critical reasoning, Socratic dialogue, and multi-agent synthesis are handled by the main agent directly.\n"
    "- Default to should_delegate=false for simple or direct requests.\n"
    "- Max 2 agents.\n"
)

SOCRATIC_KEYWORDS = (
    "think",
    "thinking",
    "reasoning",
    "logic",
    "analysis",
    "define",
    "definition",
    "assumption",
    "premise",
    "scope",
    "boundary",
    "tradeoff",
    "trade-off",
    "philosophy",
    "decision",
    "思考",
    "推理",
    "逻辑",
    "分析",
    "定义",
    "概念",
    "假设",
    "前提",
    "边界",
    "范围",
    "取舍",
    "权衡",
    "盲点",
    "为何",
    "为什么",
    "是否应该",
    "价值判断",
    "决策",
    "哲学",
)

CANVAS_KEYWORDS = (
    "canvas",
    "\u753b\u5e03",
    "\u8282\u70b9",
    "node",
    "\u8fde\u7ebf",
    "connection",
    "mindmap",
    "\u8111\u56fe",
    "mermaid",
    "svg",
    "\u8868\u683c",
    "table",
    # Image generation keywords
    "\u753b\u56fe",
    "\u753b\u4e00",
    "\u751f\u6210\u56fe",
    "\u4fe1\u606f\u56fe",
    "\u63d2\u753b",
    "\u6982\u5ff5\u56fe",
    "\u56fe\u50cf",
    "\u56fe\u7247",
    "\u6d77\u62a5",
    "infographic",
    "illustration",
    "generate image",
    "draw",
)

RESEARCH_KEYWORDS = (
    "search",
    "research",
    "web",
    "\u7f51\u7ad9",
    "\u7f51\u9875",
    "\u8d44\u6599",
    "\u6765\u6e90",
    "\u5f15\u7528",
    "\u65b0\u95fb",
    "\u67e5\u627e",
    "\u641c\u7d22",
    "\u641c",
    "\u94fe\u63a5",
    "url",
)

INTEGRATION_KEYWORDS = (
    "api",
    "webhook",
    "mcp",
    "integration",
    "connect",
    "\u8fde\u63a5",
    "oauth",
    "token",
    "composio",
    "provider",
    "data provider",
)

PRESENTATION_KEYWORDS = (
    "ppt",
    "presentation",
    "slide",
    "slides",
    "deck",
    "pitch",
    "\u6f14\u793a",
    "\u5e7b\u706f\u7247",
    "\u7ffb\u9875",
)

def _supports_json_object_response_format(model_name: str) -> bool:
    normalized = (model_name or "").strip().lower()
    # Habitat GPT-5 endpoints have shown response_format incompatibilities in production.
    if "gpt-5" in normalized and "habitat/" in normalized:
        return False
    return True


def _semantic_router_timeout_seconds() -> float:
    raw = (os.getenv("SEMANTIC_ROUTER_TIMEOUT_MS") or "").strip()
    if not raw:
        return 2.5
    try:
        value_ms = float(raw)
        if value_ms <= 0:
            return 2.5
        return value_ms / 1000.0
    except Exception:
        return 2.5


def _extract_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        try:
            parsed = json.loads(content)
        except Exception:
            return content
        if isinstance(parsed, dict):
            inner = parsed.get("content")
            if isinstance(inner, str):
                return inner
            return json.dumps(parsed, ensure_ascii=True)
        return str(parsed)
    if isinstance(content, dict):
        inner = content.get("content")
        if isinstance(inner, str):
            return inner
        return json.dumps(content, ensure_ascii=True)
    return str(content)

def _get_attr(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    try:
        if hasattr(obj, key):
            return getattr(obj, key)
    except Exception:
        return default
    return default


def _extract_llm_text(response: Any) -> str:
    choices = _get_attr(response, "choices", []) or []
    if choices:
        choice0 = choices[0]
        message = _get_attr(choice0, "message", None)
        content = _get_attr(message, "content", None)
        if content is None:
            content = _get_attr(message, "parts", None)
        if content is not None:
            return normalize_message_content(content)
    return normalize_message_content(response)


def _normalize_agent_list(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        if "," in text:
            return [part.strip() for part in text.split(",") if part.strip()]
        return [text]
    if isinstance(raw, list):
        out: list[str] = []
        for item in raw:
            if isinstance(item, str) and item.strip():
                out.append(item.strip())
        return out
    if isinstance(raw, dict):
        return _normalize_agent_list(raw.get("agents") or raw.get("agent"))
    return []


def _route_from_cta_action(action: str | None) -> RouteHint | None:
    if not action:
        return None
    normalized = action.strip().lower()
    if not normalized:
        return None
    if normalized.startswith("presentation."):
        return RouteHint(
            agents=("presentation_agent",),
            reason="cta_action",
            keywords=(f"cta:{normalized}",),
            should_delegate=True,
            skills=(),
        )
    if normalized.startswith("canvas."):
        return RouteHint(
            agents=("canvas_agent",),
            reason="cta_action",
            keywords=(f"cta:{normalized}",),
            should_delegate=True,
            skills=(),
        )
    return None


def _route_from_payload(payload: dict[str, Any]) -> RouteHint:
    agents = _normalize_agent_list(
        payload.get("agents")
        or payload.get("agent")
        or payload.get("route_to")
        or payload.get("subagents")
    )
    allowed = set(ALLOWED_ROUTE_AGENTS)
    filtered = [agent for agent in agents if agent in allowed]

    route_type = str(payload.get("route_type") or "").strip().lower()
    should_delegate = payload.get("should_delegate")
    if should_delegate is None:
        if route_type in ("direct", "none", "main"):
            should_delegate = False
        elif route_type in ("subagent", "delegate", "multi"):
            should_delegate = True
    should_delegate = bool(should_delegate) and bool(filtered)

    reason = str(payload.get("reason") or "semantic_router").strip() or "semantic_router"
    signals = payload.get("signals")
    keywords = tuple(_normalize_agent_list(signals))
    skills = tuple(_normalize_agent_list(payload.get("skills")))

    if not should_delegate:
        return RouteHint(agents=(), reason=reason, keywords=keywords, should_delegate=False, skills=skills)

    deduped: list[str] = []
    for agent in filtered:
        if agent not in deduped:
            deduped.append(agent)
        if len(deduped) >= 3:
            break

    return RouteHint(
        agents=tuple(deduped),
        reason=reason,
        keywords=keywords,
        should_delegate=True,
        skills=skills,
    )


async def route_from_semantic(
    message: str,
    *,
    model_name: str,
    has_attachments: bool = False,
    cta_action: str | None = None,
) -> RouteHint:
    cta_route = _route_from_cta_action(cta_action)
    if cta_route:
        return cta_route

    normalized = message.strip()
    if not normalized and not has_attachments:
        return RouteHint(agents=(), reason="empty_message", keywords=(), should_delegate=False, skills=())

    system_prompt = read_prompt_file_or_fallback(
        "routing/semantic_router.prompt.md",
        DEFAULT_SEMANTIC_ROUTER_PROMPT,
    )
    user_prompt = (
        f"User message: {normalized or '[empty]'}\n"
        f"Has attachments: {str(bool(has_attachments)).lower()}\n"
        f"CTA action: {cta_action or 'none'}\n"
        "Return JSON."
    )

    response_format = {"type": "json_object"} if _supports_json_object_response_format(model_name) else None
    timeout_seconds = _semantic_router_timeout_seconds()

    try:
        response = await asyncio.wait_for(
            make_llm_api_call(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                model_name=model_name,
                response_format=response_format,
                temperature=0,
                max_tokens=200,
                enable_thinking=False,
                reasoning_effort="low",
            ),
            timeout=timeout_seconds,
        )
    except asyncio.TimeoutError as exc:
        raise TimeoutError(
            f"semantic router timed out after {timeout_seconds:.2f}s using model {model_name}"
        ) from exc

    text = _extract_llm_text(response)
    payload = extract_json_payload(text)
    if not isinstance(payload, dict):
        raise ValueError("Semantic router returned non-JSON payload")
    return _route_from_payload(payload)


def _keyword_hits(text: str, keywords: Iterable[str]) -> list[str]:
    hits: list[str] = []
    for kw in keywords:
        if kw in text:
            hits.append(kw)
    return hits


def route_from_text(message: str, *, cta_action: str | None = None) -> RouteHint:
    normalized = message.lower().strip()

    agents: list[str] = []
    keywords: list[str] = []

    action = (cta_action or "").strip().lower()
    if action:
        if action.startswith("presentation."):
            agents.append("presentation_agent")
            keywords.append(f"cta:{action}")
        elif action.startswith("canvas."):
            agents.append("canvas_agent")
            keywords.append(f"cta:{action}")

    # Socratic/reasoning keywords no longer route to a sub-agent;
    # the main agent handles critical thinking directly.

    canvas_hits = _keyword_hits(normalized, CANVAS_KEYWORDS)
    if canvas_hits:
        agents.append("canvas_agent")
        keywords.extend(canvas_hits)

    presentation_hits = _keyword_hits(normalized, PRESENTATION_KEYWORDS)
    if presentation_hits:
        agents.append("presentation_agent")
        keywords.extend(presentation_hits)

    research_hits = _keyword_hits(normalized, RESEARCH_KEYWORDS)
    if research_hits:
        agents.append("deep_research_agent")
        keywords.extend(research_hits)

    integration_hits = _keyword_hits(normalized, INTEGRATION_KEYWORDS)
    if integration_hits:
        agents.append("integration_agent")
        keywords.extend(integration_hits)

    if not agents:
        if not normalized and not action:
            return RouteHint(agents=(), reason="empty_message", keywords=(), should_delegate=False, skills=())
        return RouteHint(agents=(), reason="no_tool_keywords", keywords=(), should_delegate=False, skills=())

    reason = "cta_action" if action and not normalized else "keyword_match"
    return RouteHint(
        agents=tuple(dict.fromkeys(agents)),
        reason=reason,
        keywords=tuple(keywords),
        should_delegate=True,
        skills=(),
    )


def build_supervisor_hint(route: RouteHint) -> str | None:
    if not route.agents and not route.skills:
        return None
    agents = ", ".join(route.agents) if route.agents else "none"
    kw = ", ".join(route.keywords) if route.keywords else route.reason
    skills = ", ".join(route.skills) if route.skills else "none"
    return (
        "Supervisor routing hint: "
        f"route to {agents}. Signals: {kw}. Suggested skills: {skills}."
    )


def _has_attachments(metadata: Any) -> bool:
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except Exception:
            return False
    if not isinstance(metadata, dict):
        return False
    attachments = metadata.get("attachments")
    return isinstance(attachments, list) and len(attachments) > 0


def _extract_cta_action(metadata: Any) -> str | None:
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except Exception:
            return None
    if not isinstance(metadata, dict):
        return None
    raw = metadata.get("cta_action") or metadata.get("ctaAction")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return None


async def fetch_latest_user_message(client: Any, thread_id: str) -> LatestUserMessage:
    try:
        result = (
            await client.table("messages")
            .select("content, metadata")
            .eq("thread_id", thread_id)
            .eq("type", "user")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.debug("Supervisor router failed to fetch latest user message", error=str(exc))
        return LatestUserMessage(text="", has_attachments=False, cta_action=None)

    rows = result.data or []
    if not rows:
        return LatestUserMessage(text="", has_attachments=False, cta_action=None)
    row = rows[0]
    text = _extract_text(row.get("content"))
    has_attachments = _has_attachments(row.get("metadata"))
    cta_action = _extract_cta_action(row.get("metadata"))
    return LatestUserMessage(text=text, has_attachments=has_attachments, cta_action=cta_action)
