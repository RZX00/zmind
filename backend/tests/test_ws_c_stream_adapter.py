import json
from pathlib import Path

from core.langgraph_engine.stream import LegacyStreamAdapter, normalize_terminal_status


def test_ws_c_stream_adapter_golden_fixture():
    fixture_path = Path(__file__).parent / "golden" / "ws_c_stream_adapter.json"
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))

    events = payload["events"]
    expected = payload["expected_chunks"]
    assert len(events) == len(expected)

    adapter = LegacyStreamAdapter()
    actual = [adapter.to_legacy_chunk(e) for e in events]
    assert actual == expected


def test_ws_c_stream_adapter_accepts_missing_sequence():
    adapter = LegacyStreamAdapter()
    event = {
        "type": "assistant_chunk",
        "timestamp": "2025-01-01T00:00:00Z",
        "agent_run_id": "ar",
        "thread_id": "th",
        "content": "hi",
    }
    chunk = adapter.to_legacy_chunk(event)  # should not raise
    assert chunk["content"] == "{\"role\": \"assistant\", \"content\": \"hi\"}"
    assert "sequence" not in chunk


def test_ws_c_stream_adapter_llm_response_end_with_assistant_message_and_metadata():
    adapter = LegacyStreamAdapter()
    event = {
        "type": "llm_response_end",
        "timestamp": "2025-01-01T00:00:04Z",
        "agent_run_id": "ar_test_meta",
        "thread_id": "th_test_meta",
        "thread_run_id": "tr_test_meta",
        "message_id": "msg_llm_end_meta",
        "llm_response_id": "llm_meta",
        "model": "openai/gpt-4o-mini",
        "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        "finish_reason": "stop",
        "assistant_message": {"role": "assistant", "content": "Final", "tool_calls": None},
        "metadata": {"custom": "meta"},
    }

    chunk = adapter.to_legacy_chunk(event)
    content = json.loads(chunk["content"])
    metadata = json.loads(chunk["metadata"])

    assert content["choices"][0]["message"] == event["assistant_message"]
    assert metadata == {
        "thread_run_id": "tr_test_meta",
        "custom": "meta",
        "llm_response_id": "llm_meta",
    }


def test_normalize_terminal_status_maps_synonyms():
    assert normalize_terminal_status("error") == "failed"
    assert normalize_terminal_status("run_completed") == "completed"
    assert normalize_terminal_status("run_failed") == "failed"
    assert normalize_terminal_status("stopped") == "stopped"
