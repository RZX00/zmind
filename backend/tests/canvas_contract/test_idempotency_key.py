"""Deterministic idempotency key (ID-1/ID-2/WRITE-5) — replay-safe write dedup.
ops_normalization imports standalone; offline pytest."""

from __future__ import annotations

from core.canvas.ops_normalization import compute_idempotency_key

OPS = [{"op": "add_node", "node": {"id": "n1", "type": "text"}}]


def test_same_batch_same_key():
    assert compute_idempotency_key("c1", OPS, 3) == compute_idempotency_key("c1", list(OPS), 3)


def test_different_ops_different_key():
    other = [{"op": "add_node", "node": {"id": "n2", "type": "text"}}]
    assert compute_idempotency_key("c1", OPS, 3) != compute_idempotency_key("c1", other, 3)


def test_version_and_canvas_are_part_of_the_key():
    assert compute_idempotency_key("c1", OPS, 3) != compute_idempotency_key("c1", OPS, 4)
    assert compute_idempotency_key("c1", OPS, 3) != compute_idempotency_key("c2", OPS, 3)


def test_prefix_and_shape():
    k = compute_idempotency_key("c1", OPS, None, prefix="canvas_v2")
    assert k.startswith("canvas_v2:") and len(k.split(":", 1)[1]) == 32


def test_key_is_order_stable_for_equal_dicts():
    a = compute_idempotency_key("c1", [{"op": "move_node", "id": "n1", "x": 1, "y": 2}], 1)
    b = compute_idempotency_key("c1", [{"y": 2, "x": 1, "id": "n1", "op": "move_node"}], 1)
    assert a == b  # sort_keys makes dict key order irrelevant
