from core.langgraph_engine.tools.catalog import build_registry
from core.langgraph_engine.tools.doc_surface import DOC_SURFACE_ALLOWED_TOOL_NAMES, is_doc_surface_tool_allowed


def test_doc_surface_allowlist_contains_doc_native_tools() -> None:
    assert "doc_read_context" in DOC_SURFACE_ALLOWED_TOOL_NAMES
    assert "doc_list_blocks" in DOC_SURFACE_ALLOWED_TOOL_NAMES
    assert "doc_apply_ops" in DOC_SURFACE_ALLOWED_TOOL_NAMES
    assert "doc_generate_image_and_insert" in DOC_SURFACE_ALLOWED_TOOL_NAMES
    assert "doc_undo_revision" in DOC_SURFACE_ALLOWED_TOOL_NAMES
    assert "doc_get_revision" in DOC_SURFACE_ALLOWED_TOOL_NAMES
    assert "doc_update_title" in DOC_SURFACE_ALLOWED_TOOL_NAMES


def test_doc_surface_allowlist_blocks_canvas_and_task_tools() -> None:
    assert is_doc_surface_tool_allowed("doc_apply_ops") is True
    assert is_doc_surface_tool_allowed("doc_generate_image_and_insert") is True
    assert is_doc_surface_tool_allowed("doc_update_title") is True
    assert is_doc_surface_tool_allowed("canvas_write") is False
    assert is_doc_surface_tool_allowed("task") is False
    assert is_doc_surface_tool_allowed("transfer_to_canvas_agent") is False


def test_doc_surface_registry_only_exports_allowlisted_tools() -> None:
    registry = build_registry(
        mcp_service=None,
        allowed_names=set(DOC_SURFACE_ALLOWED_TOOL_NAMES),
        allowed_prefixes=None,
    )
    tool_names = {tool.name for tool in registry.list_tools()}
    assert tool_names
    assert "doc_apply_ops" in tool_names
    assert "doc_generate_image_and_insert" in tool_names
    assert "doc_read_context" in tool_names
    assert "doc_update_title" in tool_names
    assert "canvas_write" not in tool_names
    assert "task" not in tool_names
