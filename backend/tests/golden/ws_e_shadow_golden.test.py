import json
from pathlib import Path

from core.langgraph_engine.shadow.comparator import compare_legacy_streams


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _load_cases(name: str) -> list[dict]:
    payload = json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))
    return payload["cases"]


def _materialize_payloads(payloads: list[dict]) -> list[dict]:
    out: list[dict] = []
    for raw in payloads:
        if not isinstance(raw, dict):
            out.append(raw)
            continue
        item = dict(raw)
        if "content_obj" in item:
            item["content"] = json.dumps(item.pop("content_obj"), ensure_ascii=False)
        if "metadata_obj" in item:
            item["metadata"] = json.dumps(item.pop("metadata_obj"), ensure_ascii=False)
        out.append(item)
    return out


def test_ws_e_golden_sessions_match():
    cases = _load_cases("ws_e_golden_sessions_v1.json")
    assert len(cases) >= 20

    for case in cases:
        primary_payloads = _materialize_payloads(case["primary_payloads"])
        shadow_payloads = _materialize_payloads(case.get("shadow_payloads") or case["primary_payloads"])
        required_phrases = case.get("required_phrases") or []

        report = compare_legacy_streams(
            primary_payloads,
            shadow_payloads,
            primary_agent_run_id=case["primary_agent_run_id"],
            shadow_agent_run_id=case["shadow_agent_run_id"],
            engine_version=case.get("engine_version"),
            required_phrases=required_phrases,
        )

        assert report.primary_agent_run_id == case["primary_agent_run_id"]
        assert report.shadow_agent_run_id == case["shadow_agent_run_id"]
        assert report.engine_version == case.get("engine_version")
        assert report.is_match is True, case["case_id"]
        assert report.first_diff is None, case["case_id"]

        expected = case.get("expect") or {}
        if "total_tokens" in expected:
            assert report.metrics["total_tokens_primary"] == expected["total_tokens"], case["case_id"]
        if "duration_ms" in expected:
            assert report.metrics["duration_ms_primary"] == expected["duration_ms"], case["case_id"]


def test_ws_e_negative_cases_find_first_diff():
    cases = _load_cases("ws_e_negative_cases_v1.json")
    assert cases

    for case in cases:
        primary_payloads = _materialize_payloads(case["primary_payloads"])
        shadow_payloads = _materialize_payloads(case.get("shadow_payloads") or case["primary_payloads"])
        required_phrases = case.get("required_phrases") or []
        threshold = case.get("assistant_similarity_threshold", 0.85)

        report = compare_legacy_streams(
            primary_payloads,
            shadow_payloads,
            primary_agent_run_id=case["primary_agent_run_id"],
            shadow_agent_run_id=case["shadow_agent_run_id"],
            engine_version=case.get("engine_version"),
            required_phrases=required_phrases,
            assistant_similarity_threshold=threshold,
        )

        expect = case["expect"]
        assert report.is_match is expect["is_match"], case["case_id"]
        assert report.first_diff is not None, case["case_id"]
        assert report.first_diff.diff_type == expect["first_diff_type"], case["case_id"]

