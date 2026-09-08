from __future__ import annotations

from core.langgraph_engine.nodes import call_model


def _tool(name: str) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": name,
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    }


def test_trim_tools_for_first_turn_reduces_schema(monkeypatch) -> None:
    monkeypatch.delenv("LANGGRAPH_FIRST_TURN_MINIMAL_TOOLS", raising=False)
    monkeypatch.delenv("LANGGRAPH_FIRST_TURN_MINIMAL_TOOL_NAMES", raising=False)
    monkeypatch.delenv("LANGGRAPH_FIRST_TURN_MIN_TOOL_MIN_COUNT", raising=False)

    tools_schema = [
        _tool("canvas_read"),
        _tool("canvas_write"),
        _tool("canvas_edit"),
        _tool("run_skill"),
        _tool("web_search"),
        _tool("complete"),
        _tool("transfer_to_canvas_agent"),
        _tool("people_search"),
        _tool("company_search"),
        _tool("analyze_data"),
    ]

    trimmed = call_model._trim_tools_for_first_turn(
        tools_schema,
        iteration=0,
        latest_user_text="请在画布生成一张信息图并补充节点",
    )

    trimmed_names = {tool["function"]["name"] for tool in trimmed}
    assert len(trimmed) < len(tools_schema)
    assert "canvas_read" in trimmed_names
    assert "canvas_write" in trimmed_names
    assert "transfer_to_canvas_agent" in trimmed_names
    assert "people_search" not in trimmed_names


def test_trim_tools_for_later_iterations_keeps_schema(monkeypatch) -> None:
    monkeypatch.delenv("LANGGRAPH_FIRST_TURN_MINIMAL_TOOLS", raising=False)
    tools_schema = [_tool("canvas_read"), _tool("company_search"), _tool("transfer_to_canvas_agent")]

    trimmed = call_model._trim_tools_for_first_turn(
        tools_schema,
        iteration=2,
        latest_user_text="随便",
    )

    assert trimmed == tools_schema


def test_disable_tool_streaming_on_problematic_model_and_intent(monkeypatch) -> None:
    monkeypatch.delenv("LLM_DISABLE_TOOL_STREAMING", raising=False)
    monkeypatch.delenv("LLM_DISABLE_TOOL_STREAMING_MODELS", raising=False)
    monkeypatch.delenv("LLM_DISABLE_TOOL_STREAMING_FIRST_TURN_ONLY", raising=False)
    monkeypatch.delenv("LLM_DISABLE_TOOL_STREAMING_REQUIRE_INTENT", raising=False)

    disabled = call_model._should_disable_tool_streaming(
        model_name="habitat/gpt-5.4",
        tools_schema=[_tool("canvas_read")],
        tool_choice="auto",
        iteration=0,
        latest_user_text="请帮我在画布更新节点",
    )

    assert disabled is True


def test_keep_tool_streaming_without_tool_intent(monkeypatch) -> None:
    monkeypatch.delenv("LLM_DISABLE_TOOL_STREAMING", raising=False)
    monkeypatch.delenv("LLM_DISABLE_TOOL_STREAMING_MODELS", raising=False)
    monkeypatch.delenv("LLM_DISABLE_TOOL_STREAMING_FIRST_TURN_ONLY", raising=False)
    monkeypatch.delenv("LLM_DISABLE_TOOL_STREAMING_REQUIRE_INTENT", raising=False)

    disabled = call_model._should_disable_tool_streaming(
        model_name="habitat/gpt-5.4",
        tools_schema=[_tool("canvas_read")],
        tool_choice="auto",
        iteration=0,
        latest_user_text="你好，介绍一下这个系统",
    )

    assert disabled is False


def test_skip_nonstream_retry_when_content_already_generated(monkeypatch) -> None:
    monkeypatch.delenv("LLM_TOOL_PARSE_RETRY_ENABLED", raising=False)
    monkeypatch.delenv("LLM_TOOL_PARSE_RETRY_ONLY_NO_CONTENT", raising=False)

    should_retry = call_model._should_retry_nonstream_tool_parse(
        tool_calls_buf={"t1": {"name": "canvas_write", "arguments": "{}"}},
        tool_schema_summaries={"canvas_write": {"required": ["nodes"], "properties": ["nodes"]}},
        accumulated_content="Here is a useful direct answer",
    )

    assert should_retry is False


def test_retry_nonstream_parse_when_no_content(monkeypatch) -> None:
    monkeypatch.delenv("LLM_TOOL_PARSE_RETRY_ENABLED", raising=False)
    monkeypatch.delenv("LLM_TOOL_PARSE_RETRY_ONLY_NO_CONTENT", raising=False)

    should_retry = call_model._should_retry_nonstream_tool_parse(
        tool_calls_buf={"t1": {"name": "canvas_write", "arguments": "{}"}},
        tool_schema_summaries={"canvas_write": {"required": ["nodes"], "properties": ["nodes"]}},
        accumulated_content="",
    )

    assert should_retry is True


