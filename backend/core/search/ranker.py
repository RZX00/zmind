from __future__ import annotations

from datetime import datetime, timezone
import math
import re


TOKEN_PATTERN = re.compile(r"[A-Za-z0-9\u4e00-\u9fff]+")


def now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def tokenize(text: str) -> list[str]:
    if not text:
        return []
    return [token.lower() for token in TOKEN_PATTERN.findall(text)]


def token_overlap_score(query: str, text: str) -> float:
    query_tokens = tokenize(query)
    text_tokens = set(tokenize(text))
    if not query_tokens or not text_tokens:
        return 0.0
    matched = sum(1 for token in query_tokens if token in text_tokens)
    return min(1.0, matched / max(1, len(query_tokens)))


def recency_score(updated_at_ms: int | None, *, now_ts: int | None = None, half_life_days: float = 14.0) -> float:
    if not updated_at_ms:
        return 0.0
    now_val = now_ts or now_ms()
    age_ms = max(0, now_val - int(updated_at_ms))
    age_days = age_ms / (1000 * 60 * 60 * 24)
    decay = math.pow(0.5, age_days / max(0.1, half_life_days))
    return max(0.0, min(1.0, decay))


def graph_affinity_score(
    item_id: str | None,
    *,
    inbound_count_by_item: dict[str, int],
    outbound_count_by_item: dict[str, int],
    max_degree: int,
) -> float:
    if not item_id or max_degree <= 0:
        return 0.0
    degree = int(inbound_count_by_item.get(item_id, 0)) + int(outbound_count_by_item.get(item_id, 0))
    return max(0.0, min(1.0, degree / max(1, max_degree)))


def compose_score(
    *,
    lexical_score: float,
    recency_score_value: float,
    graph_affinity_score_value: float,
    interaction_score: float = 0.0,
) -> float:
    # Phase 4 baseline weights.
    final = (
        0.50 * lexical_score
        + 0.20 * recency_score_value
        + 0.20 * graph_affinity_score_value
        + 0.10 * interaction_score
    )
    return max(0.0, min(1.0, final))

