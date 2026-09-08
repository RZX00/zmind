import json

from core.canvas.api import _deserialize_tool_output


def test_deserialize_tool_output_parses_json_string():
    payload = {"canvas": {"id": "canvas-123"}, "applied": ["op"]}
    raw = json.dumps(payload)

    assert _deserialize_tool_output(raw) == payload


def test_deserialize_tool_output_handles_invalid_json():
    raw = "plain text"

    assert _deserialize_tool_output(raw) == {"raw_output": raw}


def test_deserialize_tool_output_handles_none_and_dict():
    assert _deserialize_tool_output(None) == {}

    payload = {"canvas": {"title": "Test"}}
    assert _deserialize_tool_output(payload) == payload
