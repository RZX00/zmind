from __future__ import annotations

import re
from itertools import combinations
from typing import Any


CLAIM_TYPES = {"fact", "trend", "opinion", "forecast", "definition", "comparison"}
CLAIM_IMPORTANCE = {"high", "medium", "low"}
EVIDENCE_VERDICTS = {"support", "contradict", "neutral", "insufficient"}
CLAIM_STATUSES = {"supported", "contradicted", "mixed", "insufficient"}
CONFIDENCE_LEVELS = {"high", "medium", "low"}
NEGATION_TOKENS = {"no", "not", "never", "none", "without", "cannot", "can't", "isnt", "isn't", "wont", "won't"}
STOPWORDS = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "for",
    "with",
    "by",
    "is",
    "are",
    "was",
    "were",
    "be",
    "that",
    "this",
    "it",
    "as",
    "at",
    "from",
    "into",
    "about",
    "than",
}


def _normalize_text(value: Any, *, limit: int = 320) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    return text[:limit].strip()


def _claim_key(text: str) -> str:
    return " ".join(text.lower().split())


def _normalize_claim_type(value: Any) -> str:
    normalized = _normalize_text(value, limit=32).lower()
    if normalized in CLAIM_TYPES:
        return normalized
    return "fact"


def _normalize_importance(value: Any) -> str:
    normalized = _normalize_text(value, limit=16).lower()
    if normalized in CLAIM_IMPORTANCE:
        return normalized
    return "medium"


def _tokenize_claim_text(text: str) -> set[str]:
    lowered = text.lower()
    raw_tokens = re.findall(r"[a-z0-9%]+", lowered)
    return {token for token in raw_tokens if len(token) >= 2 and token not in STOPWORDS}


def _has_negation(text: str) -> bool:
    tokens = _tokenize_claim_text(text)
    return any(token in NEGATION_TOKENS for token in tokens)


def _extract_numbers(text: str) -> list[float]:
    values: list[float] = []
    for match in re.findall(r"-?\d+(?:\.\d+)?", text):
        try:
            values.append(float(match))
        except Exception:
            continue
    return values


