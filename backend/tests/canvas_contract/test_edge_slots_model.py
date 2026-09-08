"""CanvasConnection typed-edge slots — pydantic model contract (WS5-1).

Requires pydantic; skipped in a pytest-only environment. Run in the real backend venv.
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from core.canvas.api_models import CanvasConnection  # noqa: E402


def test_connection_accepts_typed_edge_slots():
    c = CanvasConnection.model_validate(
        {"id": "conn-1", "from": "a", "to": "b", "relation": "reference", "directed": True, "relationData": {"w": 3}}
    )
    assert c.relation == "reference"
    assert c.directed is True
    assert c.relationData == {"w": 3}
    dumped = c.model_dump(by_alias=True)
    assert dumped["relation"] == "reference" and dumped["directed"] is True


def test_old_connection_without_slots_still_parses():
    c = CanvasConnection.model_validate({"id": "conn-2", "from": "a", "to": "b"})
    assert c.relation is None and c.directed is None and c.relationData is None


def test_relation_value_is_open_and_unvalidated():
    c = CanvasConnection.model_validate({"id": "c3", "from": "a", "to": "b", "relation": "anything-goes-xyzzy"})
    assert c.relation == "anything-goes-xyzzy"
