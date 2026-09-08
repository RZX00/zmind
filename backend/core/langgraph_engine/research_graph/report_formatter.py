from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable


def _to_iso_date() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _safe_text(value: Any, *, limit: int = 400) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    return text[:limit].strip()


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def select_canvas_claim_cards(
    claims: list[dict[str, Any]],
    claim_verdicts: list[dict[str, Any]],
    confidence_scores: list[dict[str, Any]],
    *,
    limit: int,
) -> list[dict[str, Any]]:
    if limit <= 0:
        return []

    verdict_by_claim = {
        str(item.get("claim_id")): item
        for item in claim_verdicts
        if isinstance(item, dict) and item.get("claim_id")
    }
    score_by_claim = {
        str(item.get("claim_id")): item
        for item in confidence_scores
        if isinstance(item, dict) and item.get("claim_id")
    }

    rank_map = {"high": 3, "medium": 2, "low": 1}
    cards: list[dict[str, Any]] = []
    for claim in claims:
        if not isinstance(claim, dict):
            continue
        claim_id = str(claim.get("claim_id") or "").strip()
        if not claim_id:
            continue
        importance = _safe_text(claim.get("importance"), limit=16).lower() or "medium"
        text = _safe_text(claim.get("text") or claim.get("claim"), limit=180)
        if not text:
            continue
        verdict = verdict_by_claim.get(claim_id, {})
        score = score_by_claim.get(claim_id, {})
        status = _safe_text(verdict.get("status"), limit=20).lower() or "insufficient"
        confidence = _safe_text(score.get("level") or verdict.get("confidence"), limit=16).lower() or "low"
        numeric_score = _as_int(score.get("score"), 0)
        priority = rank_map.get(importance, 1) * 100 + numeric_score
        cards.append(
            {
                "claim_id": claim_id,
                "text": text,
                "importance": importance,
                "status": status,
                "confidence": confidence,
                "score": numeric_score,
                "priority": priority,
            }
        )

    cards.sort(key=lambda item: int(item.get("priority") or 0), reverse=True)
    return cards[:limit]


def build_research_report_markdown(
    *,
    topic: str,
    final_answer: str,
    sources: list[dict[str, Any]],
    verification: dict[str, Any],
    kb_entry_id: str | None = None,
    canvas_group_id: str | None = None,
) -> str:
    safe_topic = _safe_text(topic, limit=260) or "Research Topic"
    verification_summary = _safe_text(verification.get("verification_summary"), limit=4000)
    claims = verification.get("claims") or []
    claim_verdicts = verification.get("claim_verdicts") or []
    confidence_scores = verification.get("confidence_scores") or []
    conflicts = verification.get("conflicts") or []
    citation_issues = verification.get("citation_issues") or []
    coverage = verification.get("citation_coverage") or {}

    cards = select_canvas_claim_cards(
        claims=claims if isinstance(claims, list) else [],
        claim_verdicts=claim_verdicts if isinstance(claim_verdicts, list) else [],
        confidence_scores=confidence_scores if isinstance(confidence_scores, list) else [],
        limit=8,
    )

    lines: list[str] = [
        f"# Deep Research Report · {safe_topic}",
        "",
        f"- Generated (UTC): {_to_iso_date()}",
        f"- Knowledge Entry ID: `{kb_entry_id or 'pending'}`",
        f"- Canvas Group ID: `{canvas_group_id or 'pending'}`",
        "",
        "## Executive Summary",
        "",
        (final_answer or "").strip() or "_No final answer generated._",
        "",
        "## Verification Snapshot",
        "",
        f"- Claims: {len(claims) if isinstance(claims, list) else 0}",
        f"- Evidence items: {len(verification.get('evidence_graph') or [])}",
        f"- Conflicts: {len(conflicts) if isinstance(conflicts, list) else 0}",
    ]

    coverage_ratio = _as_float(coverage.get("coverage_ratio"), -1.0)
    if coverage_ratio >= 0:
        lines.append(f"- Citation coverage: {coverage_ratio:.0%}")
    if verification_summary:
        lines.extend(["", "### Verification Summary", "", verification_summary])

    if cards:
        lines.extend(["", "## Top Claims", ""])
        for item in cards:
            lines.append(
                "- "
                f"[{item['claim_id']}] ({item['importance']}) "
                f"status={item['status']} confidence={item['confidence']} score={item['score']} "
                f"— {item['text']}"
            )

    if conflicts:
        lines.extend(["", "## Conflict Notes", ""])
        for conflict in conflicts[:10]:
            if not isinstance(conflict, dict):
                continue
            cid = _safe_text(conflict.get("conflict_id"), limit=24) or "CF?"
            claim_id = _safe_text(conflict.get("claim_id"), limit=24) or "C?"
            related = _safe_text(conflict.get("related_claim_id"), limit=24)
            reason = _safe_text(conflict.get("reason"), limit=240)
            if related:
                lines.append(f"- [{cid}] {claim_id} ↔ {related}: {reason}")
            else:
                lines.append(f"- [{cid}] {claim_id}: {reason}")

    if citation_issues:
        lines.extend(["", "## Citation Issues", ""])
        for issue in citation_issues[:20]:
            if not isinstance(issue, dict):
                continue
            severity = _safe_text(issue.get("severity"), limit=12).lower() or "warning"
            code = _safe_text(issue.get("code"), limit=48) or "citation_issue"
            claim_id = _safe_text(issue.get("claim_id"), limit=24)
            message = _safe_text(issue.get("message"), limit=220)
            if claim_id:
                lines.append(f"- [{severity}] {code} ({claim_id}): {message}")
            else:
                lines.append(f"- [{severity}] {code}: {message}")

    if sources:
        lines.extend(["", "## Sources", ""])
        for source in sources:
            if not isinstance(source, dict):
                continue
            sid = _safe_text(source.get("source_id"), limit=16) or "S?"
            title = _safe_text(source.get("title"), limit=180) or "Source"
            url = _safe_text(source.get("url"), limit=400)
            if url:
                lines.append(f"- [{sid}] [{title}]({url})")
            else:
                lines.append(f"- [{sid}] {title}")

    return "\n".join(lines).strip() + "\n"