def test_retry_nonstream_parse_for_critical_tool_even_with_content(monkeypatch) -> None:
    monkeypatch.delenv("LLM_TOOL_PARSE_RETRY_ENABLED", raising=False)
    monkeypatch.delenv("LLM_TOOL_PARSE_RETRY_ONLY_NO_CONTENT", raising=False)
    monkeypatch.delenv("LLM_TOOL_PARSE_RETRY_CRITICAL_TOOLS", raising=False)

    should_retry = call_model._should_retry_nonstream_tool_parse(
        tool_calls_buf={"t1": {"name": "transfer_to_canvas_agent", "arguments": "{}"}},
        tool_schema_summaries={"transfer_to_canvas_agent": {"required": [], "properties": ["task", "context"]}},
        accumulated_content="先给用户一句说明，再走工具",
    )

    assert should_retry is True


def test_retry_nonstream_parse_for_doc_apply_ops_even_with_content(monkeypatch) -> None:
    monkeypatch.delenv("LLM_TOOL_PARSE_RETRY_ENABLED", raising=False)
    monkeypatch.delenv("LLM_TOOL_PARSE_RETRY_ONLY_NO_CONTENT", raising=False)
    monkeypatch.delenv("LLM_TOOL_PARSE_RETRY_CRITICAL_TOOLS", raising=False)

    should_retry = call_model._should_retry_nonstream_tool_parse(
        tool_calls_buf={"t1": {"name": "doc_apply_ops", "arguments": "{}"}},
        tool_schema_summaries={
            "doc_apply_ops": {
                "required": ["base_version"],
                "properties": ["base_version", "ops", "doc_item_id"],
            }
        },
        accumulated_content="我先解释一下，然后再调用工具",
    )

    assert should_retry is True


def test_retry_nonstream_parse_for_doc_generate_image_even_with_content(monkeypatch) -> None:
    monkeypatch.delenv("LLM_TOOL_PARSE_RETRY_ENABLED", raising=False)
    monkeypatch.delenv("LLM_TOOL_PARSE_RETRY_ONLY_NO_CONTENT", raising=False)
    monkeypatch.delenv("LLM_TOOL_PARSE_RETRY_CRITICAL_TOOLS", raising=False)

    should_retry = call_model._should_retry_nonstream_tool_parse(
        tool_calls_buf={"t1": {"name": "doc_generate_image_and_insert", "arguments": "{}"}},
        tool_schema_summaries={
            "doc_generate_image_and_insert": {
                "required": ["prompt"],
                "properties": ["prompt", "summary", "quantity", "aspect_ratio"],
            }
        },
        accumulated_content="先给你解释，再调用图像工具",
    )

    assert should_retry is True


def test_hydrate_transfer_to_canvas_agent_args_from_latest_user_text() -> None:
    hydrated, changed = call_model._hydrate_minimal_tool_args(
        name="transfer_to_canvas_agent",
        parsed={},
        latest_user_text="请读取当前画布并继续编辑",
    )

    assert changed is True
    assert hydrated.get("task") == "请读取当前画布并继续编辑"


def test_hydrate_canvas_read_with_scope_all_when_empty() -> None:
    hydrated, changed = call_model._hydrate_minimal_tool_args(
        name="canvas_read",
        parsed={},
        latest_user_text="",
    )

    assert changed is True
    assert hydrated == {"scope": "all"}


def test_hydrate_doc_update_title_from_quoted_user_text() -> None:
    hydrated, changed = call_model._hydrate_minimal_tool_args(
        name="doc_update_title",
        parsed={},
        latest_user_text='把文档标题改成“Docker 部署实战教程”',
    )

    assert changed is True
    assert hydrated == {"title": "Docker 部署实战教程"}


def test_hydrate_doc_generate_image_prompt_from_latest_user_text() -> None:
    hydrated, changed = call_model._hydrate_minimal_tool_args(
        name="doc_generate_image_and_insert",
        parsed={},
        latest_user_text="生成一张 Docker Build Ship Run 的 16:9 信息图",
    )

    assert changed is True
    assert hydrated == {"prompt": "生成一张 Docker Build Ship Run 的 16:9 信息图"}


def test_doc_update_title_min_requirements_require_nonempty_title() -> None:
    assert call_model._tool_args_satisfy_min_requirements("doc_update_title", {"title": "New Title"}) is True
    assert call_model._tool_args_satisfy_min_requirements("doc_update_title", {"title": ""}) is False
    assert call_model._tool_args_satisfy_min_requirements("doc_update_title", {}) is False


def test_doc_generate_image_min_requirements_require_nonempty_prompt() -> None:
    assert (
        call_model._tool_args_satisfy_min_requirements(
            "doc_generate_image_and_insert",
            {"prompt": "Draw a modern cloud architecture image"},
        )
        is True
    )
    assert call_model._tool_args_satisfy_min_requirements("doc_generate_image_and_insert", {"prompt": ""}) is False
    assert call_model._tool_args_satisfy_min_requirements("doc_generate_image_and_insert", {}) is False


