from __future__ import annotations

from core.langgraph_engine.tools import policy


TRIGGER_METHODS = {
    "create_scheduled_trigger",
    "get_scheduled_triggers",
    "delete_scheduled_trigger",
    "toggle_scheduled_trigger",
    "list_event_trigger_apps",
    "list_app_event_triggers",
    "create_event_trigger",
}


def test_trigger_methods_removed_when_trigger_tool_disabled(monkeypatch) -> None:
    all_tools = set(TRIGGER_METHODS) | {"web_search"}
    monkeypatch.setattr(policy, "_all_static_tool_names", lambda: all_tools)

    result = policy.resolve_tool_policy(
        {"native_tools": {"trigger_tool": False}},
        mcp_enabled=False,
    )

    assert result.source == "native_tools"
    assert result.allowed_names is not None
    assert "web_search" in result.allowed_names
    for method in TRIGGER_METHODS:
        assert method not in result.allowed_names


def test_trigger_methods_present_when_trigger_tool_enabled(monkeypatch) -> None:
    all_tools = set(TRIGGER_METHODS) | {"web_search"}
    monkeypatch.setattr(policy, "_all_static_tool_names", lambda: all_tools)

    result = policy.resolve_tool_policy(
        {"native_tools": {"trigger_tool": True}},
        mcp_enabled=False,
    )

    assert result.source == "native_tools"
    assert result.allowed_names is not None
    for method in TRIGGER_METHODS:
        assert method in result.allowed_names
