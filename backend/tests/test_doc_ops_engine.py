from __future__ import annotations

import pytest

from core.docs.block_extractor import extract_doc_blocks
from core.docs.ops_engine import DocOpsError, apply_doc_ops


def test_apply_doc_ops_replace_range() -> None:
    content = "Hello world"
    next_content, applied = apply_doc_ops(
        "doc_1",
        content,
        [
            {
                "op": "replace_range",
                "range": {"from": 6, "to": 11},
                "contentMd": "Zmind",
            }
        ],
    )
    assert next_content == "Hello Zmind"
    assert len(applied) == 1
    assert applied[0].op_type == "replace_range"


def test_apply_doc_ops_insert_after_block() -> None:
    content = "# Title\n\nParagraph one."
    blocks = extract_doc_blocks("doc_2", content)
    first_block_id = blocks[0].block_id
    next_content, applied = apply_doc_ops(
        "doc_2",
        content,
        [
            {
                "op": "insert_after_block",
                "blockId": first_block_id,
                "contentMd": "## Added section",
            }
        ],
    )
    assert "## Added section" in next_content
    assert len(applied) == 1
    assert applied[0].op_type == "insert_after_block"


def test_apply_doc_ops_raises_for_invalid_range() -> None:
    with pytest.raises(DocOpsError) as exc:
        apply_doc_ops(
            "doc_3",
            "abc",
            [
                {
                    "op": "delete_range",
                    "range": {"from": 10, "to": 12},
                }
            ],
        )
    assert exc.value.op_type == "delete_range"