def test_tool_calls_missing_required_arg_names_detects_doc_update_title() -> None:
    missing = call_model._tool_calls_missing_required_arg_names(
        tool_calls_buf={"t1": {"name": "doc_update_title", "arguments": "{}"}},
        tool_schema_summaries={"doc_update_title": {"required": ["title"], "properties": ["title", "doc_item_id"]}},
    )

    assert "doc_update_title" in missing


def test_tool_calls_missing_required_arg_names_detects_doc_generate_image() -> None:
    missing = call_model._tool_calls_missing_required_arg_names(
        tool_calls_buf={"t1": {"name": "doc_generate_image_and_insert", "arguments": "{}"}},
        tool_schema_summaries={
            "doc_generate_image_and_insert": {
                "required": ["prompt"],
                "properties": ["prompt", "summary", "quantity", "aspect_ratio"],
            }
        },
    )

    assert "doc_generate_image_and_insert" in missing


def test_backfill_doc_update_title_from_doc_apply_ops_h1() -> None:
    pending = [
        {
            "id": "tc_apply",
            "name": "doc_apply_ops",
            "arguments": {
                "ops": [
                    {
                        "op": "replace_document",
                        "contentMd": "# Docker 实战\n\n正文",
                    }
                ]
            },
            "raw": {},
        },
        {
            "id": "tc_title",
            "name": "doc_update_title",
            "arguments": {},
            "raw": {},
        },
    ]

    patched = call_model._backfill_doc_update_title_from_pending_tool_calls(pending)

    assert patched == 1
    assert pending[1]["arguments"]["title"] == "Docker 实战"
    assert pending[1]["raw"]["arguments_hydrated"] is True
    assert pending[1]["raw"]["arguments_hydrated_source"] == "doc_apply_ops_h1"


def test_backfill_doc_update_title_does_not_override_existing_title() -> None:
    pending = [
        {
            "id": "tc_apply",
            "name": "doc_apply_ops",
            "arguments": {
                "ops": [
                    {
                        "op": "replace_document",
                        "contentMd": "# 新标题\n\n正文",
                    }
                ]
            },
            "raw": {},
        },
        {
            "id": "tc_title",
            "name": "doc_update_title",
            "arguments": {"title": "手工标题"},
            "raw": {},
        },
    ]

    patched = call_model._backfill_doc_update_title_from_pending_tool_calls(pending)

    assert patched == 0
    assert pending[1]["arguments"]["title"] == "手工标题"


def test_trim_messages_by_token_budget_keeps_recent_messages(monkeypatch) -> None:
    def fake_counter(*, model=None, messages=None, text=None):
        if messages is not None:
            return len(messages) * 100
        if text is not None:
            return len(str(text))
        return 0

    monkeypatch.setattr(call_model, "token_counter", fake_counter)

    messages = [
        {"role": "system", "content": "sys-1"},
        {"role": "system", "content": "sys-2"},
        {"role": "user", "content": "u1"},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "u2"},
        {"role": "assistant", "content": "a2"},
        {"role": "user", "content": "u3"},
        {"role": "assistant", "content": "a3"},
    ]

    trimmed = call_model._trim_messages_by_token_budget(
        messages,
        llm_model="habitat/gpt-5.4",
        max_prompt_tokens=450,
        min_tail_messages=3,
        max_system_messages=2,
    )

    assert len(trimmed) <= len(messages)
    assert trimmed[0]["role"] == "system"
    assert trimmed[-1]["content"] == "a3"
    assert trimmed[-2]["content"] == "u3"


def test_retry_empty_doc_response_when_fallback_exists(monkeypatch) -> None:
    monkeypatch.delenv("LLM_EMPTY_DOC_RESPONSE_RETRY_ENABLED", raising=False)

    should_retry = call_model._should_retry_empty_doc_response(
        interaction_surface="doc",
        attempt_index=0,
        chain_len=2,
    )

    assert should_retry is True


def test_no_retry_empty_doc_response_on_last_attempt(monkeypatch) -> None:
    monkeypatch.delenv("LLM_EMPTY_DOC_RESPONSE_RETRY_ENABLED", raising=False)

    should_retry = call_model._should_retry_empty_doc_response(
        interaction_surface="doc",
        attempt_index=1,
        chain_len=2,
    )

    assert should_retry is False


def test_empty_response_fallback_text_uses_chinese_copy_for_cjk_prompt() -> None:
    text = call_model._empty_response_fallback_text("请继续优化这篇文档")
    assert "抱歉" in text


def test_resolve_fallback_chain_adds_claude_for_habitat_primary(monkeypatch) -> None:
    monkeypatch.setattr(call_model.config, "LLM_FALLBACK_MODELS", "", raising=False)

    chain = call_model._resolve_fallback_chain("habitat/gemini-3.5-flash")

    assert chain[0] == "habitat/gemini-3.5-flash"
    assert "habitat/claude-sonnet-4-6" in chain
