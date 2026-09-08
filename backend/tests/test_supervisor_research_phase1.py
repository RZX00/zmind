import ast
import importlib.util
from pathlib import Path

from core.langgraph_engine.supervisor.config import load_supervisor_config


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _load_research_prompts_module():
    prompts_path = _backend_root() / "core" / "langgraph_engine" / "research_graph" / "prompts.py"
    spec = importlib.util.spec_from_file_location("research_graph_prompts_phase1", prompts_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def test_subagent_runner_passes_parent_agent_config_for_research_runner():
    subagent_runner_path = _backend_root() / "core" / "langgraph_engine" / "supervisor" / "subagent_runner.py"
    source = subagent_runner_path.read_text(encoding="utf-8")
    tree = ast.parse(source)

    has_gate_assignment = False
    uses_passthrough_in_run_config = False

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "subagent_agent_config":
                    value = node.value
                    if (
                        isinstance(value, ast.IfExp)
                        and isinstance(value.test, ast.Compare)
                        and isinstance(value.test.left, ast.Attribute)
                        and isinstance(value.test.left.value, ast.Name)
                        and value.test.left.value.id == "agent_def"
                        and value.test.left.attr == "runner"
                        and len(value.test.comparators) == 1
                        and isinstance(value.test.comparators[0], ast.Constant)
                        and value.test.comparators[0].value == "research_graph"
                    ):
                        has_gate_assignment = True
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "RunConfig":
            for kw in node.keywords:
                if kw.arg == "agent_config" and isinstance(kw.value, ast.Name) and kw.value.id == "subagent_agent_config":
                    uses_passthrough_in_run_config = True

    assert has_gate_assignment
    assert uses_passthrough_in_run_config


def test_load_supervisor_config_supports_router_hard_gate(monkeypatch):
    monkeypatch.setenv("LANGGRAPH_ROUTER_HARD_GATE", "false")
    cfg_env_default = load_supervisor_config()
    assert cfg_env_default.router_hard_gate is False

    cfg_snake = load_supervisor_config({"supervisor_router_hard_gate": True})
    assert cfg_snake.router_hard_gate is True

    cfg_camel = load_supervisor_config({"supervisorRouterHardGate": "true"})
    assert cfg_camel.router_hard_gate is True

    cfg_disable = load_supervisor_config({"supervisor_router_hard_gate": 0})
    assert cfg_disable.router_hard_gate is False


def test_research_graph_prompts_are_file_backed_and_formatted():
    prompts_module = _load_research_prompts_module()

    current_date = "February 06, 2026"
    topic = "LLM agent memory systems"
    summaries = "Summary A\nSummary B"
    sources_json = '[{"source_id":"S1","title":"Paper","url":"https://example.com"}]'

    clarify_prompt = prompts_module.get_clarify_prompt(
        current_date=current_date,
        research_topic=topic,
    )
    assert "clarified_task" in clarify_prompt
    assert topic in clarify_prompt

    rewrite_prompt = prompts_module.get_rewrite_prompt(
        current_date=current_date,
        clarified_task=topic,
        clarification_notes="Need latest benchmarks",
    )
    assert "rewritten_task" in rewrite_prompt
    assert topic in rewrite_prompt

    query_prompt = prompts_module.get_query_writer_prompt(
        current_date=current_date,
        research_topic=topic,
        number_queries=4,
    )
    assert "Max queries: 4" in query_prompt

    reflection_prompt = prompts_module.get_reflection_prompt(
        current_date=current_date,
        research_topic=topic,
        summaries=summaries,
        verification_summary="Claims: 2\nEvidence items: 4\nConflicts: 0",
    )
    assert "follow_up_queries" in reflection_prompt
    assert summaries in reflection_prompt

    answer_prompt = prompts_module.get_answer_prompt(
        current_date=current_date,
        research_topic=topic,
        summaries=summaries,
        sources_json=sources_json,
        verification_json='{"claims":[],"evidence_graph":[],"conflicts":[],"confidence_scores":[]}',
    )
    assert sources_json in answer_prompt

    extract_claims_prompt = prompts_module.get_extract_claims_prompt(
        current_date=current_date,
        research_topic=topic,
        summaries=summaries,
    )
    assert "claims" in extract_claims_prompt
    assert summaries in extract_claims_prompt

    verify_claims_prompt = prompts_module.get_verify_claims_prompt(
        current_date=current_date,
        research_topic=topic,
        claims_json='[{"claim_id":"C1","text":"Claim text"}]',
        sources_json=sources_json,
        summaries=summaries,
    )
    assert '"claim_verdicts"' in verify_claims_prompt
    assert sources_json in verify_claims_prompt


def test_research_graph_runner_contains_phase1_nodes_and_budget_controls():
    runner_path = _backend_root() / "core" / "langgraph_engine" / "research_graph" / "runner.py"
    source = runner_path.read_text(encoding="utf-8")
    tree = ast.parse(source)

    async_fn_names = {node.name for node in ast.walk(tree) if isinstance(node, ast.AsyncFunctionDef)}
    assert "clarify_intent" in async_fn_names
    assert "rewrite_task" in async_fn_names
    assert "extract_claims" in async_fn_names
    assert "verify_claims" in async_fn_names
    assert "detect_conflicts_node" in async_fn_names
    assert "score_confidence_node" in async_fn_names
    assert "validate_citations_node" in async_fn_names
    assert "publish_research_artifacts" in async_fn_names

    required_budget_keys = {
        "research_max_total_queries",
        "research_max_tool_calls",
        "research_max_extract_urls",
        "research_max_runtime_seconds",
        "research_phase2_enabled",
        "research_max_claims",
        "research_max_evidence_per_claim",
        "research_phase2_priority_followup_enabled",
        "research_phase2_cross_claim_conflict_enabled",
        "research_phase2_citation_guard_enabled",
        "research_phase2_follow_up_claim_limit",
        "research_phase2_high_importance_min_evidence",
        "research_publish_enabled",
        "research_publish_kb_enabled",
        "research_publish_canvas_enabled",
        "research_publish_kb_folder_name",
        "research_publish_canvas_claim_limit",
    }
    for budget_key in required_budget_keys:
        assert budget_key in source

    assert 'graph.add_edge(START, "clarify_intent")' in source
    assert 'graph.add_edge("clarify_intent", "rewrite_task")' in source
    assert 'graph.add_edge("rewrite_task", "generate_query")' in source
    assert "_mark_budget_exhausted" in source
    assert 'graph.add_edge("extract_claims", "verify_claims")' in source
    assert 'graph.add_edge("score_confidence", "validate_citations")' in source
    assert '"verification": final_verification' in source
    assert '"publication": publication' in source


def test_research_graph_prompt_templates_exist():
    prompt_root = _repo_root() / "prompts" / "research_graph"
    expected = {
        "clarify.prompt.md",
        "rewrite.prompt.md",
        "query_writer.prompt.md",
        "reflection.prompt.md",
        "answer.prompt.md",
        "extract_claims.prompt.md",
        "verify_claims.prompt.md",
    }
    existing = {path.name for path in prompt_root.glob("*.prompt.md")}
    assert expected.issubset(existing)