def build_canvas_report_nodes(
    *,
    base_x: float,
    base_y: float,
    topic: str,
    kb_entry_id: str | None,
    verification: dict[str, Any],
    claim_cards: list[dict[str, Any]],
    source_preview: list[dict[str, Any]],
    node_id_factory: Callable[[], str],
) -> dict[str, Any]:
    title_node_id = node_id_factory()
    metrics_node_id = node_id_factory()
    sources_node_id = node_id_factory()
    claim_node_ids = [node_id_factory() for _ in claim_cards]
    all_child_ids = [title_node_id, metrics_node_id, sources_node_id, *claim_node_ids]
    group_node_id = node_id_factory()

    claims_total = len(verification.get("claims") or [])
    conflicts_total = len(verification.get("conflicts") or [])
    coverage = verification.get("citation_coverage") or {}
    coverage_ratio = _as_float(coverage.get("coverage_ratio"), -1.0)
    coverage_label = f"{coverage_ratio:.0%}" if coverage_ratio >= 0 else "n/a"

    title_content = (
        f"🧠 Deep Research Published\n"
        f"Topic: {_safe_text(topic, limit=120)}\n"
        f"KB Entry: {kb_entry_id or 'pending'}\n"
        f"Claims: {claims_total} · Conflicts: {conflicts_total} · Coverage: {coverage_label}"
    )
    metrics_content = (
        "Verification Metrics\n"
        f"- Evidence: {len(verification.get('evidence_graph') or [])}\n"
        f"- Citation issues: {len(verification.get('citation_issues') or [])}\n"
        f"- Citation coverage: {coverage_label}"
    )
    source_lines = ["Source Preview"]
    for src in source_preview[:4]:
        sid = _safe_text(src.get("source_id"), limit=16) or "S?"
        title = _safe_text(src.get("title"), limit=80) or "Source"
        source_lines.append(f"- {sid} {title}")
    sources_content = "\n".join(source_lines)

    nodes: list[dict[str, Any]] = [
        {
            "id": title_node_id,
            "type": "text",
            "x": base_x,
            "y": base_y,
            "width": 620,
            "height": 150,
            "content": title_content,
        },
        {
            "id": metrics_node_id,
            "type": "text",
            "x": base_x + 660,
            "y": base_y,
            "width": 360,
            "height": 120,
            "content": metrics_content,
        },
        {
            "id": sources_node_id,
            "type": "text",
            "x": base_x + 660,
            "y": base_y + 140,
            "width": 360,
            "height": 180,
            "content": sources_content,
        },
    ]

    claim_start_y = base_y + 180
    for index, claim in enumerate(claim_cards):
        nodes.append(
            {
                "id": claim_node_ids[index],
                "type": "text",
                "x": base_x,
                "y": claim_start_y + index * 130,
                "width": 620,
                "height": 110,
                "content": (
                    f"[{claim.get('claim_id')}] ({claim.get('importance')}) "
                    f"status={claim.get('status')} confidence={claim.get('confidence')} "
                    f"score={claim.get('score')}\n"
                    f"{_safe_text(claim.get('text'), limit=180)}"
                ),
            }
        )

    group_height = max(360, 260 + len(claim_cards) * 130)
    group_node = {
        "id": group_node_id,
        "type": "group",
        "x": base_x - 40,
        "y": base_y - 40,
        "width": 1080,
        "height": group_height,
        "content": f"Deep Research · {_safe_text(topic, limit=100)}",
        "children": all_child_ids,
    }
    nodes.append(group_node)

    return {
        "nodes": nodes,
        "group_node_id": group_node_id,
        "child_node_ids": all_child_ids,
    }
