from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Any, Iterable, Literal, Mapping, Sequence

from core.langgraph_engine.contracts.legacy_stream_contract import (
    LegacyChannel,
    LegacyMessageChunk,
    LegacySSEPayload,
    LegacyStreamStatus,
    LegacyTerminalRunStatus,
)

DiffType = Literal[
    "protocol_violation",
    "tool_sequence",
    "terminal_status",
    "assistant_final_text",
]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_json_loads(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except Exception:
        return value


def _parse_iso8601_to_ms(value: Any) -> int | None:
    if not isinstance(value, str) or not value:
        return None
    candidate = value.strip()
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(candidate)
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _canonical_json(value: Any) -> str:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    except Exception:
        return json.dumps(str(value), ensure_ascii=False)


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _hash_tool_arguments(arguments: Any) -> tuple[str, Any]:
    parsed = arguments
    if isinstance(arguments, str):
        parsed = _safe_json_loads(arguments)
    canonical = _canonical_json(parsed)
    return _sha256_hex(canonical), parsed


@dataclass(frozen=True, slots=True)
class ProtocolViolation:
    index: int
    reason: str
    payload_type: str | None = None


@dataclass(frozen=True, slots=True)
class ToolCallFingerprint:
    index: int
    tool_call_id: str | None
    name: str
    args_hash: str
    arguments: Any = None
    message_id: str | None = None
    thread_run_id: str | None = None


@dataclass(frozen=True, slots=True)
class FirstDiff:
    diff_type: DiffType
    message: str
    primary: dict[str, Any] | None = None
    shadow: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class RunStreamStats:
    agent_run_id: str
    terminal_status: LegacyTerminalRunStatus | None
    duration_ms: int | None
    tool_calls: tuple[ToolCallFingerprint, ...]
    error_counts: Mapping[str, int]
    total_tokens: int | None
    assistant_final_text: str | None
    assistant_final_message_id: str | None
    protocol_violations: tuple[ProtocolViolation, ...] = ()


@dataclass(frozen=True, slots=True)
class ComparisonReport:
    primary_agent_run_id: str
    shadow_agent_run_id: str
    engine_version: str | None
    created_at: str
    is_match: bool
    first_diff: FirstDiff | None
    primary: RunStreamStats
    shadow: RunStreamStats
    metrics: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["primary"]["error_counts"] = dict(self.primary.error_counts)
        payload["shadow"]["error_counts"] = dict(self.shadow.error_counts)
        return payload


def _is_ping_payload(payload: Mapping[str, Any]) -> bool:
    return payload.get("type") == "ping"


def _is_terminal_status_payload(payload: Mapping[str, Any]) -> bool:
    if payload.get("type") != "status":
        return False
    status = payload.get("status")
    return isinstance(status, str) and status in {"completed", "failed", "stopped", "error"}


def _validate_legacy_payloads(payloads: Sequence[LegacySSEPayload]) -> list[ProtocolViolation]:
    violations: list[ProtocolViolation] = []
    for i, payload in enumerate(payloads):
        if not isinstance(payload, dict):
            violations.append(ProtocolViolation(index=i, reason="payload_not_dict", payload_type=type(payload).__name__))
            continue

        if _is_ping_payload(payload) or _is_terminal_status_payload(payload):
            continue

        type_val = payload.get("type")
        if type_val is None:
            violations.append(ProtocolViolation(index=i, reason="missing_type"))
            continue

        if "content" not in payload or "metadata" not in payload:
            violations.append(ProtocolViolation(index=i, reason="missing_content_or_metadata", payload_type=str(type_val)))
            continue

        content = payload.get("content")
        metadata = payload.get("metadata")
        if not isinstance(content, str):
            violations.append(ProtocolViolation(index=i, reason="content_not_string", payload_type=str(type_val)))
        if not isinstance(metadata, str):
            violations.append(ProtocolViolation(index=i, reason="metadata_not_string", payload_type=str(type_val)))

        if isinstance(metadata, str):
            parsed_md = _safe_json_loads(metadata)
            if isinstance(parsed_md, str):
                violations.append(ProtocolViolation(index=i, reason="metadata_not_json", payload_type=str(type_val)))
            else:
                stream_status = parsed_md.get("stream_status") if isinstance(parsed_md, dict) else None
                if stream_status is not None and stream_status not in {"chunk", "complete"}:
                    violations.append(
                        ProtocolViolation(index=i, reason=f"invalid_stream_status:{stream_status}", payload_type=str(type_val))
                    )

        if isinstance(content, str):
            parsed_ct = _safe_json_loads(content)
            if isinstance(parsed_ct, str):
                violations.append(ProtocolViolation(index=i, reason="content_not_json", payload_type=str(type_val)))

    return violations


def _extract_terminal_status(payloads: Sequence[LegacySSEPayload]) -> LegacyTerminalRunStatus | None:
    for payload in reversed(payloads):
        if isinstance(payload, dict) and _is_terminal_status_payload(payload):
            status = payload.get("status")
            return status if isinstance(status, str) else None
    return None


def _extract_duration_ms(payloads: Sequence[LegacySSEPayload]) -> int | None:
    timestamps_ms: list[int] = []
    for payload in payloads:
        if not isinstance(payload, dict) or _is_ping_payload(payload) or _is_terminal_status_payload(payload):
            continue
        created_at = payload.get("created_at")
        ms = _parse_iso8601_to_ms(created_at)
        if ms is not None:
            timestamps_ms.append(ms)
    if not timestamps_ms:
        return None
    return max(timestamps_ms) - min(timestamps_ms)


def _extract_total_tokens(payloads: Sequence[LegacySSEPayload]) -> int | None:
    total = 0
    seen_any = False
    for payload in payloads:
        if not isinstance(payload, dict) or payload.get("type") != "llm_response_end":
            continue
        content_raw = payload.get("content")
        content = _safe_json_loads(content_raw)
        if not isinstance(content, dict):
            continue
        usage = content.get("usage")
        if not isinstance(usage, dict):
            continue
        tt = usage.get("total_tokens")
        if isinstance(tt, int):
            total += tt
            seen_any = True
    return total if seen_any else None


def _extract_assistant_final(payloads: Sequence[LegacySSEPayload]) -> tuple[str | None, str | None]:
    best_text: str | None = None
    best_message_id: str | None = None
    for payload in payloads:
        if not isinstance(payload, dict) or payload.get("type") != "assistant":
            continue
        metadata_obj = _safe_json_loads(payload.get("metadata"))
        if not isinstance(metadata_obj, dict):
            continue
        stream_status: LegacyStreamStatus | None = metadata_obj.get("stream_status")  # type: ignore[assignment]
        if stream_status != "complete":
            continue
        content_obj = _safe_json_loads(payload.get("content"))
        if isinstance(content_obj, dict):
            content_val = content_obj.get("content")
            if isinstance(content_val, str):
                best_text = content_val
                mid = payload.get("message_id")
                best_message_id = mid if isinstance(mid, str) else None
    return best_text, best_message_id


def _extract_tool_calls(payloads: Sequence[LegacySSEPayload]) -> list[ToolCallFingerprint]:
    tool_calls: list[ToolCallFingerprint] = []
    for i, payload in enumerate(payloads):
        if not isinstance(payload, dict) or payload.get("type") != "assistant":
            continue
        content_obj = _safe_json_loads(payload.get("content"))
        if not isinstance(content_obj, dict):
            continue
        raw_tool_calls = content_obj.get("tool_calls")
        if not raw_tool_calls or not isinstance(raw_tool_calls, list):
            continue

        thread_run_id = None
        metadata_obj = _safe_json_loads(payload.get("metadata"))
        if isinstance(metadata_obj, dict):
            tr = metadata_obj.get("thread_run_id")
            thread_run_id = tr if isinstance(tr, str) else None

        message_id = payload.get("message_id")
        message_id_val = message_id if isinstance(message_id, str) else None

        for call in raw_tool_calls:
            if not isinstance(call, dict):
                continue
            tool_call_id = call.get("id")
            tool_call_id_val = tool_call_id if isinstance(tool_call_id, str) else None
            function = call.get("function")
            if not isinstance(function, dict):
                continue
            name = function.get("name")
            if not isinstance(name, str) or not name:
                continue
            args = function.get("arguments")
            args_hash, parsed_args = _hash_tool_arguments(args)
            tool_calls.append(
                ToolCallFingerprint(
                    index=i,
                    tool_call_id=tool_call_id_val,
                    name=name,
                    args_hash=args_hash,
                    arguments=parsed_args,
                    message_id=message_id_val,
                    thread_run_id=thread_run_id,
                )
            )
    return tool_calls


def _count_error_types(payloads: Sequence[LegacySSEPayload]) -> dict[str, int]:
    counts: dict[str, int] = {"schema_reject": 0, "tool_not_found": 0, "tool_error": 0, "other_error": 0}

    def _bump(key: str):
        counts[key] = counts.get(key, 0) + 1

    for payload in payloads:
        if not isinstance(payload, dict) or _is_ping_payload(payload) or _is_terminal_status_payload(payload):
            continue

        error_type: str | None = None
        for raw in (payload.get("metadata"), payload.get("content")):
            obj = _safe_json_loads(raw)
            if isinstance(obj, dict) and isinstance(obj.get("error_type"), str):
                error_type = obj["error_type"]
                break

        if payload.get("type") == "status":
            content = _safe_json_loads(payload.get("content"))
            if isinstance(content, dict):
                status_type = content.get("status_type")
                if status_type in {"tool_failed", "tool_error"}:
                    _bump("tool_error")
                if isinstance(content.get("error_type"), str):
                    error_type = content["error_type"]

                message = content.get("message")
                if error_type is None and isinstance(message, str):
                    lower = message.lower()
                    if "schema" in lower and ("reject" in lower or "invalid" in lower):
                        error_type = "schema_reject"
                    elif ("not found" in lower or "unknown tool" in lower) and "tool" in lower:
                        error_type = "tool_not_found"

        if payload.get("type") == "tool":
            content = _safe_json_loads(payload.get("content"))
            if isinstance(content, dict):
                tool_content = content.get("content")
                if isinstance(tool_content, str):
                    lower = tool_content.lower()
                    if error_type is None and "disabled_in_shadow" in lower:
                        error_type = "disabled_in_shadow"
                    if error_type is None and "schema" in lower and ("reject" in lower or "invalid" in lower):
                        error_type = "schema_reject"
                    if error_type is None and ("not found" in lower or "unknown tool" in lower):
                        error_type = "tool_not_found"

        if error_type:
            normalized = error_type.strip()
            if normalized in counts:
                _bump(normalized)
            else:
                _bump("other_error")

    return counts


def analyze_legacy_stream(payloads: Sequence[LegacySSEPayload], agent_run_id: str) -> RunStreamStats:
    filtered = [p for p in payloads if isinstance(p, dict) and not _is_ping_payload(p)]
    violations = _validate_legacy_payloads(filtered)
    tool_calls = _extract_tool_calls(filtered)
    terminal_status = _extract_terminal_status(filtered)
    duration_ms = _extract_duration_ms(filtered)
    total_tokens = _extract_total_tokens(filtered)
    assistant_final_text, assistant_final_message_id = _extract_assistant_final(filtered)
    error_counts = _count_error_types(filtered)

    return RunStreamStats(
        agent_run_id=agent_run_id,
        terminal_status=terminal_status,
        duration_ms=duration_ms,
        tool_calls=tuple(tool_calls),
        error_counts=error_counts,
        total_tokens=total_tokens,
        assistant_final_text=assistant_final_text,
        assistant_final_message_id=assistant_final_message_id,
        protocol_violations=tuple(violations),
    )


def _diff_tool_sequences(
    primary: Sequence[ToolCallFingerprint], shadow: Sequence[ToolCallFingerprint]
) -> FirstDiff | None:
    limit = min(len(primary), len(shadow))
    for i in range(limit):
        left = primary[i]
        right = shadow[i]
        if left.name != right.name or left.args_hash != right.args_hash:
            return FirstDiff(
                diff_type="tool_sequence",
                message=f"tool_call_mismatch at index {i}",
                primary=asdict(left),
                shadow=asdict(right),
            )
    if len(primary) != len(shadow):
        return FirstDiff(
            diff_type="tool_sequence",
            message=f"tool_call_count_mismatch primary={len(primary)} shadow={len(shadow)}",
            primary={"count": len(primary)},
            shadow={"count": len(shadow)},
        )
    return None


def _text_similarity(a: str | None, b: str | None) -> float | None:
    if a is None or b is None:
        return None
    if not a and not b:
        return 1.0
    return SequenceMatcher(a=a, b=b).ratio()


def compare_legacy_streams(
    primary_payloads: Sequence[LegacySSEPayload],
    shadow_payloads: Sequence[LegacySSEPayload],
    *,
    primary_agent_run_id: str,
    shadow_agent_run_id: str,
    engine_version: str | None = None,
    assistant_similarity_threshold: float = 0.85,
    required_phrases: Sequence[str] = (),
) -> ComparisonReport:
    primary = analyze_legacy_stream(primary_payloads, agent_run_id=primary_agent_run_id)
    shadow = analyze_legacy_stream(shadow_payloads, agent_run_id=shadow_agent_run_id)

    similarity = _text_similarity(primary.assistant_final_text, shadow.assistant_final_text)
    missing_required: list[str] = []
    if required_phrases and shadow.assistant_final_text:
        for phrase in required_phrases:
            if phrase not in shadow.assistant_final_text:
                missing_required.append(phrase)

    first_diff: FirstDiff | None = None
    if primary.protocol_violations or shadow.protocol_violations:
        first_diff = FirstDiff(
            diff_type="protocol_violation",
            message="protocol violations detected",
            primary={"violations": [asdict(v) for v in primary.protocol_violations]},
            shadow={"violations": [asdict(v) for v in shadow.protocol_violations]},
        )
    else:
        first_diff = _diff_tool_sequences(primary.tool_calls, shadow.tool_calls)
        if first_diff is None and primary.terminal_status != shadow.terminal_status:
            first_diff = FirstDiff(
                diff_type="terminal_status",
                message=f"terminal status mismatch primary={primary.terminal_status} shadow={shadow.terminal_status}",
                primary={"terminal_status": primary.terminal_status},
                shadow={"terminal_status": shadow.terminal_status},
            )
        if first_diff is None:
            if missing_required:
                first_diff = FirstDiff(
                    diff_type="assistant_final_text",
                    message="shadow final assistant missing required phrases",
                    primary={"required_phrases": list(required_phrases)},
                    shadow={"missing": missing_required},
                )
            elif similarity is not None and similarity < assistant_similarity_threshold:
                first_diff = FirstDiff(
                    diff_type="assistant_final_text",
                    message=f"assistant similarity below threshold ({similarity:.3f} < {assistant_similarity_threshold:.3f})",
                    primary={
                        "assistant_final_message_id": primary.assistant_final_message_id,
                        "assistant_final_text": primary.assistant_final_text,
                    },
                    shadow={
                        "assistant_final_message_id": shadow.assistant_final_message_id,
                        "assistant_final_text": shadow.assistant_final_text,
                    },
                )

    tool_calls_primary = len(primary.tool_calls)
    tool_calls_shadow = len(shadow.tool_calls)
    denom_primary = max(1, tool_calls_primary)
    denom_shadow = max(1, tool_calls_shadow)

    metrics = {
        "assistant_similarity": similarity,
        "missing_required_phrases": missing_required,
        "tool_calls_primary": tool_calls_primary,
        "tool_calls_shadow": tool_calls_shadow,
        "schema_reject_rate_primary": primary.error_counts.get("schema_reject", 0) / denom_primary,
        "schema_reject_rate_shadow": shadow.error_counts.get("schema_reject", 0) / denom_shadow,
        "tool_not_found_rate_primary": primary.error_counts.get("tool_not_found", 0) / denom_primary,
        "tool_not_found_rate_shadow": shadow.error_counts.get("tool_not_found", 0) / denom_shadow,
        "tool_error_rate_primary": primary.error_counts.get("tool_error", 0) / denom_primary,
        "tool_error_rate_shadow": shadow.error_counts.get("tool_error", 0) / denom_shadow,
        "duration_ms_primary": primary.duration_ms,
        "duration_ms_shadow": shadow.duration_ms,
        "total_tokens_primary": primary.total_tokens,
        "total_tokens_shadow": shadow.total_tokens,
    }

    return ComparisonReport(
        primary_agent_run_id=primary_agent_run_id,
        shadow_agent_run_id=shadow_agent_run_id,
        engine_version=engine_version,
        created_at=_utc_now_iso(),
        is_match=first_diff is None,
        first_diff=first_diff,
        primary=primary,
        shadow=shadow,
        metrics=metrics,
    )


def load_legacy_payloads_from_jsonl(lines: Iterable[str]) -> list[LegacySSEPayload]:
    payloads: list[LegacySSEPayload] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        payloads.append(json.loads(line))
    return payloads


def describe_assistant_channel(payload: LegacyMessageChunk) -> LegacyChannel | None:
    if payload.get("type") != "assistant":
        return None
    metadata_obj = _safe_json_loads(payload.get("metadata"))
    if not isinstance(metadata_obj, dict):
        return None
    channel = metadata_obj.get("channel")
    return channel if channel in {"reasoning"} else None

