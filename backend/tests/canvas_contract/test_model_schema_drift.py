"""Model<->schema drift guards (review follow-ups).

- CanvasNode.groupMode must allow exactly the schema's GroupNode.groupMode enum.
- legacy groupMode values normalize instead of rejecting (back-compat on load).
- CanvasNode declares `ai` exactly once (a duplicate field was a merge artifact).
Requires pydantic; runs in the WSL pytest venv, no network.
"""

from __future__ import annotations

import json
import re
import typing
from pathlib import Path

import pytest

pytest.importorskip("pydantic")

from core.canvas.api_models import CanvasNode  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads((ROOT / "schemas" / "canvas-schema.json").read_text(encoding="utf-8"))
MODELS_SRC = (ROOT / "backend" / "core" / "canvas" / "api_models.py").read_text(encoding="utf-8")


def _literal_values(annotation) -> set:
    # Optional[Literal[...]] -> Union[Literal[...], None]; dig out the Literal args.
    for arg in typing.get_args(annotation):
        if typing.get_origin(arg) is typing.Literal:
            return set(typing.get_args(arg))
    if typing.get_origin(annotation) is typing.Literal:
        return set(typing.get_args(annotation))
    return set()


def test_group_mode_matches_schema_enum():
    model_modes = _literal_values(CanvasNode.model_fields["groupMode"].annotation)
    schema_modes = set(SCHEMA["$defs"]["GroupNode"]["properties"]["groupMode"]["enum"])
    assert model_modes == schema_modes == {"mindmap", "normal"}


def test_legacy_group_mode_normalizes_not_rejects():
    n = CanvasNode.model_validate(
        {"id": "g", "type": "group", "x": 0, "y": 0, "width": 1, "height": 1, "groupMode": "container"}
    )
    assert n.groupMode == "normal"  # folded, not a ValidationError


def test_ai_field_declared_exactly_once():
    assert "ai" in CanvasNode.model_fields
    # guard against re-introducing the duplicate field declaration
    block = MODELS_SRC.split("class CanvasNode", 1)[1].split("class CanvasDoc", 1)[0]
    assert len(re.findall(r"^\s*ai\s*:", block, re.M)) == 1
