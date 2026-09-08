import importlib.util
from pathlib import Path


def _load_formatter_module():
    backend_root = Path(__file__).resolve().parents[1]
    module_path = backend_root / "core" / "langgraph_engine" / "research_graph" / "report_formatter.py"
    spec = importlib.util.spec_from_file_location("research_graph_report_formatter", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def test_select_canvas_claim_cards_prioritizes_importance_and_score():
    module = _load_formatter_module()
    claims = [
        {"claim_id": "C1", "text": "High claim", "importance": "high"},
        {"claim_id": "C2", "text": "Medium claim", "importance": "medium"},
        {"claim_id": "C3", "text": "Low claim", "importance": "low"},
    ]
    verdicts = [
        {"claim_id": "C1", "status": "supported", "confidence": "medium"},
        {"claim_id": "C2", "status": "mixed", "confidence": "low"},
        {"claim_id": "C3", "status": "supported", "confidence": "high"},
    ]
    scores = [
        {"claim_id": "C1", "level": "high", "score": 80},
        {"claim_id": "C2", "level": "low", "score": 40},
        {"claim_id": "C3", "level": "high", "score": 90},
    ]

    cards = module.select_canvas_claim_cards(
        claims=claims,
        claim_verdicts=verdicts,
        confidence_scores=scores,
        limit=2,
    )
    assert len(cards) == 2
    assert cards[0]["claim_id"] == "C1"


def test_build_research_report_markdown_contains_publication_sections():
    module = _load_formatter_module()
    markdown = module.build_research_report_markdown(
        topic="Agent reliability benchmarks",
        final_answer="This is the final answer body.",
        sources=[
            {"source_id": "S1", "title": "Paper A", "url": "https://example.com/a"},
            {"source_id": "S2", "title": "Paper B", "url": "https://example.com/b"},
        ],
        verification={
            "claims": [{"claim_id": "C1", "text": "Claim text", "importance": "high"}],
            "claim_verdicts": [{"claim_id": "C1", "status": "supported", "confidence": "high"}],
            "confidence_scores": [{"claim_id": "C1", "level": "high", "score": 88}],
            "conflicts": [],
            "citation_issues": [{"severity": "warning", "code": "x", "message": "issue"}],
            "citation_coverage": {"coverage_ratio": 0.8},
            "verification_summary": "summary line",
            "evidence_graph": [{"evidence_id": "E1", "claim_id": "C1"}],
        },
        kb_entry_id="kb-123",
        canvas_group_id="group-123",
    )
    assert "# Deep Research Report" in markdown
    assert "Knowledge Entry ID: `kb-123`" in markdown
    assert "Citation coverage: 80%" in markdown
    assert "## Sources" in markdown


def test_build_canvas_report_nodes_returns_group_and_children():
    module = _load_formatter_module()

    counter = {"v": 0}

    def _id_factory() -> str:
        counter["v"] += 1
        return f"node-{counter['v']}"

    payload = module.build_canvas_report_nodes(
        base_x=100.0,
        base_y=120.0,
        topic="topic",
        kb_entry_id="kb-1",
        verification={
            "claims": [{"claim_id": "C1"}],
            "conflicts": [],
            "evidence_graph": [],
            "citation_issues": [],
            "citation_coverage": {"coverage_ratio": 1.0},
        },
        claim_cards=[{"claim_id": "C1", "importance": "high", "status": "supported", "confidence": "high", "score": 90, "text": "text"}],
        source_preview=[{"source_id": "S1", "title": "Source one"}],
        node_id_factory=_id_factory,
    )
    nodes = payload["nodes"]
    assert nodes
    assert payload["group_node_id"].startswith("node-")
    assert len(payload["child_node_ids"]) >= 4
