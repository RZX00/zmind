"""Provenance slot on node/connection models (WS5-5). Requires pydantic; skipped otherwise."""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from core.canvas.api_models import CanvasConnection, CanvasNode  # noqa: E402


def test_node_accepts_provenance_and_ai_with_open_state():
    n = CanvasNode.model_validate(
        {
            "id": "n1", "type": "text", "x": 0, "y": 0, "width": 100, "height": 50, "content": "hi",
            "ai": True,
            "provenance": {"createdBy": {"actor": "agent", "model": "opus"}, "state": "draft"},
        }
    )
    assert n.ai is True
    assert n.provenance["createdBy"]["actor"] == "agent"
    assert n.provenance["state"] == "draft"  # open value preserved, never validated


def test_connection_accepts_provenance():
    c = CanvasConnection.model_validate({"id": "c1", "from": "a", "to": "b", "provenance": {"createdBy": {"actor": "human"}}})
    assert c.provenance["createdBy"]["actor"] == "human"


def test_node_without_provenance_still_parses():
    n = CanvasNode.model_validate({"id": "n2", "type": "text", "x": 0, "y": 0, "width": 1, "height": 1})
    assert n.provenance is None and n.ai is None
