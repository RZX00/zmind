from __future__ import annotations

from typing import Any


def build_link_suggestions(
    *,
    candidates: list[dict[str, Any]],
    context_item_id: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    suggestions: list[dict[str, Any]] = []
    seen_item_ids: set[str] = set()

    for candidate in candidates:
        result_type = candidate.get("resultType")
        target_item_id = candidate.get("itemId") or candidate.get("targetItemId")
        if not target_item_id:
            continue
        if context_item_id and target_item_id == context_item_id:
            continue
        if target_item_id in seen_item_ids:
            continue
        if result_type not in {"doc", "canvas_node", "reference"}:
            continue

        lexical_score = float(candidate.get("debug", {}).get("lexicalScore", 0.0))
        graph_score = float(candidate.get("debug", {}).get("graphScore", 0.0))
        final_score = float(candidate.get("debug", {}).get("finalScore", candidate.get("score", 0.0)))

        if lexical_score >= 0.75:
            reason = "High textual overlap with current context."
        elif graph_score >= 0.5:
            reason = "Strong graph proximity based on existing references."
        else:
            reason = "Relevant workspace context based on mixed ranking signals."

        confidence = max(0.05, min(0.99, round(final_score, 3)))
        evidence_text = candidate.get("snippet") or candidate.get("title") or ""

        suggestions.append(
            {
                "targetType": "canvas" if result_type == "canvas_node" else result_type,
                "targetItemId": target_item_id,
                "targetCanvasId": candidate.get("canvasId") or candidate.get("targetCanvasId"),
                "targetAnchor": candidate.get("nodeId") or candidate.get("targetAnchor"),
                "confidence": confidence,
                "reason": reason,
                "evidence": [evidence_text] if evidence_text else [],
            }
        )
        seen_item_ids.add(target_item_id)
        if len(suggestions) >= limit:
            break

    return suggestions

