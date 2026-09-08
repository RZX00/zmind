import importlib.util
from pathlib import Path


def _load_verification_module():
    backend_root = Path(__file__).resolve().parents[1]
    verification_path = backend_root / "core" / "langgraph_engine" / "research_graph" / "verification.py"
    spec = importlib.util.spec_from_file_location("research_graph_verification_phase2", verification_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def test_normalize_claim_candidates_and_merge_claims():
    module = _load_verification_module()
    raw_claims = [
        {"text": "Model A beats Model B on benchmark X.", "claim_type": "fact", "importance": "high"},
        {"claim": "Model A beats Model B on benchmark X.", "type": "fact", "importance": "high"},
        {"text": "Latency dropped by 30% in 2025.", "claim_type": "trend", "importance": "medium"},
    ]
    candidates = module.normalize_claim_candidates(raw_claims, max_claims=5)
    assert len(candidates) == 2

    existing = [{"claim_id": "C1", "text": "Baseline claim", "claim_type": "fact", "importance": "low"}]
    merged = module.merge_claims(existing, candidates, max_claims=3)
    assert [claim["claim_id"] for claim in merged] == ["C1", "C2", "C3"]
    assert merged[0]["text"] == "Baseline claim"


def test_normalize_verification_payload_derives_missing_verdicts():
    module = _load_verification_module()
    claims = [
        {"claim_id": "C1", "text": "Claim one", "claim_type": "fact", "importance": "high"},
        {"claim_id": "C2", "text": "Claim two", "claim_type": "fact", "importance": "medium"},
    ]
    sources = [
        {"source_id": "S1", "title": "Source 1", "url": "https://a.example", "snippet": "Snippet A"},
        {"source_id": "S2", "title": "Source 2", "url": "https://b.example", "snippet": "Snippet B"},
    ]
    payload = {
        "evidence": [
            {"claim_id": "C1", "source_id": "S1", "snippet": "Supports C1", "verdict": "support"},
            {"claim_id": "C1", "source_id": "S2", "snippet": "Contradicts C1", "verdict": "contradict"},
            {"claim_id": "C2", "source_id": "S2", "snippet": "Neutral C2", "verdict": "neutral"},
        ],
        "claim_verdicts": [],
    }

    evidence_graph, claim_verdicts = module.normalize_verification_payload(
        payload,
        claims=claims,
        sources=sources,
        max_evidence_per_claim=3,
    )
    assert len(evidence_graph) == 3
    verdict_map = {item["claim_id"]: item for item in claim_verdicts}
    assert verdict_map["C1"]["status"] == "mixed"
    assert verdict_map["C2"]["status"] == "insufficient"


def test_detect_conflicts_and_score_confidence():
    module = _load_verification_module()
    claims = [
        {"claim_id": "C1", "text": "Claim one", "claim_type": "fact", "importance": "high"},
        {"claim_id": "C2", "text": "Claim two", "claim_type": "fact", "importance": "medium"},
    ]
    claim_verdicts = [
        {"claim_id": "C1", "status": "mixed", "confidence": "medium", "notes": ""},
        {"claim_id": "C2", "status": "supported", "confidence": "high", "notes": ""},
    ]
    evidence_graph = [
        {"evidence_id": "E1", "claim_id": "C1", "source_id": "S1", "verdict": "support", "url": "", "snippet": ""},
        {"evidence_id": "E2", "claim_id": "C1", "source_id": "S2", "verdict": "contradict", "url": "", "snippet": ""},
        {"evidence_id": "E3", "claim_id": "C2", "source_id": "S3", "verdict": "support", "url": "", "snippet": ""},
    ]

    conflicts = module.detect_conflicts(claim_verdicts, evidence_graph)
    assert len(conflicts) == 1
    assert conflicts[0]["claim_id"] == "C1"

    scores = module.score_claim_confidence(claims, claim_verdicts, evidence_graph, conflicts)
    score_map = {item["claim_id"]: item for item in scores}
    assert score_map["C1"]["level"] in {"low", "medium"}
    assert score_map["C2"]["level"] in {"medium", "high"}

    summary = module.build_verification_summary(claims, claim_verdicts, evidence_graph, conflicts, scores)
    assert "Claims: 2" in summary
    assert "Conflicts: 1" in summary


def test_cross_claim_conflict_citation_guard_and_priority_scheduler():
    module = _load_verification_module()
    claims = [
        {
            "claim_id": "C1",
            "text": "Model A latency is 20 ms in production benchmarks.",
            "claim_type": "fact",
            "importance": "high",
        },
        {
            "claim_id": "C2",
            "text": "Model A latency is 50 ms in production benchmarks.",
            "claim_type": "fact",
            "importance": "high",
        },
        {
            "claim_id": "C3",
            "text": "Adoption is increasing in enterprise teams.",
            "claim_type": "trend",
            "importance": "medium",
        },
    ]
    claim_verdicts = [
        {"claim_id": "C1", "status": "supported", "confidence": "medium", "notes": ""},
        {"claim_id": "C2", "status": "supported", "confidence": "low", "notes": ""},
        {"claim_id": "C3", "status": "insufficient", "confidence": "low", "notes": ""},
    ]
    evidence_graph = [
        {
            "evidence_id": "E1",
            "claim_id": "C1",
            "source_id": "S1",
            "verdict": "support",
            "url": "https://a.example",
            "snippet": "Benchmark report says 20 ms median latency.",
        },
        {
            "evidence_id": "E2",
            "claim_id": "C2",
            "source_id": "S2",
            "verdict": "support",
            "url": "https://b.example",
            "snippet": "Independent report says 50 ms median latency.",
        },
        {
            "evidence_id": "E3",
            "claim_id": "C3",
            "source_id": "S9",
            "verdict": "neutral",
            "url": "",
            "snippet": "short",
        },
    ]
    sources = [
        {"source_id": "S1", "title": "Source 1", "url": "https://a.example", "snippet": "S1"},
        {"source_id": "S2", "title": "Source 2", "url": "https://b.example", "snippet": "S2"},
    ]

    conflicts = module.detect_conflicts(
        claim_verdicts,
        evidence_graph,
        claims=claims,
        enable_cross_claim=True,
    )
    assert any(item.get("type") == "cross_claim_inconsistency" for item in conflicts)

    scores = module.score_claim_confidence(claims, claim_verdicts, evidence_graph, conflicts)
    citation_issues = module.validate_citation_consistency(
        claims,
        evidence_graph,
        sources,
        scores,
        min_evidence_for_high_importance=2,
    )
    assert any(issue.get("code") == "high_importance_under_cited" for issue in citation_issues)
    assert any(issue.get("code") == "orphan_evidence_source" for issue in citation_issues)

    coverage = module.compute_citation_coverage(claims, evidence_graph)
    assert coverage["total_claims"] == 3
    assert coverage["covered_claims"] >= 2

    prioritized = module.prioritize_claims_for_follow_up(
        claims=claims,
        claim_verdicts=claim_verdicts,
        confidence_scores=scores,
        conflicts=conflicts,
        citation_issues=citation_issues,
        max_items=2,
    )
    assert prioritized
    assert prioritized[0]["claim_id"] in {"C1", "C2", "C3"}

    summary = module.build_verification_summary(
        claims,
        claim_verdicts,
        evidence_graph,
        conflicts,
        scores,
        citation_issues=citation_issues,
        citation_coverage=coverage,
    )
    assert "Citation coverage:" in summary
    assert "Citation issues:" in summary
