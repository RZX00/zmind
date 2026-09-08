from __future__ import annotations

from pydantic import BaseModel

from core.langgraph_engine.contracts import ToolSpec
from core.langgraph_engine.tools import registry as registry_module


class _Args(BaseModel):
    value: str


async def _dummy_handler(_args, _context):
    return {
        "tool_call_id": "x",
        "name": "test_tool",
        "success": True,
        "started_at": "2026-01-01T00:00:00+00:00",
        "ended_at": "2026-01-01T00:00:00+00:00",
    }


def test_default_tool_schema_sanitizer_reuses_cached_result(monkeypatch) -> None:
    calls = 0

    def fake_sanitize(_raw_schema):
        nonlocal calls
        calls += 1
        return (
            {
                "type": "function",
                "function": {
                    "name": "test_tool",
                    "description": "test",
                    "parameters": {
                        "type": "object",
                        "properties": {"value": {"type": "string"}},
                        "required": ["value"],
                        "additionalProperties": False,
                    },
                },
            },
            [],
        )

    monkeypatch.setattr(registry_module, "sanitize_openai_tool_schema", fake_sanitize)
    monkeypatch.setattr(registry_module, "lint_openai_tool_schema", lambda *_args, **_kwargs: [])

    registry_module._SCHEMA_SANITIZE_CACHE.clear()
    registry_module._SCHEMA_SANITIZE_WARNINGS_LOGGED.clear()
    try:
        sanitizer = registry_module.DefaultToolSchemaSanitizer()
        tool = ToolSpec(
            name="test_tool",
            description="test",
            args_model=_Args,
            handler=_dummy_handler,
        )

        schema_a = sanitizer.sanitize_openai_tool_schema(tool)
        schema_b = sanitizer.sanitize_openai_tool_schema(tool)
    finally:
        registry_module._SCHEMA_SANITIZE_CACHE.clear()
        registry_module._SCHEMA_SANITIZE_WARNINGS_LOGGED.clear()

    assert calls == 1
    assert schema_a == schema_b
