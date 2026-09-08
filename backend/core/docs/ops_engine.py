from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .block_extractor import extract_doc_blocks


@dataclass
class ChunkSpan:
    block_id: str
    order_index: int
    start: int
    end: int


@dataclass
class AppliedOp:
    index: int
    op_type: str
    status: str
    details: dict[str, Any]


class DocOpsError(ValueError):
    def __init__(self, message: str, *, op_index: int, op_type: str) -> None:
        super().__init__(message)
        self.op_index = op_index
        self.op_type = op_type


def _normalize_text(content_md: str) -> str:
    return str(content_md or "").replace("\r\n", "\n")


def _compute_chunk_spans(item_id: str, content_md: str) -> list[ChunkSpan]:
    content = _normalize_text(content_md)
    lines = content.split("\n")
    blocks = extract_doc_blocks(item_id, content)

    spans: list[ChunkSpan] = []
    chunk_start: int | None = None
    chunk_end: int | None = None
    offset = 0
    block_idx = 0

    for idx, line in enumerate(lines):
        line_start = offset
        line_end = line_start + len(line)
        is_blank = len(line.strip()) == 0

        if not is_blank:
            if chunk_start is None:
                chunk_start = line_start
            chunk_end = line_end
        elif chunk_start is not None and chunk_end is not None:
            if block_idx < len(blocks):
                block = blocks[block_idx]
                spans.append(
                    ChunkSpan(
                        block_id=block.block_id,
                        order_index=block.order_index,
                        start=chunk_start,
                        end=chunk_end,
                    )
                )
            block_idx += 1
            chunk_start = None
            chunk_end = None

        if idx < len(lines) - 1:
            offset = line_end + 1
        else:
            offset = line_end

    if chunk_start is not None and chunk_end is not None and block_idx < len(blocks):
        block = blocks[block_idx]
        spans.append(
            ChunkSpan(
                block_id=block.block_id,
                order_index=block.order_index,
                start=chunk_start,
                end=chunk_end,
            )
        )

    return spans


def _require_int(value: Any, name: str, *, op_index: int, op_type: str) -> int:
    try:
        parsed = int(value)
    except Exception as exc:  # pragma: no cover - defensive
        raise DocOpsError(f"{name} must be an integer", op_index=op_index, op_type=op_type) from exc
    return parsed


def _require_str(value: Any, name: str, *, op_index: int, op_type: str) -> str:
    if not isinstance(value, str):
        raise DocOpsError(f"{name} must be a string", op_index=op_index, op_type=op_type)
    return value


def _insert_with_padding(current: str, position: int, content_md: str) -> str:
    insert_text = _normalize_text(content_md)
    if not insert_text:
        return current

    prefix = ""
    suffix = ""
    if position > 0 and not current[:position].endswith("\n"):
        prefix = "\n\n"
    elif position > 0 and not current[:position].endswith("\n\n"):
        prefix = "\n"

    if position < len(current) and not current[position:].startswith("\n"):
        suffix = "\n\n"
    elif position < len(current) and not current[position:].startswith("\n\n"):
        suffix = "\n"

    return f"{current[:position]}{prefix}{insert_text}{suffix}{current[position:]}"


def apply_doc_ops(item_id: str, content_md: str, ops: list[dict[str, Any]]) -> tuple[str, list[AppliedOp]]:
    current = _normalize_text(content_md)
    applied: list[AppliedOp] = []

    for idx, raw_op in enumerate(ops or []):
        if not isinstance(raw_op, dict):
            raise DocOpsError("Operation must be an object", op_index=idx, op_type="unknown")

        op_type = str(raw_op.get("op") or "").strip().lower()
        if not op_type:
            raise DocOpsError("Operation type is required", op_index=idx, op_type="unknown")

        if op_type == "replace_document":
            content_value = _require_str(raw_op.get("contentMd"), "contentMd", op_index=idx, op_type=op_type)
            current = _normalize_text(content_value)
            applied.append(
                AppliedOp(
                    index=idx,
                    op_type=op_type,
                    status="applied",
                    details={"length": len(current)},
                )
            )
            continue

        if op_type in {"replace_range", "delete_range"}:
            range_payload = raw_op.get("range")
            if not isinstance(range_payload, dict):
                raise DocOpsError("range is required", op_index=idx, op_type=op_type)
            start = _require_int(range_payload.get("from"), "range.from", op_index=idx, op_type=op_type)
            end = _require_int(range_payload.get("to"), "range.to", op_index=idx, op_type=op_type)
            if start < 0 or end < start or end > len(current):
                raise DocOpsError("range is out of bounds", op_index=idx, op_type=op_type)

            replacement = ""
            if op_type == "replace_range":
                replacement = _require_str(
                    raw_op.get("contentMd"),
                    "contentMd",
                    op_index=idx,
                    op_type=op_type,
                )
                replacement = _normalize_text(replacement)
            current = f"{current[:start]}{replacement}{current[end:]}"
            applied.append(
                AppliedOp(
                    index=idx,
                    op_type=op_type,
                    status="applied",
                    details={"from": start, "to": end, "replacement_length": len(replacement)},
                )
            )
            continue

        if op_type == "insert_at":
            position = _require_int(raw_op.get("position"), "position", op_index=idx, op_type=op_type)
            if position < 0 or position > len(current):
                raise DocOpsError("position is out of bounds", op_index=idx, op_type=op_type)
            content_value = _require_str(raw_op.get("contentMd"), "contentMd", op_index=idx, op_type=op_type)
            current = _insert_with_padding(current, position, content_value)
            applied.append(
                AppliedOp(
                    index=idx,
                    op_type=op_type,
                    status="applied",
                    details={"position": position, "content_length": len(content_value)},
                )
            )
            continue

        if op_type in {"insert_after_block", "insert_before_block"}:
            block_id = _require_str(raw_op.get("blockId"), "blockId", op_index=idx, op_type=op_type)
            content_value = _require_str(raw_op.get("contentMd"), "contentMd", op_index=idx, op_type=op_type)
            spans = _compute_chunk_spans(item_id, current)
            target = next((span for span in spans if span.block_id == block_id), None)
            if target is None:
                raise DocOpsError("blockId not found", op_index=idx, op_type=op_type)
            position = target.end if op_type == "insert_after_block" else target.start
            current = _insert_with_padding(current, position, content_value)
            applied.append(
                AppliedOp(
                    index=idx,
                    op_type=op_type,
                    status="applied",
                    details={"blockId": block_id, "position": position, "content_length": len(content_value)},
                )
            )
            continue

        raise DocOpsError(
            f"Unsupported operation: {op_type}",
            op_index=idx,
            op_type=op_type,
        )

    return current, applied
