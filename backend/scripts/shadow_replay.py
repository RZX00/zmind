#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Sequence

from core.langgraph_engine.shadow.comparator import compare_legacy_streams
from core.langgraph_engine.shadow.rollback_policy import RollbackPolicy


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _extract_payloads(record: dict[str, Any]) -> list[dict[str, Any]]:
    legacy = record.get("legacy_stream") or {}
    payloads = legacy.get("payloads")
    if not isinstance(payloads, list):
        raise ValueError("record.legacy_stream.payloads must be a list")
    return payloads


def _extract_required_phrases(record: dict[str, Any]) -> list[str]:
    assertions = record.get("assertions") or {}
    phrases = assertions.get("required_phrases")
    if not phrases:
        return []
    if not isinstance(phrases, list) or not all(isinstance(p, str) for p in phrases):
        raise ValueError("record.assertions.required_phrases must be a list[str]")
    return list(phrases)


def compare_one(primary_record: dict[str, Any], shadow_record: dict[str, Any] | None, *, engine_version: str | None) -> dict[str, Any]:
    primary_run_id = primary_record.get("primary_agent_run_id") or primary_record.get("agent_run", {}).get("id")
    if not isinstance(primary_run_id, str):
        raise ValueError("primary record missing primary_agent_run_id")

    shadow_run_id = None
    if shadow_record:
        shadow_run_id = shadow_record.get("primary_agent_run_id") or shadow_record.get("agent_run", {}).get("id")
    if not isinstance(shadow_run_id, str):
        shadow_run_id = primary_record.get("shadow_agent_run_id")
    if not isinstance(shadow_run_id, str):
        shadow_run_id = f"shadow_of_{primary_run_id}"

    required_phrases = _extract_required_phrases(primary_record)

    report = compare_legacy_streams(
        _extract_payloads(primary_record),
        _extract_payloads(shadow_record or primary_record),
        primary_agent_run_id=primary_run_id,
        shadow_agent_run_id=shadow_run_id,
        engine_version=engine_version,
        required_phrases=required_phrases,
    )
    return report.to_dict()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="WS-E: Replay/compare recorded fixtures and evaluate rollback gates (offline)."
    )
    parser.add_argument("--primary", type=Path, required=True, help="Primary record JSON (ws-e-recording-v1)")
    parser.add_argument("--shadow", type=Path, default=None, help="Shadow record JSON (optional)")
    parser.add_argument("--engine-version", type=str, default=None, help="Engine version string for the report")
    parser.add_argument("--out", type=Path, default=None, help="Write comparison report JSON to this path")
    parser.add_argument("--batch-dir", type=Path, default=None, help="Batch mode: directory of primary records")
    parser.add_argument("--out-dir", type=Path, default=Path("backend/tests/golden/reports"), help="Batch output dir")
    parser.add_argument("--evaluate-policy", action="store_true", help="Evaluate rollback policy on batch reports")
    args = parser.parse_args()

    if args.batch_dir:
        batch_dir: Path = args.batch_dir
        records = sorted(batch_dir.glob("*.json"))
        if not records:
            raise SystemExit(f"no records found in {batch_dir}")

        reports: list[dict[str, Any]] = []
        for record_path in records:
            primary = _load_json(record_path)
            report = compare_one(primary, shadow_record=None, engine_version=args.engine_version)
            reports.append(report)
            out_path = args.out_dir / f"{record_path.stem}.report.json"
            _write_json(out_path, report)

        if args.evaluate_policy:
            # Re-hydrate into ComparisonReport-like dicts for reporting; policy expects objects,
            # but CI can call policy directly in code. Here we evaluate based on dict metrics only.
            policy = RollbackPolicy()
            # Minimal shim: we only need `engine_version`, `metrics`, and `primary/shadow.error_counts`.
            from core.langgraph_engine.shadow.comparator import ComparisonReport, FirstDiff, RunStreamStats

            def _hydrate(d: dict[str, Any]) -> ComparisonReport:
                return ComparisonReport(
                    primary_agent_run_id=d["primary_agent_run_id"],
                    shadow_agent_run_id=d["shadow_agent_run_id"],
                    engine_version=d.get("engine_version"),
                    created_at=d.get("created_at") or "",
                    is_match=bool(d.get("is_match")),
                    first_diff=FirstDiff(**d["first_diff"]) if d.get("first_diff") else None,
                    primary=RunStreamStats(**d["primary"]),
                    shadow=RunStreamStats(**d["shadow"]),
                    metrics=d.get("metrics") or {},
                )

            hydrated = [_hydrate(r) for r in reports]
            decision = policy.evaluate(hydrated)
            _write_json(args.out_dir / "rollback_decision.json", decision.to_dict())

        return 0

    primary_record = _load_json(args.primary)
    shadow_record = _load_json(args.shadow) if args.shadow else None
    report = compare_one(primary_record, shadow_record, engine_version=args.engine_version)
    if args.out:
        _write_json(args.out, report)
    else:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

