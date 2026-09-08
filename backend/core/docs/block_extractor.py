from __future__ import annotations

from dataclasses import dataclass
import hashlib
import re


HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


def _slugify(text: str) -> str:
    normalized = re.sub(r"\s+", "-", text.strip().lower())
    normalized = re.sub(r"[^a-z0-9\-\u4e00-\u9fff]", "", normalized)
    normalized = normalized.strip("-")
    return normalized or "block"


@dataclass
class ExtractedBlock:
    block_id: str
    item_id: str
    block_type: str
    anchor: str
    text_preview: str
    hash: str
    order_index: int


def extract_doc_blocks(item_id: str, content_md: str) -> list[ExtractedBlock]:
    lines = (content_md or "").replace("\r\n", "\n").split("\n")
    if not lines:
        return []

    chunks: list[list[str]] = []
    current: list[str] = []

    for line in lines:
        if line.strip() == "":
            if current:
                chunks.append(current)
                current = []
            continue
        current.append(line)

    if current:
        chunks.append(current)

    if not chunks:
        return []

    used_anchors: dict[str, int] = {}
    blocks: list[ExtractedBlock] = []

    for idx, chunk_lines in enumerate(chunks):
        joined = "\n".join(chunk_lines).strip()
        first_line = chunk_lines[0].strip()
        heading_match = HEADING_RE.match(first_line)
        if heading_match:
            block_type = f"heading_{len(heading_match.group(1))}"
            anchor_seed = heading_match.group(2).strip()
        else:
            block_type = "paragraph"
            anchor_seed = first_line[:64]

        base_anchor = _slugify(anchor_seed)
        seen_count = used_anchors.get(base_anchor, 0)
        used_anchors[base_anchor] = seen_count + 1
        anchor = base_anchor if seen_count == 0 else f"{base_anchor}-{seen_count + 1}"

        content_hash = hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]
        block_id = f"{item_id}:b:{idx + 1}:{content_hash}"
        preview = re.sub(r"\s+", " ", joined)
        if len(preview) > 220:
            preview = f"{preview[:217]}..."

        blocks.append(
            ExtractedBlock(
                block_id=block_id,
                item_id=item_id,
                block_type=block_type,
                anchor=anchor,
                text_preview=preview,
                hash=content_hash,
                order_index=idx,
            )
        )

    return blocks
