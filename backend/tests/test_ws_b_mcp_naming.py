from core.langgraph_engine.tools.mcp_naming import (
    legacy_clean_alias,
    make_mcp_tool_name,
    plan_mcp_names,
)


def test_mcp_primary_name_is_stable_and_snake_case():
    name = make_mcp_tool_name("Custom Composio: Google Drive", "List-Files.v2")
    assert name == "mcp__custom_composio_google_drive__list_files_v2"


def test_mcp_legacy_alias_conflict_is_skipped_with_warning():
    existing = set()

    first = plan_mcp_names(server_qualified="server_a", tool_name="mcp_server_a_search", existing_names=existing)
    assert first.primary_name == "mcp__server_a__mcp_server_a_search"
    # With tighter collision guards, legacy alias is trimmed to avoid prefix clashes.
    assert first.aliases == ["a_search"]
    assert first.skipped_aliases == []
    assert first.warnings == []
    existing.update([first.primary_name, *first.aliases])

    second = plan_mcp_names(server_qualified="server_b", tool_name="mcp_server_b_search", existing_names=existing)
    assert second.primary_name == "mcp__server_b__mcp_server_b_search"
    # Legacy alias remains because it does not collide with existing names after trimming.
    assert second.aliases == ["b_search"]
    assert second.skipped_aliases == []
    assert second.warnings == []


def test_legacy_clean_alias_matches_old_wrapper_convention():
    assert legacy_clean_alias("mcp_google_search") == "search"
    assert legacy_clean_alias("custom_composio_google_drive") == "google_drive"


def test_same_tool_name_on_different_servers_gets_unique_primary_and_skips_alias_on_conflict():
    existing: set[str] = set()

    first = plan_mcp_names(server_qualified="server_one", tool_name="search", existing_names=existing)
    existing.update([first.primary_name, *first.aliases])

    second = plan_mcp_names(server_qualified="server_two", tool_name="search", existing_names=existing)

    assert first.primary_name == "mcp__server_one__search"
    assert second.primary_name == "mcp__server_two__search"
    assert second.aliases == []
    assert "alias_conflict:search" in second.warnings
