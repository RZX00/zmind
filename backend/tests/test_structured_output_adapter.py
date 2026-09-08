import pytest

from core.langgraph_engine.tools.adapters.structured_output_adapter import wrap_raw_output


@pytest.mark.unit
def test_wrap_raw_output_attaches_metadata() -> None:
    result = {
        "tool_call_id": "call_1",
        "name": "tool_x",
        "success": True,
        "started_at": "now",
        "ended_at": "later",
        "output": {"ok": True},
    }
    wrapped = wrap_raw_output(result)
    metadata = wrapped.get("metadata") or {}
    structured = metadata.get("structured_output") or {}
    assert structured.get("type") == "raw"
    assert structured.get("payload", {}).get("raw_output") == {"ok": True}


@pytest.mark.unit
def test_wrap_raw_output_no_override() -> None:
    result = {
        "tool_call_id": "call_1",
        "name": "tool_x",
        "success": True,
        "started_at": "now",
        "ended_at": "later",
        "output": {"ok": True},
        "metadata": {"structured_output": {"type": "summary", "payload": {"text": "done"}}},
    }
    wrapped = wrap_raw_output(result)
    assert wrapped["metadata"]["structured_output"]["type"] == "summary"
