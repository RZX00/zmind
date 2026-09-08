from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

# Ensure backend root is on sys.path when invoked from arbitrary working dirs.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from core.langgraph_engine.tools.catalog import build_registry
from core.langgraph_engine.tools.registry import lint_registry_openai_schemas

HIGH_RISK_WARNING_RULES = {
    "collapse_union_fallback",
    "type_list_downgrade",
    "shape_repair",
    "ref_cycle",
    "ref_unresolved",
}


def summarize_warnings(warnings: dict[str, list[str]]) -> dict[str, object]:
    flat = []
    high_risk_tools: dict[str, list[str]] = {}
    for tool, rules in warnings.items():
        for r in rules:
            flat.append(r)
            if r in HIGH_RISK_WARNING_RULES:
                high_risk_tools.setdefault(tool, []).append(r)

    counts = Counter(flat)
    return {
        "rule_counts": dict(counts),
        "high_risk_rules": sorted(set(r for r in flat if r in HIGH_RISK_WARNING_RULES)),
        "high_risk_tools": high_risk_tools,
    }


def main() -> int:
    registry = build_registry()
    issues_by_tool = lint_registry_openai_schemas(registry)
    if issues_by_tool:
        print(json.dumps({k: [i.__dict__ for i in v] for k, v in issues_by_tool.items()}, indent=2))
        return 1

    warnings = registry.schema_warnings()
    if warnings:
        summary = summarize_warnings(warnings)
        payload = {"schema_warnings": warnings, "warning_summary": summary}
        print(json.dumps(payload, indent=2))
    else:
        print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
