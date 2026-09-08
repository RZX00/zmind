from __future__ import annotations

from typing import Any

from core.domains.agent.intent import IntentComplexity, IntentDomain, IntentResolution


_CANVAS_KEYWORDS = (
    "canvas",
    "whiteboard",
    "board",
    "layout",
    "mindmap",
    "mind map",
    "sticky",
    "frame",
    "node",
    "nodes",
    "edge",
    "edges",
    "connection",
    "connections",
    "画布",
    "白板",
    "节点",
    "连线",
    "布局",
    "排版",
    "脑图",
    "卡片",
)
_CANVAS_ACTIONS = (
    "arrange",
    "rearrange",
    "layout",
    "position",
    "connect",
    "group",
    "organize",
    "move",
    "排版",
    "整理",
    "连接",
    "归类",
    "移动",
)
_DOC_KEYWORDS = (
    "doc",
    "document",
    "page",
    "markdown",
    "outline",
    "section",
    "paragraph",
    "write",
    "rewrite",
    "文档",
    "大纲",
    "段落",
    "标题",
    "改写",
    "撰写",
)
_RESEARCH_KEYWORDS = (
    "research",
    "search",
    "browse",
    "web",
    "source",
    "sources",
    "citation",
    "citations",
    "verify",
    "fact",
    "调研",
    "研究",
    "搜索",
    "检索",
    "来源",
    "证据",
    "核实",
)
_INTEGRATION_KEYWORDS = (
    "api",
    "webhook",
    "integration",
    "sync",
    "import",
    "export",
    "github",
    "slack",
    "notion",
    "zapier",
    "mcp",
    "集成",
    "同步",
    "导入",
    "导出",
    "接口",
    "回调",
)
_COMPLEXITY_HINTS = (
    "并且",
    "同时",
    "然后",
    "之后",
    "最后",
    "先",
    "再",
    "and then",
    "after that",
    "finally",
)


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def _normalize_surface(value: Any) -> str:
    cleaned = str(value or "").strip().lower()
    if cleaned in {"canvas", "whiteboard", "board"}:
        return "canvas"
    if cleaned in {"doc", "document", "page"}:
        return "doc"
    return ""


def _keyword_hits(text: str, keywords: tuple[str, ...]) -> list[str]:
    return [keyword for keyword in keywords if keyword and keyword in text]


def _infer_complexity(text: str, total_signal_count: int) -> IntentComplexity:
    if not text:
        return "low"

    hint_count = sum(1 for hint in _COMPLEXITY_HINTS if hint in text)
    separator_count = text.count("，") + text.count(",") + text.count("；") + text.count(";")

    if len(text) >= 180 or total_signal_count >= 8 or hint_count >= 3 or separator_count >= 4:
        return "high"
    if len(text) >= 80 or total_signal_count >= 4 or hint_count >= 1 or separator_count >= 2:
        return "medium"
    return "low"


class IntentResolutionService:
    def resolve(
        self,
        latest_user_text: str,
        *,
        interaction_surface: str | None = None,
        agent_config: dict[str, Any] | None = None,
    ) -> IntentResolution:
        text = _normalize_text(latest_user_text)
        lowered = text.lower()
        surface = _normalize_surface(interaction_surface)

        if not surface and isinstance(agent_config, dict):
            surface = _normalize_surface(
                agent_config.get("interaction_surface")
                or agent_config.get("surface")
                or agent_config.get("target_surface")
            )

        scores: dict[IntentDomain, float] = {
            "canvas": 0.0,
            "doc": 0.0,
            "research": 0.0,
            "integration": 0.0,
            "generic": 0.0,
        }
        signals: list[str] = []

        if surface == "canvas":
            scores["canvas"] += 6.0
            signals.append("surface:canvas")
        elif surface == "doc":
            scores["doc"] += 4.0
            signals.append("surface:doc")

        canvas_hits = _keyword_hits(lowered, _CANVAS_KEYWORDS)
        doc_hits = _keyword_hits(lowered, _DOC_KEYWORDS)
        research_hits = _keyword_hits(lowered, _RESEARCH_KEYWORDS)
        integration_hits = _keyword_hits(lowered, _INTEGRATION_KEYWORDS)

        if canvas_hits:
            scores["canvas"] += min(6.0, float(len(canvas_hits)) * 1.5)
            signals.extend(f"canvas:{keyword}" for keyword in canvas_hits[:4])
        if doc_hits:
            scores["doc"] += min(5.0, float(len(doc_hits)) * 1.3)
            signals.extend(f"doc:{keyword}" for keyword in doc_hits[:4])
        if research_hits:
            scores["research"] += min(5.0, float(len(research_hits)) * 1.3)
            signals.extend(f"research:{keyword}" for keyword in research_hits[:4])
        if integration_hits:
            scores["integration"] += min(5.0, float(len(integration_hits)) * 1.4)
            signals.extend(f"integration:{keyword}" for keyword in integration_hits[:4])

        has_canvas_action = any(keyword in lowered for keyword in _CANVAS_ACTIONS)
        if canvas_hits and has_canvas_action:
            scores["canvas"] += 3.0
            signals.append("canvas:action_pair")

        if doc_hits and any(action in lowered for action in ("write", "rewrite", "draft", "撰写", "改写")):
            scores["doc"] += 2.0
            signals.append("doc:authoring_pair")

        if research_hits and any(token in lowered for token in ("latest", "recent", "today", "最新", "今天")):
            scores["research"] += 2.0
            signals.append("research:recency")

        if integration_hits and ("http://" in lowered or "https://" in lowered):
            scores["integration"] += 1.0
            signals.append("integration:url")

        ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        domain, top_score = ranked[0]
        runner_up = ranked[1][1] if len(ranked) > 1 else 0.0

        if top_score < 2.5 and not surface:
            domain = "generic"
            top_score = scores["generic"]
            runner_up = 0.0

        confidence = 0.22
        if domain != "generic":
            confidence = min(0.98, 0.42 + min(top_score, 10.0) * 0.045 + max(0.0, top_score - runner_up) * 0.05)

        target_surface = surface or ("canvas" if domain == "canvas" else "doc" if domain == "doc" else None)
        complexity = _infer_complexity(lowered, len(signals))

        return IntentResolution(
            domain=domain,
            user_goal=text,
            target_surface=target_surface,
            confidence=round(confidence, 3),
            complexity=complexity,
            signals=tuple(signals[:12]),
            metadata={
                "scores": {name: round(score, 2) for name, score in scores.items()},
                "surface_bias": surface or None,
                "text_length": len(text),
            },
        )