def _jaccard_similarity(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def normalize_claim_candidates(raw_claims: Any, *, max_claims: int) -> list[dict[str, Any]]:
    if max_claims <= 0:
        return []
    if not isinstance(raw_claims, list):
        return []

    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw_claims:
        if isinstance(item, dict):
            text = _normalize_text(item.get("text") or item.get("claim"), limit=260)
            claim_type = _normalize_claim_type(item.get("claim_type") or item.get("type"))
            importance = _normalize_importance(item.get("importance"))
        elif isinstance(item, str):
            text = _normalize_text(item, limit=260)
            claim_type = "fact"
            importance = "medium"
        else:
            continue

        if not text:
            continue
        key = _claim_key(text)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(
            {
                "claim_id": "",
                "text": text,
                "claim_type": claim_type,
                "importance": importance,
            }
        )
        if len(normalized) >= max_claims:
            break
    return normalized


def merge_claims(
    existing_claims: list[dict[str, Any]],
    new_claim_candidates: list[dict[str, Any]],
    *,
    max_claims: int,
) -> list[dict[str, Any]]:
    if max_claims <= 0:
        return []

    merged: list[dict[str, Any]] = []
    seen: set[str] = set()

    for item in existing_claims + new_claim_candidates:
        if not isinstance(item, dict):
            continue
        text = _normalize_text(item.get("text") or item.get("claim"), limit=260)
        if not text:
            continue
        key = _claim_key(text)
        if key in seen:
            continue
        seen.add(key)
        merged.append(
            {
                "claim_id": "",
                "text": text,
                "claim_type": _normalize_claim_type(item.get("claim_type") or item.get("type")),
                "importance": _normalize_importance(item.get("importance")),
            }
        )
        if len(merged) >= max_claims:
            break

    for index, claim in enumerate(merged, start=1):
        claim["claim_id"] = f"C{index}"
    return merged


def _derive_claim_status(evidence_items: list[dict[str, Any]]) -> str:
    support_count = sum(1 for item in evidence_items if item.get("verdict") == "support")
    contradict_count = sum(1 for item in evidence_items if item.get("verdict") == "contradict")
    if support_count > 0 and contradict_count > 0:
        return "mixed"
    if contradict_count > 0:
        return "contradicted"
    if support_count > 0:
        return "supported"
    return "insufficient"


def _derive_confidence_level(status: str, evidence_items: list[dict[str, Any]]) -> str:
    total = len(evidence_items)
    if status in {"supported", "contradicted"} and total >= 2:
        return "high"
    if status == "mixed":
        return "medium"
    if total >= 1:
        return "medium"
    return "low"


def normalize_verification_payload(
    payload: dict[str, Any] | None,
    *,
    claims: list[dict[str, Any]],
    sources: list[dict[str, Any]],
    max_evidence_per_claim: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    claims_by_id = {
        str(item.get("claim_id")): item
        for item in claims
        if isinstance(item, dict) and item.get("claim_id")
    }
    claim_order = [claim_id for claim_id in claims_by_id]

    source_by_id = {
        str(item.get("source_id")): item
        for item in sources
        if isinstance(item, dict) and item.get("source_id")
    }
    source_by_url = {
        str(item.get("url")): item
        for item in sources
        if isinstance(item, dict) and item.get("url")
    }

    raw_evidence = payload.get("evidence") if isinstance(payload, dict) else []
    evidence: list[dict[str, Any]] = []
    per_claim_count: dict[str, int] = {}

    if isinstance(raw_evidence, list):
        for item in raw_evidence:
            if not isinstance(item, dict):
                continue
            claim_id = _normalize_text(item.get("claim_id"), limit=24)
            if claim_id not in claims_by_id:
                continue
            if max_evidence_per_claim > 0 and per_claim_count.get(claim_id, 0) >= max_evidence_per_claim:
                continue

            source_id = _normalize_text(item.get("source_id"), limit=24)
            url = _normalize_text(item.get("url"), limit=300)
            if not source_id and url and url in source_by_url:
                source_id = _normalize_text(source_by_url[url].get("source_id"), limit=24)
            if source_id and not url and source_id in source_by_id:
                url = _normalize_text(source_by_id[source_id].get("url"), limit=300)
            if source_id and source_id not in source_by_id and not url:
                continue
            if not source_id and not url:
                continue

            snippet = _normalize_text(item.get("snippet") or item.get("quote"), limit=420)
            if not snippet and source_id in source_by_id:
                snippet = _normalize_text(source_by_id[source_id].get("snippet"), limit=420)

            verdict = _normalize_text(item.get("verdict"), limit=24).lower()
            if verdict not in EVIDENCE_VERDICTS:
                verdict = "neutral"

            evidence.append(
                {
                    "evidence_id": "",
                    "claim_id": claim_id,
                    "source_id": source_id,
                    "url": url,
                    "snippet": snippet,
                    "verdict": verdict,
                    "rationale": _normalize_text(item.get("rationale"), limit=220),
                }
            )
            per_claim_count[claim_id] = per_claim_count.get(claim_id, 0) + 1

    for index, item in enumerate(evidence, start=1):
        item["evidence_id"] = f"E{index}"

    evidence_by_claim: dict[str, list[dict[str, Any]]] = {claim_id: [] for claim_id in claim_order}
    for item in evidence:
        claim_id = str(item.get("claim_id"))
        if claim_id in evidence_by_claim:
            evidence_by_claim[claim_id].append(item)

    verdict_map: dict[str, dict[str, Any]] = {}
    raw_verdicts = payload.get("claim_verdicts") if isinstance(payload, dict) else []
    if isinstance(raw_verdicts, list):
        for item in raw_verdicts:
            if not isinstance(item, dict):
                continue
            claim_id = _normalize_text(item.get("claim_id"), limit=24)
            if claim_id not in claims_by_id:
                continue
            status = _normalize_text(item.get("status"), limit=24).lower()
            if status not in CLAIM_STATUSES:
                status = _derive_claim_status(evidence_by_claim.get(claim_id, []))
            confidence = _normalize_text(item.get("confidence"), limit=16).lower()
            if confidence not in CONFIDENCE_LEVELS:
                confidence = _derive_confidence_level(status, evidence_by_claim.get(claim_id, []))
            verdict_map[claim_id] = {
                "claim_id": claim_id,
                "status": status,
                "confidence": confidence,
                "notes": _normalize_text(item.get("notes"), limit=220),
            }

    for claim_id in claim_order:
        if claim_id in verdict_map:
            continue
        derived_status = _derive_claim_status(evidence_by_claim.get(claim_id, []))
        verdict_map[claim_id] = {
            "claim_id": claim_id,
            "status": derived_status,
            "confidence": _derive_confidence_level(derived_status, evidence_by_claim.get(claim_id, [])),
            "notes": "",
        }

    ordered_verdicts = [verdict_map[claim_id] for claim_id in claim_order if claim_id in verdict_map]
    return evidence, ordered_verdicts


def detect_conflicts(
    claim_verdicts: list[dict[str, Any]],
    evidence_graph: list[dict[str, Any]],
    claims: list[dict[str, Any]] | None = None,
    *,
    enable_cross_claim: bool = True,
) -> list[dict[str, Any]]:
    claims = claims or []
    claim_text_by_id = {
        str(item.get("claim_id")): _normalize_text(item.get("text") or item.get("claim"), limit=260)
        for item in claims
        if isinstance(item, dict) and item.get("claim_id")
    }
    verdict_by_claim = {
        str(item.get("claim_id")): item
        for item in claim_verdicts
        if isinstance(item, dict) and item.get("claim_id")
    }
    evidence_by_claim: dict[str, list[dict[str, Any]]] = {}
    for item in evidence_graph:
        if not isinstance(item, dict):
            continue
        claim_id = _normalize_text(item.get("claim_id"), limit=24)
        if not claim_id:
            continue
        evidence_by_claim.setdefault(claim_id, []).append(item)

    conflicts: list[dict[str, Any]] = []
    for verdict in claim_verdicts:
        if not isinstance(verdict, dict):
            continue
        claim_id = _normalize_text(verdict.get("claim_id"), limit=24)
        if not claim_id:
            continue
        claim_evidence = evidence_by_claim.get(claim_id, [])
        support_count = sum(1 for item in claim_evidence if item.get("verdict") == "support")
        contradict_count = sum(1 for item in claim_evidence if item.get("verdict") == "contradict")
        status = _normalize_text(verdict.get("status"), limit=24).lower()

        if support_count > 0 and contradict_count > 0:
            conflicts.append(
                {
                    "conflict_id": "",
                    "claim_id": claim_id,
                    "type": "evidence_polarity",
                    "reason": "Both supporting and contradicting evidence exist.",
                    "support_count": support_count,
                    "contradict_count": contradict_count,
                }
            )
            continue

        if status == "mixed":
            conflicts.append(
                {
                    "conflict_id": "",
                    "claim_id": claim_id,
                    "type": "mixed_verdict",
                    "reason": "Claim verification outcome is mixed.",
                    "support_count": support_count,
                    "contradict_count": contradict_count,
                }
            )

    if enable_cross_claim and len(claim_text_by_id) >= 2:
        for claim_a, claim_b in combinations(sorted(claim_text_by_id.keys()), 2):
            text_a = claim_text_by_id.get(claim_a, "")
            text_b = claim_text_by_id.get(claim_b, "")
            if not text_a or not text_b:
                continue
            tokens_a = _tokenize_claim_text(text_a)
            tokens_b = _tokenize_claim_text(text_b)
            similarity = _jaccard_similarity(tokens_a, tokens_b)
            if similarity < 0.42:
                continue

            status_a = _normalize_text(verdict_by_claim.get(claim_a, {}).get("status"), limit=24).lower()
            status_b = _normalize_text(verdict_by_claim.get(claim_b, {}).get("status"), limit=24).lower()
            strong_disagreement = {status_a, status_b} == {"supported", "contradicted"}
            negation_conflict = _has_negation(text_a) ^ _has_negation(text_b)

            numeric_conflict = False
            numbers_a = _extract_numbers(text_a)
            numbers_b = _extract_numbers(text_b)
            if numbers_a and numbers_b:
                primary_a = numbers_a[0]
                primary_b = numbers_b[0]
                baseline = max(abs(primary_a), abs(primary_b), 1.0)
                numeric_conflict = abs(primary_a - primary_b) / baseline >= 0.25

            if not (strong_disagreement or negation_conflict or numeric_conflict):
                continue

            reason_parts: list[str] = []
            if strong_disagreement:
                reason_parts.append("verification status disagreement")
            if negation_conflict:
                reason_parts.append("negation polarity mismatch")
            if numeric_conflict:
                reason_parts.append("numeric mismatch")
            conflict_reason = ", ".join(reason_parts) or "cross-claim inconsistency"
            conflicts.append(
                {
                    "conflict_id": "",
                    "claim_id": claim_a,
                    "related_claim_id": claim_b,
                    "type": "cross_claim_inconsistency",
                    "reason": conflict_reason,
                    "similarity": round(similarity, 3),
                    "status_pair": [status_a or "unknown", status_b or "unknown"],
                }
            )

    for index, conflict in enumerate(conflicts, start=1):
        conflict["conflict_id"] = f"CF{index}"
    return conflicts


def score_claim_confidence(
    claims: list[dict[str, Any]],
    claim_verdicts: list[dict[str, Any]],
    evidence_graph: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    verdict_by_claim = {
        str(item.get("claim_id")): item
        for item in claim_verdicts
        if isinstance(item, dict) and item.get("claim_id")
    }
    conflict_claims = {
        str(item.get("claim_id"))
        for item in conflicts
        if isinstance(item, dict) and item.get("claim_id")
    }
    evidence_by_claim: dict[str, list[dict[str, Any]]] = {}
    for item in evidence_graph:
        if not isinstance(item, dict):
            continue
        claim_id = str(item.get("claim_id") or "")
        if not claim_id:
            continue
        evidence_by_claim.setdefault(claim_id, []).append(item)

    scores: list[dict[str, Any]] = []
    for claim in claims:
        if not isinstance(claim, dict):
            continue
        claim_id = str(claim.get("claim_id") or "")
        if not claim_id:
            continue
        status = str(verdict_by_claim.get(claim_id, {}).get("status") or "insufficient")
        claim_evidence = evidence_by_claim.get(claim_id, [])
        support_count = sum(1 for item in claim_evidence if item.get("verdict") == "support")
        contradict_count = sum(1 for item in claim_evidence if item.get("verdict") == "contradict")
        neutral_count = sum(1 for item in claim_evidence if item.get("verdict") in {"neutral", "insufficient"})

        score = 35 + support_count * 22 - contradict_count * 25 + min(15, neutral_count * 4)
        if status == "mixed":
            score -= 12
        if claim_id in conflict_claims:
            score -= 20
        score = max(5, min(95, score))

        if score >= 75:
            level = "high"
        elif score >= 45:
            level = "medium"
        else:
            level = "low"

        scores.append(
            {
                "claim_id": claim_id,
                "score": score,
                "level": level,
                "status": status,
                "rationale": (
                    f"support={support_count}, contradict={contradict_count}, neutral={neutral_count}, "
                    f"conflict={'yes' if claim_id in conflict_claims else 'no'}"
                ),
            }
        )
    return scores


def _importance_weight(importance: str) -> int:
    mapping = {"high": 30, "medium": 16, "low": 8}
    return mapping.get(importance, 16)


def _status_risk(status: str) -> int:
    mapping = {"contradicted": 28, "mixed": 24, "insufficient": 22, "supported": 8}
    return mapping.get(status, 20)


def _confidence_risk(level: str) -> int:
    mapping = {"low": 20, "medium": 10, "high": 2}
    return mapping.get(level, 12)


def compute_citation_coverage(
    claims: list[dict[str, Any]],
    evidence_graph: list[dict[str, Any]],
) -> dict[str, Any]:
    claim_ids = [
        str(claim.get("claim_id"))
        for claim in claims
        if isinstance(claim, dict) and claim.get("claim_id")
    ]
    evidence_count_by_claim: dict[str, int] = {claim_id: 0 for claim_id in claim_ids}
    source_count_by_claim: dict[str, int] = {claim_id: 0 for claim_id in claim_ids}
    source_set_by_claim: dict[str, set[str]] = {claim_id: set() for claim_id in claim_ids}

    for item in evidence_graph:
        if not isinstance(item, dict):
            continue
        claim_id = str(item.get("claim_id") or "")
        if claim_id not in evidence_count_by_claim:
            continue
        evidence_count_by_claim[claim_id] += 1
        source_key = str(item.get("source_id") or item.get("url") or "")
        if source_key:
            source_set_by_claim[claim_id].add(source_key)

    for claim_id, sources in source_set_by_claim.items():
        source_count_by_claim[claim_id] = len(sources)

    covered_claims = sum(1 for claim_id in claim_ids if evidence_count_by_claim.get(claim_id, 0) > 0)
    total_claims = len(claim_ids)
    coverage_ratio = (covered_claims / total_claims) if total_claims > 0 else 1.0

    return {
        "total_claims": total_claims,
        "covered_claims": covered_claims,
        "coverage_ratio": round(coverage_ratio, 3),
        "evidence_count_by_claim": evidence_count_by_claim,
        "source_count_by_claim": source_count_by_claim,
    }


def validate_citation_consistency(
    claims: list[dict[str, Any]],
    evidence_graph: list[dict[str, Any]],
    sources: list[dict[str, Any]],
    confidence_scores: list[dict[str, Any]],
    *,
    min_evidence_for_high_importance: int,
) -> list[dict[str, Any]]:
    source_by_id = {
        str(source.get("source_id")): source
        for source in sources
        if isinstance(source, dict) and source.get("source_id")
    }
    source_by_url = {
        str(source.get("url")): source
        for source in sources
        if isinstance(source, dict) and source.get("url")
    }
    claim_by_id = {
        str(claim.get("claim_id")): claim
        for claim in claims
        if isinstance(claim, dict) and claim.get("claim_id")
    }
    confidence_by_claim = {
        str(score.get("claim_id")): score
        for score in confidence_scores
        if isinstance(score, dict) and score.get("claim_id")
    }

    evidence_count_by_claim: dict[str, int] = {claim_id: 0 for claim_id in claim_by_id}
    issues: list[dict[str, Any]] = []

    for evidence in evidence_graph:
        if not isinstance(evidence, dict):
            continue
        claim_id = str(evidence.get("claim_id") or "")
        evidence_id = str(evidence.get("evidence_id") or "")
        if claim_id not in claim_by_id:
            issues.append(
                {
                    "severity": "error",
                    "code": "orphan_evidence_claim",
                    "claim_id": claim_id,
                    "evidence_id": evidence_id,
                    "message": "Evidence references an unknown claim.",
                }
            )
            continue
        evidence_count_by_claim[claim_id] = evidence_count_by_claim.get(claim_id, 0) + 1

        source_id = str(evidence.get("source_id") or "")
        url = str(evidence.get("url") or "")
        has_source = (source_id and source_id in source_by_id) or (url and url in source_by_url)
        if not has_source:
            issues.append(
                {
                    "severity": "error",
                    "code": "orphan_evidence_source",
                    "claim_id": claim_id,
                    "evidence_id": evidence_id,
                    "message": "Evidence does not map to an existing source.",
                }
            )

        snippet = _normalize_text(evidence.get("snippet"), limit=420)
        if len(snippet) < 12:
            issues.append(
                {
                    "severity": "warning",
                    "code": "weak_evidence_snippet",
                    "claim_id": claim_id,
                    "evidence_id": evidence_id,
                    "message": "Evidence snippet is too short for reliable attribution.",
                }
            )

    for claim_id, claim in claim_by_id.items():
        importance = _normalize_importance(claim.get("importance"))
        evidence_count = evidence_count_by_claim.get(claim_id, 0)
        claim_text = _normalize_text(claim.get("text") or claim.get("claim"), limit=160)
        if importance == "high" and evidence_count < max(1, min_evidence_for_high_importance):
            issues.append(
                {
                    "severity": "error",
                    "code": "high_importance_under_cited",
                    "claim_id": claim_id,
                    "claim_text": claim_text,
                    "message": "High-importance claim lacks enough evidence citations.",
                }
            )
        elif importance == "medium" and evidence_count == 0:
            issues.append(
                {
                    "severity": "warning",
                    "code": "claim_without_evidence",
                    "claim_id": claim_id,
                    "claim_text": claim_text,
                    "message": "Claim has no linked evidence.",
                }
            )

        confidence_level = _normalize_text(confidence_by_claim.get(claim_id, {}).get("level"), limit=16).lower()
        if importance == "high" and confidence_level in {"", "low"}:
            issues.append(
                {
                    "severity": "warning",
                    "code": "high_importance_low_confidence",
                    "claim_id": claim_id,
                    "claim_text": claim_text,
                    "message": "High-importance claim remains low-confidence.",
                }
            )

    deduped_issues: list[dict[str, Any]] = []
    seen: set[str] = set()
    for issue in issues:
        key = "|".join(
            [
                str(issue.get("code") or ""),
                str(issue.get("claim_id") or ""),
                str(issue.get("evidence_id") or ""),
                str(issue.get("message") or ""),
            ]
        )
        if key in seen:
            continue
        seen.add(key)
        deduped_issues.append(issue)
    return deduped_issues


def prioritize_claims_for_follow_up(
    claims: list[dict[str, Any]],
    claim_verdicts: list[dict[str, Any]],
    confidence_scores: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
    citation_issues: list[dict[str, Any]] | None = None,
    *,
    max_items: int,
) -> list[dict[str, Any]]:
    if max_items <= 0:
        return []

    claim_by_id = {
        str(claim.get("claim_id")): claim
        for claim in claims
        if isinstance(claim, dict) and claim.get("claim_id")
    }
    verdict_by_claim = {
        str(item.get("claim_id")): item
        for item in claim_verdicts
        if isinstance(item, dict) and item.get("claim_id")
    }
    confidence_by_claim = {
        str(item.get("claim_id")): item
        for item in confidence_scores
        if isinstance(item, dict) and item.get("claim_id")
    }
    conflict_claims = {
        str(item.get("claim_id"))
        for item in conflicts
        if isinstance(item, dict) and item.get("claim_id")
    }
    citation_issue_claims = {
        str(item.get("claim_id"))
        for item in (citation_issues or [])
        if isinstance(item, dict)
        and item.get("claim_id")
        and str(item.get("severity") or "").lower() in {"error", "warning"}
    }

    candidates: list[dict[str, Any]] = []
    for claim_id, claim in claim_by_id.items():
        importance = _normalize_importance(claim.get("importance"))
        status = _normalize_text(verdict_by_claim.get(claim_id, {}).get("status"), limit=24).lower() or "insufficient"
        confidence_level = (
            _normalize_text(confidence_by_claim.get(claim_id, {}).get("level"), limit=16).lower()
            or _normalize_text(verdict_by_claim.get(claim_id, {}).get("confidence"), limit=16).lower()
            or "low"
        )
        score = _importance_weight(importance) + _status_risk(status) + _confidence_risk(confidence_level)
        reasons: list[str] = []
        if status in {"insufficient", "mixed", "contradicted"}:
            reasons.append(f"status={status}")
        if confidence_level in {"low", "medium"}:
            reasons.append(f"confidence={confidence_level}")
        if claim_id in conflict_claims:
            score += 18
            reasons.append("has_conflict")
        if claim_id in citation_issue_claims:
            score += 14
            reasons.append("citation_issue")

        if score < 48:
            continue

        candidates.append(
            {
                "claim_id": claim_id,
                "text": _normalize_text(claim.get("text") or claim.get("claim"), limit=220),
                "importance": importance,
                "priority_score": score,
                "reason": ", ".join(reasons) if reasons else "verification_gap",
            }
        )

    candidates.sort(key=lambda item: int(item.get("priority_score") or 0), reverse=True)
    return candidates[:max_items]


def build_verification_summary(
    claims: list[dict[str, Any]],
    claim_verdicts: list[dict[str, Any]],
    evidence_graph: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
    confidence_scores: list[dict[str, Any]],
    citation_issues: list[dict[str, Any]] | None = None,
    citation_coverage: dict[str, Any] | None = None,
) -> str:
    verdict_by_claim = {
        str(item.get("claim_id")): item
        for item in claim_verdicts
        if isinstance(item, dict) and item.get("claim_id")
    }
    confidence_by_claim = {
        str(item.get("claim_id")): item
        for item in confidence_scores
        if isinstance(item, dict) and item.get("claim_id")
    }
    evidence_count_by_claim: dict[str, int] = {}
    for item in evidence_graph:
        if not isinstance(item, dict):
            continue
        claim_id = str(item.get("claim_id") or "")
        if claim_id:
            evidence_count_by_claim[claim_id] = evidence_count_by_claim.get(claim_id, 0) + 1

    lines = [
        f"Claims: {len(claims)}",
        f"Evidence items: {len(evidence_graph)}",
        f"Conflicts: {len(conflicts)}",
    ]
    if citation_coverage:
        coverage_ratio = citation_coverage.get("coverage_ratio")
        if isinstance(coverage_ratio, (int, float)):
            lines.append(f"Citation coverage: {coverage_ratio:.0%}")
    if citation_issues:
        lines.append(f"Citation issues: {len(citation_issues)}")

    if not claims:
        lines.append("- No explicit claims extracted yet.")
        return "\n".join(lines)

    for claim in claims:
        if not isinstance(claim, dict):
            continue
        claim_id = str(claim.get("claim_id") or "")
        claim_text = _normalize_text(claim.get("text") or claim.get("claim"), limit=120)
        verdict = verdict_by_claim.get(claim_id, {})
        confidence = confidence_by_claim.get(claim_id, {})
        status = str(verdict.get("status") or "insufficient")
        level = str(confidence.get("level") or verdict.get("confidence") or "low")
        evidence_count = evidence_count_by_claim.get(claim_id, 0)
        lines.append(
            f"- {claim_id}: {claim_text} | status={status} | confidence={level} | evidence={evidence_count}"
        )
    if citation_issues:
        for issue in citation_issues[:4]:
            severity = _normalize_text(issue.get("severity"), limit=12).lower() or "warning"
            code = _normalize_text(issue.get("code"), limit=42) or "citation_issue"
            claim_id = _normalize_text(issue.get("claim_id"), limit=24)
            message = _normalize_text(issue.get("message"), limit=140)
            if claim_id:
                lines.append(f"- [{severity}] {code} ({claim_id}): {message}")
            else:
                lines.append(f"- [{severity}] {code}: {message}")
    return "\n".join(lines)
