from core.canvas.workspace_context import (
    build_workspace_scope_metadata,
    extract_workspace_query_keywords,
    resolve_target_canvas_from_message,
)


def test_build_workspace_scope_metadata_detects_explicit_global_read():
    metadata = build_workspace_scope_metadata("请跨画布检索所有画布里的路线图信息")
    assert metadata["mode"] == "global_read"
    assert metadata["explicit_global_read"] is True


def test_build_workspace_scope_metadata_defaults_to_local_mode():
    metadata = build_workspace_scope_metadata("在当前画布补充一个总结节点")
    assert metadata["mode"] == "local"
    assert metadata["explicit_global_read"] is False


def test_extract_workspace_query_keywords_filters_noise():
    keywords = extract_workspace_query_keywords("请在整个工作区搜索 roadmap architecture sync 文档")
    assert "roadmap" in [item.lower() for item in keywords]
    assert "architecture" in [item.lower() for item in keywords]
    assert "工作区" not in keywords


def test_resolve_target_canvas_from_message_unique_match():
    target, ambiguous = resolve_target_canvas_from_message(
        "请在《产品路线图》画布新增一个里程碑节点",
        [
            {"id": "c1", "title": "产品路线图"},
            {"id": "c2", "title": "会议纪要"},
        ],
    )
    assert ambiguous == []
    assert target == {"canvas_id": "c1", "title": "产品路线图"}


def test_resolve_target_canvas_from_message_ambiguous_match():
    target, ambiguous = resolve_target_canvas_from_message(
        "把这个更新到路线图画布",
        [
            {"id": "c1", "title": "产品路线图"},
            {"id": "c2", "title": "增长路线图"},
        ],
    )
    assert target is None
    assert "产品路线图" in ambiguous
    assert "增长路线图" in ambiguous
