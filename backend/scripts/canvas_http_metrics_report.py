from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


TARGET_METRICS = ("openCanvas", "applyOps", "importSnapshot", "getSnapshot")


@dataclass
class MetricBucket:
    count: int = 0
    success_count: int = 0
    conflict_count: int = 0
    latencies_ms: list[int] = field(default_factory=list)

    def add(self, record: dict[str, Any]) -> None:
        self.count += 1
        if bool(record.get("success")):
            self.success_count += 1
        if bool(record.get("conflict")):
            self.conflict_count += 1
        latency = record.get("latency_ms")
        try:
            if latency is not None:
                self.latencies_ms.append(int(latency))
        except Exception:
            pass

    def success_rate(self) -> str:
        if self.count == 0:
            return "N/A"
        return f"{(self.success_count / self.count) * 100:.2f}%"

    def conflict_rate(self) -> str:
        if self.count == 0:
            return "N/A"
        return f"{(self.conflict_count / self.count) * 100:.2f}%"

    def p95(self) -> str:
        if not self.latencies_ms:
            return "N/A"
        values = sorted(self.latencies_ms)
        index = max(0, int(len(values) * 0.95) - 1)
        return str(values[index])


def _load_json_lines(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            text = line.strip()
            if not text:
                continue
            try:
                parsed = json.loads(text)
            except Exception:
                continue
            if isinstance(parsed, dict):
                yield parsed


def _build_report(records: Iterable[dict[str, Any]]) -> str:
    buckets = {name: MetricBucket() for name in TARGET_METRICS}
    for record in records:
        if record.get("event") != "canvas_http_metric":
            continue
        metric_name = record.get("metric_name")
        if metric_name not in buckets:
            continue
        buckets[metric_name].add(record)

    lines = [
        "# Canvas HTTP Metrics Report",
        "",
        "| metric | count | success_rate | p95_latency_ms | conflict_rate |",
        "|---|---:|---:|---:|---:|",
    ]
    for name in TARGET_METRICS:
        bucket = buckets[name]
        lines.append(
            f"| {name} | {bucket.count} | {bucket.success_rate()} | {bucket.p95()} | {bucket.conflict_rate()} |"
        )
    lines.append("")
    lines.append("> Generated from structured log event `canvas_http_metric`.")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate canvas HTTP baseline metrics report from JSON logs.")
    parser.add_argument("--input", required=True, help="Path to JSONL log file")
    parser.add_argument("--output", required=False, help="Optional output markdown path")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    report = _build_report(_load_json_lines(input_path))
    print(report)

    if args.output:
        output_path = Path(args.output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(report, encoding="utf-8")


if __name__ == "__main__":
    main()
