import json
from pathlib import Path

from core.langgraph_engine.tools.sanitizer import (
    lint_openai_tool_schema,
    sanitize_openai_tool_schema,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures" / "ws_b_schemas"


def _load(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


def test_ws_b_sanitizer_removes_forbidden_constructs():
    # These fixtures intentionally contain v1-forbidden constructs (anyOf/oneOf/$ref/$defs/const/type-list).
    for fixture_name in ("ask.json", "canvas_edit.json", "mcp_sample.json"):
        raw = _load(fixture_name)

        raw_issues = lint_openai_tool_schema(raw)
        assert raw_issues, f"fixture should contain forbidden constructs: {fixture_name}"

        sanitized, warnings = sanitize_openai_tool_schema(raw)
        assert warnings, f"sanitizer should emit downgrade warnings: {fixture_name}"

        sanitized_issues = lint_openai_tool_schema(sanitized)
        assert sanitized_issues == [], f"sanitized schema must be v1-compatible: {fixture_name}"

        params = sanitized["function"]["parameters"]
        assert isinstance(params, dict)
        assert params.get("type") == "object"
        assert isinstance(params.get("properties"), dict)


def test_ws_b_sanitizer_drops_pydantic_optional_null_union():
    raw = {
        "type": "function",
        "function": {
            "name": "example",
            "description": "optional schema",
            "parameters": {
                "type": "object",
                "properties": {
                    "maybe": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"},
                        ]
                    }
                },
                "required": [],
            },
        },
    }

    sanitized, _warnings = sanitize_openai_tool_schema(raw)
    issues = lint_openai_tool_schema(sanitized)
    assert issues == []
    assert sanitized["function"]["parameters"]["properties"]["maybe"]["type"] == "string"
