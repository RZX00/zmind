from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal, Tuple

TruncateMode = Literal["head", "head_tail"]

# Canvas read tools emit structured JSON that must stay valid. They self-budget their own
# output size (see CanvasReadTool / budget_read_result), so byte-level head truncation here —
# which would cut the JSON mid-array and corrupt the read — is skipped for them.
CANVAS_READ_TOOL_NAMES = frozenset({"canvas_read", "workspace_list_canvases"})


@dataclass(frozen=True, slots=True)
class ToolMessageTruncation:
    max_chars: int
    mode: TruncateMode


def resolve_tool_message_truncation() -> ToolMessageTruncation:
    raw_max = os.getenv("TOOL_MESSAGE_CONTEXT_MAX_CHARS", "8000")
    try:
        max_chars = int(raw_max)
    except Exception:
        max_chars = 8000
    if max_chars < 0:
        max_chars = 0
    max_chars = min(max_chars, 200_000)

    mode_raw = (os.getenv("TOOL_MESSAGE_CONTEXT_TRUNCATE_MODE", "head") or "head").strip().lower()
    if mode_raw in {"head_tail", "headtail", "middle"}:
        mode: TruncateMode = "head_tail"
    else:
        mode = "head"

    return ToolMessageTruncation(max_chars=max_chars, mode=mode)


def truncate_tool_message_content(
    content: str,
    *,
    message_id: str,
    tool_name: str | None = None,
    truncation: ToolMessageTruncation | None = None,
) -> Tuple[str, bool]:
    cfg = truncation or resolve_tool_message_truncation()
    max_chars = cfg.max_chars
    if max_chars <= 0:
        return content, False

    # Canvas reads self-budget their JSON (CanvasReadTool.budget_read_result); never byte-truncate
    # them here — head truncation would cut the JSON mid-structure and corrupt the read.
    if tool_name and tool_name in CANVAS_READ_TOOL_NAMES:
        return content, False

    original_chars = len(content)
    if original_chars <= max_chars:
        return content, False

    marker = _truncate_marker(
        message_id=message_id,
        original_chars=original_chars,
        tool_name=tool_name,
    )
    budget = max_chars - len(marker)
    if budget <= 0:
        return marker[:max_chars], True

    if cfg.mode == "head_tail":
        head_chars = max(0, int(budget * 0.6))
        tail_chars = max(0, budget - head_chars)
        head = content[:head_chars].rstrip()
        tail = content[-tail_chars:].lstrip() if tail_chars else ""
        return f"{head}{marker}{tail}", True

    head = content[:budget].rstrip()
    return f"{head}{marker}", True


def _truncate_marker(*, message_id: str, original_chars: int, tool_name: str | None) -> str:
    tool_part = f" tool={tool_name}" if tool_name else ""
    return (
        f"\n\n...[tool output truncated{tool_part}; chars={original_chars}; "
        f"message_id={message_id}; use expand_message]..."
    )

