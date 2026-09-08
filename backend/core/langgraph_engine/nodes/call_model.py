from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Dict, Mapping, Optional

from litellm.utils import token_counter

from core.ai_models import model_manager
from core.langgraph_engine.contracts.event_schema import (
    AssistantChunkEvent,
    AssistantFinalEvent,
    EngineEvent,
    LLMResponseEndEvent,
    StatusEvent,
)
from core.langgraph_engine.contracts.state_schema import GraphState
from core.langgraph_engine.contracts.tool_interface import ToolCall, ToolRegistry
from core.services.llm import make_llm_api_call
from core.utils.config import config
from core.utils.logger import logger

TOOLS_REQUIRE_NONEMPTY_ARGS: set[str] = {
    "canvas_create_connection",
    "canvas_edit",
    "canvas_write",
    "doc_update_title",
    "task",
    "transfer_to_canvas_agent",
}

DEFAULT_TOOL_PARSE_RETRY_CRITICAL_TOOLS: tuple[str, ...] = (
    "doc_apply_ops",
    "doc_generate_image_and_insert",
    "doc_update_title",
    "transfer_to_canvas_agent",
    "task",
)

DEFAULT_FIRST_TURN_MINIMAL_TOOLS: tuple[str, ...] = (
    "ask",
    "cta",
    "complete",
    "task",
    "run_skill",
    "list_skills",
    "expand_message",
    "web_search",
)

DEFAULT_TOOL_STREAMING_DISABLE_MODEL_MARKERS: tuple[str, ...] = (
    "habitat/gemini-3.1-pro",
    "habitat/gpt-5.4",
)

TOOL_INTENT_KEYWORDS: tuple[str, ...] = (
    "canvas",
    "画布",
    "节点",
    "node",
    "连接",
    "连线",
    "ppt",
    "presentation",
    "slide",
    "搜索",
    "research",
    "web",
    "api",
    "集成",
    "上传",
    "文件",
    "技能",
    "skill",
    "生成",
    "create",
    "更新",
    "edit",
)


def _normalize_interaction_surface(value: Any) -> str:
    cleaned = str(value or "").strip().lower()
    if cleaned in {"doc", "document"}:
        return "doc"
    if cleaned == "canvas":
        return "canvas"
    return ""


def _contains_cjk(text: str) -> bool:
    for ch in str(text or ""):
        code = ord(ch)
        if (
            0x3400 <= code <= 0x4DBF
            or 0x4E00 <= code <= 0x9FFF
            or 0x20000 <= code <= 0x2A6DF
            or 0x2A700 <= code <= 0x2B73F
            or 0x2B740 <= code <= 0x2B81F
            or 0x2B820 <= code <= 0x2CEAF
            or 0xF900 <= code <= 0xFAFF
        ):
            return True
    return False


def _empty_response_fallback_text(latest_user_text: str) -> str:
    if _contains_cjk(latest_user_text):
        return "抱歉，我这次没有拿到可用的模型输出。请重试一次，或切换到另一个模型。"
    return "Sorry, I did not receive a usable model output this time. Please retry or switch to another model."


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return default


def _env_csv(name: str, default: tuple[str, ...]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return [item for item in default if item]
    values = [item.strip() for item in raw.split(",")]
    return [item for item in values if item]


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return max(minimum, int(float(raw)))
    except Exception:
        return default


def _latest_user_text(messages: list[dict[str, Any]]) -> str:
    for message in reversed(messages):
        if str(message.get("role") or "").strip().lower() != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for part in content:
                if isinstance(part, dict):
                    text = part.get("text")
                    if isinstance(text, str):
                        parts.append(text)
            if parts:
                return "\n".join(parts)
    return ""


def _message_token_count(llm_model: str, msg: dict[str, Any]) -> int:
    try:
        return int(token_counter(model=llm_model, messages=[msg]))
    except Exception:
        return max(1, len(str(msg)) // 4)


def _trim_messages_by_token_budget(
    messages: list[dict[str, Any]],
    *,
    llm_model: str,
    max_prompt_tokens: int,
    min_tail_messages: int,
    max_system_messages: int,
) -> list[dict[str, Any]]:
    if not messages or max_prompt_tokens <= 0:
        return messages
    try:
        total_tokens = int(token_counter(model=llm_model, messages=messages))
    except Exception:
        return messages
    if total_tokens <= max_prompt_tokens:
        return messages

    system_messages: list[dict[str, Any]] = []
    non_system_messages: list[dict[str, Any]] = []
    for msg in messages:
        role = str(msg.get("role") or "").strip().lower()
        if role == "system" and len(system_messages) < max_system_messages:
            system_messages.append(msg)
        else:
            non_system_messages.append(msg)

    selected_tail: list[dict[str, Any]] = []
    budget_used = 0
    system_budget = 0
    if system_messages:
        try:
            system_budget = int(token_counter(model=llm_model, messages=system_messages))
        except Exception:
            system_budget = sum(_message_token_count(llm_model, msg) for msg in system_messages)
    remaining_budget = max(256, max_prompt_tokens - system_budget)

    for msg in reversed(non_system_messages):
        msg_tokens = _message_token_count(llm_model, msg)
        if len(selected_tail) < min_tail_messages:
            selected_tail.append(msg)
            budget_used += msg_tokens
            continue
        if budget_used + msg_tokens > remaining_budget:
            continue
        selected_tail.append(msg)
        budget_used += msg_tokens

    selected_tail.reverse()
    trimmed = [*system_messages, *selected_tail]
    if not trimmed:
        return messages[-min_tail_messages:] if min_tail_messages > 0 else messages
    return trimmed


def _looks_like_tool_intent(message_text: str) -> bool:
    if not message_text:
        return False
    normalized = message_text.strip().lower()
    return any(keyword in normalized for keyword in TOOL_INTENT_KEYWORDS)


def _trim_tools_for_first_turn(
    tools_schema: list[dict[str, Any]],
    *,
    iteration: int,
    latest_user_text: str,
) -> list[dict[str, Any]]:
    if iteration > 0:
        return tools_schema
    if not _env_flag("LANGGRAPH_FIRST_TURN_MINIMAL_TOOLS", True):
        return tools_schema
    if not tools_schema:
        return tools_schema

    allow_names = set(_env_csv("LANGGRAPH_FIRST_TURN_MINIMAL_TOOL_NAMES", DEFAULT_FIRST_TURN_MINIMAL_TOOLS))
    if _looks_like_tool_intent(latest_user_text):
        if any(token in latest_user_text.lower() for token in ("ppt", "slide", "presentation", "演示", "幻灯")):
            allow_names.add("render_presentation")
        if any(token in latest_user_text.lower() for token in ("search", "research", "web", "查", "搜")):
            allow_names.update({"web_search", "scrape_webpage", "extract_web_content"})
        if any(token in latest_user_text.lower() for token in ("canvas", "画布", "节点", "连线", "图")):
            allow_names.update({"workspace_list_canvases", "canvas_read", "canvas_write", "canvas_edit"})

    filtered: list[dict[str, Any]] = []
    for tool in tools_schema:
        fn = tool.get("function") if isinstance(tool, dict) else None
        name = fn.get("name") if isinstance(fn, dict) else None
        if not isinstance(name, str) or not name:
            continue
        if name in allow_names or name.startswith("transfer_to_"):
            filtered.append(tool)

    min_count_raw = os.getenv("LANGGRAPH_FIRST_TURN_MIN_TOOL_MIN_COUNT", "6")
    try:
        min_count = max(1, int(min_count_raw))
    except Exception:
        min_count = 6
    if len(filtered) < min_count:
        return tools_schema
    return filtered


def _should_disable_tool_streaming(
    *,
    model_name: str,
    tools_schema: Optional[list[dict[str, Any]]],
    tool_choice: str,
    iteration: int,
    latest_user_text: str,
) -> bool:
    if not tools_schema or tool_choice == "none":
        return False
    if not _env_flag("LLM_DISABLE_TOOL_STREAMING", True):
        return False
    if _env_flag("LLM_DISABLE_TOOL_STREAMING_FIRST_TURN_ONLY", True) and iteration > 0:
        return False
    if _env_flag("LLM_DISABLE_TOOL_STREAMING_REQUIRE_INTENT", True) and not _looks_like_tool_intent(latest_user_text):
        return False

    markers = _env_csv("LLM_DISABLE_TOOL_STREAMING_MODELS", DEFAULT_TOOL_STREAMING_DISABLE_MODEL_MARKERS)
    normalized_model = (model_name or "").strip().lower()
    return any(marker.lower() in normalized_model for marker in markers)


def _should_retry_nonstream_tool_parse(
    *,
    tool_calls_buf: dict[str, dict[str, Any]],
    tool_schema_summaries: dict[str, dict[str, Any]],
    accumulated_content: str,
) -> bool:
    missing_tools = _tool_calls_missing_required_arg_names(tool_calls_buf, tool_schema_summaries)
    if not missing_tools:
        return False
    if not _env_flag("LLM_TOOL_PARSE_RETRY_ENABLED", True):
        return False
    if _env_flag("LLM_TOOL_PARSE_RETRY_ONLY_NO_CONTENT", True) and bool((accumulated_content or "").strip()):
        critical_tools = set(
            _env_csv("LLM_TOOL_PARSE_RETRY_CRITICAL_TOOLS", DEFAULT_TOOL_PARSE_RETRY_CRITICAL_TOOLS)
        )
        if not missing_tools.intersection(critical_tools):
            return False
    return True


def _should_retry_empty_doc_response(*, interaction_surface: str, attempt_index: int, chain_len: int) -> bool:
    if interaction_surface != "doc":
        return False
    if attempt_index >= max(0, chain_len - 1):
        return False
    return _env_flag("LLM_EMPTY_DOC_RESPONSE_RETRY_ENABLED", True)


def _resolve_tool_parse_retry_model(primary_model: str) -> str:
    override = (os.getenv("LLM_TOOL_PARSE_RETRY_MODEL") or "").strip()
    return override or primary_model


def _tool_args_satisfy_min_requirements(name: str, parsed: Any) -> bool:
    if not isinstance(parsed, dict):
        return False
    if name == "canvas_write":
        return bool(parsed.get("nodes") or parsed.get("tree"))
    if name == "canvas_edit":
        return bool(
            parsed.get("$delete")
            or parsed.get("delete")
            or parsed.get("$select")
            or parsed.get("select")
            or parsed.get("$set")
            or parsed.get("set")
            or parsed.get("$transform")
            or parsed.get("transform")
            or parsed.get("$operations")
            or parsed.get("operations")
            or parsed.get("$connections")
            or parsed.get("connections")
            or parsed.get("$canvas")
            or parsed.get("canvas")
            or any(k for k in parsed.keys() if not str(k).startswith("$"))
        )
    if name == "transfer_to_canvas_agent":
        return bool(parsed.get("task") or parsed.get("context"))
    if name == "task":
        return bool(
            parsed.get("subagent_type")
            or parsed.get("subagent")
            or parsed.get("agent")
            or parsed.get("agent_type")
            or parsed.get("task_run_id")
            or parsed.get("taskRunId")
            or parsed.get("session_id")
            or parsed.get("sessionId")
        )
    if name == "doc_update_title":
        return bool(str(parsed.get("title") or "").strip())
    if name == "doc_generate_image_and_insert":
        return bool(str(parsed.get("prompt") or "").strip())
    return True


def _extract_title_candidate_from_user_text(text: str) -> str:
    content = str(text or "").strip()
    if not content:
        return ""

    quote_patterns = [
        r"[“\"]([^“”\"\n]{1,180})[”\"]",
        r"[‘']([^‘’'\n]{1,180})[’']",
        r"《([^《》\n]{1,180})》",
    ]
    for pattern in quote_patterns:
        match = re.search(pattern, content)
        if not match:
            continue
        candidate = str(match.group(1) or "").strip()
        if candidate:
            return candidate

    keyword_patterns = [
        r"(?:标题|题目)\s*(?:改成|改为|设为|设置为|设置成|叫做|命名为|命名成|为|是|:|：)\s*(.+)$",
        r"(?:rename(?:\s+it)?\s+to|set(?:\s+the)?\s+title\s+to|title\s*(?:to|is|=|:))\s*(.+)$",
    ]
    for pattern in keyword_patterns:
        match = re.search(pattern, content, flags=re.IGNORECASE)
        if not match:
            continue
        candidate = str(match.group(1) or "").strip()
        candidate = candidate.strip(" \t\r\n\"'“”‘’《》。,.!?;:：")
        if candidate:
            return candidate

    return ""


def _extract_first_markdown_h1(content: Any) -> str:
    text = str(content or "").strip()
    if not text:
        return ""
    in_frontmatter = False
    for idx, line in enumerate(text.splitlines()):
        stripped = line.strip()
        if not stripped:
            continue
        if idx == 0 and stripped == "---":
            in_frontmatter = True
            continue
        if in_frontmatter:
            if stripped == "---":
                in_frontmatter = False
            continue
        if stripped.startswith("<!--"):
            continue
        if stripped.startswith("# "):
            title = stripped[2:].strip()
            if title:
                return title
        # Stop at first non-empty non-heading line to avoid scanning full body.
        break
    return ""


def _extract_title_candidate_from_doc_apply_ops_args(args: Any) -> str:
    if not isinstance(args, dict):
        return ""
    ops = args.get("ops")
    if not isinstance(ops, list):
        return ""
    for op in ops:
        if not isinstance(op, dict):
            continue
        op_name = str(op.get("op") or "").strip().lower()
        if op_name not in {"replace_document", "insert_at"}:
            continue
        if op_name == "insert_at":
            position_value = op.get("position")
            try:
                position = int(position_value)
            except Exception:
                position = None
            if position not in (0, None):
                continue
        content_md = op.get("contentMd")
        if content_md is None:
            content_md = op.get("content_md")
        title = _extract_first_markdown_h1(content_md)
        if title:
            return title
    return ""


def _backfill_doc_update_title_from_pending_tool_calls(pending: list[ToolCall]) -> int:
    if not pending:
        return 0

    inferred_title = ""
    for tc in pending:
        if str(tc.get("name") or "") != "doc_apply_ops":
            continue
        inferred_title = _extract_title_candidate_from_doc_apply_ops_args(tc.get("arguments"))
        if inferred_title:
            break

    if not inferred_title:
        return 0

    patched = 0
    for tc in pending:
        if str(tc.get("name") or "") != "doc_update_title":
            continue
        args = tc.get("arguments")
        if not isinstance(args, dict):
            continue
        if str(args.get("title") or "").strip():
            continue
        next_args = dict(args)
        next_args["title"] = inferred_title
        tc["arguments"] = next_args
        raw = tc.get("raw")
        if isinstance(raw, dict):
            raw["arguments_hydrated"] = True
            raw["arguments_hydrated_source"] = "doc_apply_ops_h1"
        patched += 1

    return patched


def _hydrate_minimal_tool_args(
    *,
    name: str,
    parsed: Any,
    latest_user_text: str,
) -> tuple[Any, bool]:
    source = parsed if isinstance(parsed, dict) else {}
    hydrated = dict(source)
    changed = False

    if name == "transfer_to_canvas_agent":
        has_task = bool(str(hydrated.get("task") or "").strip())
        has_context = bool(str(hydrated.get("context") or "").strip())
        if not has_task and not has_context:
            fallback_task = (latest_user_text or "").strip() or "Handle the user's latest request on the canvas."
            hydrated["task"] = fallback_task
            changed = True
    elif name == "canvas_read":
        if not hydrated:
            hydrated["scope"] = "all"
            changed = True
    elif name == "doc_update_title":
        has_title = bool(str(hydrated.get("title") or "").strip())
        if not has_title:
            inferred_title = _extract_title_candidate_from_user_text(latest_user_text)
            if inferred_title:
                hydrated["title"] = inferred_title
                changed = True
    elif name == "doc_generate_image_and_insert":
        has_prompt = bool(str(hydrated.get("prompt") or "").strip())
        if not has_prompt:
            fallback_prompt = str(latest_user_text or "").strip()
            if fallback_prompt:
                hydrated["prompt"] = fallback_prompt
                changed = True

    return (hydrated if changed else parsed), changed


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_json_loads(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
    except Exception:
        parsed = _extract_json_object(value)
        return parsed if isinstance(parsed, dict) else {}
    return parsed if isinstance(parsed, dict) else {}


def _safe_json_loads_any(value: str) -> Any:
    try:
        return json.loads(value)
    except Exception:
        return None


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    """Best-effort extraction of the first JSON object inside a string."""
    if not isinstance(text, str) or "{" not in text:
        return None
    start = text.find("{")
    depth = 0
    end = None
    for idx in range(start, len(text)):
        ch = text[idx]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = idx
                break
    if end is None:
        return None
    candidate = text[start:end + 1]
    try:
        parsed = json.loads(candidate)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def _parse_tool_calls_from_marked_text(text: str) -> tuple[str, list[dict[str, Any]]]:
    """Parse tool calls from <|tool_call_...|> marked text (non-standard LLM output)."""
    if not isinstance(text, str):
        return text, []

    tool_calls: list[dict[str, Any]] = []

    if "<|tool_call_begin|>" in text:
        pattern = re.compile(r"<\|tool_call_begin\|>(.*?)<\|tool_call_end\|>", re.S)
        for match in pattern.finditer(text):
            segment = (match.group(1) or "").strip()
            if not segment:
                continue
            name_part, _, args_part = segment.partition("<|tool_call_argument_begin|>")
            name_token = (name_part or "").strip().split()[0] if name_part else ""
            if name_token.startswith("functions."):
                name_token = name_token[len("functions."):]
            if ":" in name_token:
                name_token = name_token.split(":", 1)[0]
            name_token = name_token.strip()
            args_text = (args_part or "").strip()
            if "<|" in args_text:
                args_text = args_text.split("<|", 1)[0].strip()
            parsed_args = _safe_json_loads_any(args_text)
            if not isinstance(parsed_args, dict):
                parsed_args = _extract_json_object(args_text) or {}
            if name_token:
                tool_calls.append({"name": name_token, "arguments": parsed_args})

        cleaned = pattern.sub("", text)
        cleaned = cleaned.replace("<|tool_calls_section_begin|>", "").replace("<|tool_calls_section_end|>", "")
        return cleaned.strip(), tool_calls

    # Fallback: parse inline "functions.<name>:<idx> { ... }" patterns
    if "functions." not in text:
        return text, []

    cleaned_parts: list[str] = []
    idx = 0
    pattern = re.compile(r"functions\.([A-Za-z0-9_]+)(?::\d+)?")
    while idx < len(text):
        match = pattern.search(text, idx)
        if not match:
            cleaned_parts.append(text[idx:])
            break
        abs_start = match.start()
        abs_end = match.end()
        cleaned_parts.append(text[idx:abs_start])
        name_token = (match.group(1) or "").strip()

        brace_start = text.find("{", abs_end)
        if brace_start == -1:
            cleaned_parts.append(text[abs_start:])
            break

        depth = 0
        end_idx = None
        for i in range(brace_start, len(text)):
            ch = text[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end_idx = i
                    break
        if end_idx is None:
            cleaned_parts.append(text[abs_start:])
            break

        args_text = text[brace_start:end_idx + 1]
        parsed_args = _safe_json_loads_any(args_text)
        if not isinstance(parsed_args, dict):
            parsed_args = _extract_json_object(args_text) or {}
        if name_token:
            tool_calls.append({"name": name_token, "arguments": parsed_args})

        idx = end_idx + 1

    cleaned = "".join(cleaned_parts).strip()
    return cleaned, tool_calls


def _strip_const(obj: Any) -> Any:
    """Remove any 'const' keys from tool schemas to satisfy stricter gateways (e.g., Gemini)."""
    if isinstance(obj, dict):
        cleaned = {}
        for k, v in obj.items():
            if k == "const":
                continue
            cleaned[k] = _strip_const(v)
        return cleaned
    if isinstance(obj, list):
        return [_strip_const(v) for v in obj]
    return obj


def _parse_fallback_models(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    raw = raw.strip()
    if not raw:
        return []
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = None
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
        logger.warning("Failed to parse LLM_FALLBACK_MODELS as JSON list; falling back to comma split")
    items = [item.strip() for item in raw.replace(";", ",").split(",")]
    return [item for item in items if item]


def _resolve_fallback_chain(primary_model: str) -> list[str]:
    candidates = _parse_fallback_models(config.LLM_FALLBACK_MODELS)
    if not candidates and primary_model.startswith("habitat/"):
        candidates = [
            "habitat/gpt-5.6-sol",
            "habitat/gpt-5.6-terra",
            "habitat/gpt-5.6-luna",
        ]

    chain: list[str] = []
    seen: set[str] = set()

    def add(model_name: str) -> None:
        if not model_name:
            return
        resolved = model_manager.resolve_model_id(model_name) or model_name
        key = resolved.lower()
        if key in seen:
            return
        seen.add(key)
        chain.append(resolved)

    add(primary_model)
    for candidate in candidates:
        add(candidate)
    return chain


def _should_retry_llm_error(err: Exception) -> bool:
    if isinstance(err, asyncio.CancelledError):
        return False
    if isinstance(err, asyncio.TimeoutError):
        return True
    text = str(err).lower()
    retry_markers = (
        "timeout",
        "timed out",
        "read timeout",
        "connect",
        "connection",
        "bad gateway",
        "gateway",
        "overloaded",
        "rate limit",
        "429",
        "502",
        "503",
        "504",
    )
    return any(marker in text for marker in retry_markers)


async def _stream_with_timeout(stream: Any, idle_timeout_sec: int) -> Any:
    if not idle_timeout_sec or idle_timeout_sec <= 0:
        async for chunk in stream:
            yield chunk
        return

    while True:
        try:
            chunk = await asyncio.wait_for(stream.__anext__(), timeout=idle_timeout_sec)
        except StopAsyncIteration:
            return
        yield chunk


async def _call_llm_with_timeout(request_timeout_sec: int, **kwargs: Any) -> Any:
    if not request_timeout_sec or request_timeout_sec <= 0:
        return await make_llm_api_call(**kwargs)
    return await asyncio.wait_for(make_llm_api_call(**kwargs), timeout=request_timeout_sec)


def _as_dict(obj: Any) -> dict[str, Any] | None:
    if isinstance(obj, dict):
        return obj
    if obj is None:
        return None
    try:
        model_dump = getattr(obj, "model_dump", None)
        if callable(model_dump):
            try:
                dumped = model_dump(by_alias=True)
            except TypeError:
                dumped = model_dump()
            if isinstance(dumped, dict):
                return dumped
    except Exception:
        pass
    try:
        legacy_dump = getattr(obj, "dict", None)
        if callable(legacy_dump):
            try:
                dumped = legacy_dump(by_alias=True)
            except TypeError:
                dumped = legacy_dump()
            if isinstance(dumped, dict):
                return dumped
    except Exception:
        pass
    raw = getattr(obj, "__dict__", None)
    if isinstance(raw, dict) and raw:
        return raw
    return None


def _get_attr(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    try:
        if hasattr(obj, key):
            return getattr(obj, key)
    except Exception:
        pass
    mapped = _as_dict(obj)
    if isinstance(mapped, dict) and key in mapped:
        return mapped.get(key, default)
    return default


def _summarize_tools_schema(tools_schema: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    summaries: dict[str, dict[str, Any]] = {}
    for tool in tools_schema:
        if not isinstance(tool, dict):
            continue
        fn = tool.get("function")
        if not isinstance(fn, dict):
            continue
        name = fn.get("name")
        if not isinstance(name, str) or not name:
            continue
        params = fn.get("parameters") if isinstance(fn.get("parameters"), dict) else {}
        props = params.get("properties") if isinstance(params.get("properties"), dict) else {}
        required = params.get("required") if isinstance(params.get("required"), list) else []
        summaries[name] = {
            "tool": name,
            "required": list(required),
            "properties": list(props.keys()),
        }
    return summaries


def _summarize_tool_call_payload(tc: Any) -> dict[str, Any]:
    data = tc if isinstance(tc, dict) else _as_dict(tc)
    if isinstance(data, dict):
        keys = list(data.keys())
        tc_id, fn_name, fn_args, tc_index = _extract_tool_call_fields(data)
        args_type = type(fn_args).__name__ if fn_args is not None else None
        args_preview = None
        if isinstance(fn_args, str):
            args_preview = fn_args[:120]
        return {
            "keys": keys,
            "id": tc_id,
            "index": tc_index,
            "name": fn_name,
            "args_type": args_type,
            "args_preview": args_preview,
        }
    return {"type": type(tc).__name__}


def _extract_tool_call_fields(tc: Any) -> tuple[str | None, str | None, Any, int | None]:
    """Extract (id, name, args, index) from heterogeneous tool call payloads."""
    if not isinstance(tc, dict):
        tc_dict = _as_dict(tc)
        if isinstance(tc_dict, dict):
            return _extract_tool_call_fields(tc_dict)
    tc_id = (
        _get_attr(tc, "id", None)
        or _get_attr(tc, "tool_call_id", None)
        or _get_attr(tc, "toolCallId", None)
    )
    tc_index = (
        _get_attr(tc, "index", None)
        or _get_attr(tc, "tool_call_index", None)
        or _get_attr(tc, "toolCallIndex", None)
    )
    try:
        if tc_index is not None:
            tc_index = int(tc_index)
    except Exception:
        tc_index = None
    fn = (
        _get_attr(tc, "function", None)
        or _get_attr(tc, "function_call", None)
        or _get_attr(tc, "functionCall", None)
    )
    name = _get_attr(fn, "name", None) or _get_attr(tc, "name", None)

    args = None
    if fn is not None:
        if not isinstance(fn, dict):
            fn_dict = _as_dict(fn)
            if isinstance(fn_dict, dict):
                fn = fn_dict
        args = _get_attr(fn, "arguments", None)
        if args is None:
            args = _get_attr(fn, "args", None)
        if args is None:
            args = _get_attr(fn, "input", None)
    if args is None:
        args = _get_attr(tc, "arguments", None)
    if args is None:
        args = _get_attr(tc, "args", None)
    if args is None:
        args = _get_attr(tc, "input", None)

    return (str(tc_id) if tc_id else None), (str(name) if name else None), args, tc_index


def _tool_call_key(
    tc_id: str | None,
    tc_index: int | None,
    *,
    fallback_hint: str | None = None,
    index_map: dict[int, str] | None = None,
) -> str | None:
    if tc_id:
        key = str(tc_id)
        if index_map is not None and tc_index is not None:
            index_map.setdefault(tc_index, key)
        return key
    if index_map is not None and tc_index is not None and tc_index in index_map:
        return index_map[tc_index]
    if tc_index is not None:
        key = f"tool_call_{tc_index}"
        if index_map is not None:
            index_map.setdefault(tc_index, key)
        return key
    if fallback_hint:
        return f"tool_call_{fallback_hint}"
    return None


def _normalize_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return str(content)

_REASONING_PART_TYPES = {"analysis", "chain_of_thought", "reasoning", "thinking", "thought"}


def _is_reasoning_part(part: dict[str, Any]) -> bool:
    part_type = part.get("type")
    if isinstance(part_type, str) and part_type.lower() in _REASONING_PART_TYPES:
        return True
    for key in ("thought", "thinking", "reasoning"):
        if part.get(key) is True:
            return True
    return False


def _split_stream_content(content: Any) -> tuple[str, str, list[Any]]:
    text_parts: list[str] = []
    reasoning_parts: list[str] = []
    tool_calls: list[Any] = []

    if isinstance(content, dict):
        content = [content]

    if isinstance(content, list):
        for part in content:
            if isinstance(part, str):
                cleaned, parsed = _parse_tool_calls_from_marked_text(part)
                if cleaned:
                    text_parts.append(cleaned)
                if parsed:
                    tool_calls.extend(parsed)
                continue
            if not isinstance(part, dict):
                continue
            if "function_response" in part or "functionResponse" in part:
                continue

            is_reasoning = _is_reasoning_part(part)
            text = part.get("text")
            if isinstance(text, str):
                if is_reasoning:
                    reasoning_parts.append(text)
                else:
                    text_parts.append(text)
            elif isinstance(part.get("content"), str) and part.get("type") in (None, "text"):
                if is_reasoning:
                    reasoning_parts.append(str(part.get("content")))
                else:
                    text_parts.append(str(part.get("content")))

            for key in ("tool_calls", "toolCalls", "function_call", "functionCall", "tool_call", "toolCall"):
                if key in part:
                    tool_calls.append(part.get(key))
            part_type = part.get("type")
            if part_type in ("tool_call", "tool_use", "function_call", "functionCall"):
                tool_calls.append(part)
            elif any(k in part for k in ("name", "function", "args", "arguments", "input")):
                tool_calls.append(part)
    elif isinstance(content, str):
        text_parts.append(content)

    return ("".join(text_parts), "".join(reasoning_parts), tool_calls)


def _extract_tool_calls_from_content(content: Any) -> tuple[str, list[Any]]:
    text_parts: list[str] = []
    tool_calls: list[Any] = []
    if isinstance(content, list):
        for part in content:
            if isinstance(part, str):
                text_parts.append(part)
                continue
            if not isinstance(part, dict):
                continue
            if "function_response" in part or "functionResponse" in part:
                continue
            text = part.get("text")
            if isinstance(text, str):
                cleaned, parsed = _parse_tool_calls_from_marked_text(text)
                if cleaned:
                    text_parts.append(cleaned)
                if parsed:
                    tool_calls.extend(parsed)
            elif isinstance(part.get("content"), str) and part.get("type") in (None, "text"):
                cleaned, parsed = _parse_tool_calls_from_marked_text(str(part.get("content")))
                if cleaned:
                    text_parts.append(cleaned)
                if parsed:
                    tool_calls.extend(parsed)
            for key in ("tool_calls", "toolCalls", "function_call", "functionCall", "tool_call", "toolCall"):
                if key in part:
                    tool_calls.append(part.get(key))
            part_type = part.get("type")
            if part_type in ("tool_call", "tool_use", "function_call", "functionCall"):
                tool_calls.append(part)
            elif any(k in part for k in ("name", "function", "args", "arguments", "input")):
                tool_calls.append(part)
    elif isinstance(content, str):
        cleaned, parsed = _parse_tool_calls_from_marked_text(content)
        if cleaned:
            text_parts.append(cleaned)
        if parsed:
            tool_calls.extend(parsed)
    return ("".join(text_parts), tool_calls)


def _extract_tool_calls_from_response(response: Any) -> list[Any]:
    choices = _get_attr(response, "choices", []) or []
    choice0 = choices[0] if choices else None
    message = _get_attr(choice0, "message", None)
    tool_calls = _get_attr(message, "tool_calls", None)
    if tool_calls is None:
        tool_calls = _get_attr(message, "function_call", None) or _get_attr(message, "functionCall", None) or []
    if not tool_calls:
        tool_calls = _get_attr(response, "tool_calls", None) or _get_attr(response, "function_call", None) or _get_attr(response, "functionCall", None) or []
    if not tool_calls:
        content = _get_attr(message, "content", None) or _get_attr(message, "parts", None)
        if isinstance(content, list):
            _, content_tool_calls = _extract_tool_calls_from_content(content)
            if content_tool_calls:
                tool_calls = content_tool_calls
    if isinstance(tool_calls, dict):
        tool_calls = [tool_calls]
    return tool_calls if isinstance(tool_calls, list) else []


def _extract_tool_call_name_map(messages: list[dict[str, Any]]) -> dict[str, str]:
    name_map: dict[str, str] = {}
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        tool_calls = msg.get("tool_calls")
        if not tool_calls:
            continue
        if isinstance(tool_calls, str):
            try:
                tool_calls = json.loads(tool_calls)
            except Exception:
                continue
        if isinstance(tool_calls, dict):
            tool_calls = [tool_calls]
        if not isinstance(tool_calls, list):
            continue
        for tc in tool_calls:
            tc_id, fn_name, _, tc_index = _extract_tool_call_fields(tc)
            key = _tool_call_key(tc_id, tc_index, fallback_hint=fn_name)
            if not key or not fn_name:
                continue
            name_map[str(key)] = str(fn_name)
    return name_map


def _infer_tool_message_name(msg: dict[str, Any], name_map: dict[str, str]) -> str | None:
    name = msg.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()

    metadata = msg.get("metadata")
    if isinstance(metadata, dict):
        frontend = metadata.get("frontend_content")
        if isinstance(frontend, dict):
            tool_exec = frontend.get("tool_execution")
            if isinstance(tool_exec, dict):
                fn_name = tool_exec.get("function_name") or tool_exec.get("name")
                if isinstance(fn_name, str) and fn_name.strip():
                    return fn_name.strip()

    tool_call_id = msg.get("tool_call_id")
    if tool_call_id is not None:
        mapped = name_map.get(str(tool_call_id))
        if mapped:
            return mapped

    return None


def _normalize_tool_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not messages:
        return messages
    name_map = _extract_tool_call_name_map(messages)
    normalized: list[dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict) or msg.get("role") != "tool":
            normalized.append(msg)
            continue
        inferred = _infer_tool_message_name(msg, name_map)
        if not inferred:
            fallback = msg.get("tool_call_id")
            if fallback is not None:
                inferred = str(fallback)
            else:
                inferred = "unknown_tool"
        if inferred:
            if msg.get("name") != inferred:
                new_msg = dict(msg)
                new_msg["name"] = inferred
                normalized.append(new_msg)
            else:
                normalized.append(msg)
            continue
        normalized.append(msg)
    return normalized


def _approx_token_count(text: str) -> int:
    if not text:
        return 0
    return max(1, int(len(text) / 4))


def _resolve_timeout_seconds(value: Any, default: int) -> int:
    try:
        resolved = int(value)
    except Exception:
        resolved = int(default)
    if resolved <= 0:
        return int(default)
    return min(resolved, 3600)


def _tool_calls_missing_required_arg_names(
    tool_calls_buf: dict[str, dict[str, Any]],
    tool_schema_summaries: dict[str, dict[str, Any]],
) -> set[str]:
    missing: set[str] = set()
    if not tool_calls_buf or not tool_schema_summaries:
        return missing
    for data in tool_calls_buf.values():
        name = data.get("name") or ""
        if not name:
            continue
        schema = tool_schema_summaries.get(name) or {}
        required = schema.get("required") or []
        args_str = data.get("arguments")
        if not isinstance(args_str, str) or not args_str.strip():
            if required or name in TOOLS_REQUIRE_NONEMPTY_ARGS:
                missing.add(name)
            continue
        parsed = _safe_json_loads(args_str)
        if isinstance(parsed, dict):
            if any(req not in parsed for req in required):
                missing.add(name)
                continue
            if name in TOOLS_REQUIRE_NONEMPTY_ARGS and not parsed:
                missing.add(name)
                continue
            if not _tool_args_satisfy_min_requirements(name, parsed):
                missing.add(name)
                continue
    return missing


def _tool_calls_missing_required_args(
    tool_calls_buf: dict[str, dict[str, Any]],
    tool_schema_summaries: dict[str, dict[str, Any]],
) -> bool:
    return bool(_tool_calls_missing_required_arg_names(tool_calls_buf, tool_schema_summaries))


def _estimate_usage(messages: list[dict[str, Any]], assistant_message: dict[str, Any], model_name: str) -> dict[str, Any]:
    prompt_tokens = 0
    completion_tokens = 0
    try:
        prompt_tokens = int(token_counter(model=model_name, messages=messages))
    except Exception:
        prompt_tokens = _approx_token_count(json.dumps(messages, default=str))

    completion_text = ""
    try:
        completion_text = _normalize_content(assistant_message.get("content"))
        tool_calls = assistant_message.get("tool_calls")
        if tool_calls:
            completion_text += json.dumps(tool_calls, default=str)
    except Exception:
        completion_text = ""

    try:
        completion_tokens = int(token_counter(model=model_name, text=completion_text))
    except Exception:
        completion_tokens = _approx_token_count(completion_text)

    return {
        "prompt_tokens": max(0, prompt_tokens),
        "completion_tokens": max(0, completion_tokens),
        "total_tokens": max(0, prompt_tokens + completion_tokens),
    }


def _format_tool_calls_for_message(pending: list[ToolCall]) -> list[dict[str, Any]]:
    formatted: list[dict[str, Any]] = []
    for tc in pending:
        if not isinstance(tc, dict):
            continue
        name = tc.get("name") or "tool"
        args = tc.get("arguments")
        if args is None:
            args = {}
        if not isinstance(args, str):
            try:
                args = json.dumps(args)
            except Exception:
                args = str(args)
        payload = {
            "type": "function",
            "function": {"name": name, "arguments": args},
        }
        call_id = tc.get("id")
        if call_id:
            payload["id"] = str(call_id)
        formatted.append(payload)
    return formatted


def _merge_tool_calls_from_message(
    tool_calls_buf: dict[str, dict[str, Any]],
    tool_calls: Any,
    *,
    index_map: dict[int, str] | None = None,
) -> None:
    if isinstance(tool_calls, dict):
        tool_calls = [tool_calls]
    if not isinstance(tool_calls, list):
        return
    for tc in tool_calls:
        tc_id, fn_name, fn_args, tc_index = _extract_tool_call_fields(tc)
        key = _tool_call_key(tc_id, tc_index, fallback_hint=fn_name, index_map=index_map)
        if not key:
            continue
        if fn_args is None:
            args_str = ""
        elif isinstance(fn_args, str):
            args_str = fn_args
        else:
            try:
                args_str = json.dumps(fn_args, ensure_ascii=False)
            except Exception:
                args_str = str(fn_args)
        existing = tool_calls_buf.setdefault(key, {"name": fn_name, "arguments": ""})
        if "call_summary" not in existing:
            existing["call_summary"] = _summarize_tool_call_payload(tc)
        if fn_name and not existing.get("name"):
            existing["name"] = fn_name
        if not args_str:
            continue
        existing_args_raw = existing.get("arguments") or ""
        if not existing_args_raw:
            existing["arguments"] = args_str
            continue
        parsed_existing = _safe_json_loads_any(existing_args_raw)
        parsed_new = _safe_json_loads_any(args_str)
        if isinstance(parsed_existing, dict) and isinstance(parsed_new, dict):
            merged = {**parsed_existing, **parsed_new}
            if merged != parsed_existing:
                try:
                    existing["arguments"] = json.dumps(merged, ensure_ascii=False)
                except Exception:
                    existing["arguments"] = args_str
        elif isinstance(parsed_existing, list) and isinstance(parsed_new, list):
            if len(parsed_new) >= len(parsed_existing):
                existing["arguments"] = args_str
        elif parsed_existing in (None, {}, []):
            existing["arguments"] = args_str


def _result_iteration(result: dict[str, Any]) -> int | None:
    metadata = result.get("metadata")
    if isinstance(metadata, dict):
        try:
            return int(metadata.get("iteration"))
        except Exception:
            return None
    return None


def _recent_tool_failures(state: GraphState) -> list[dict[str, Any]]:
    tool_results = state.get("tool_results") or []
    if not tool_results:
        return []
    current_iteration = int(state.get("iteration") or 0)
    target_iteration = current_iteration - 1 if current_iteration > 0 else current_iteration
    failures = [
        res
        for res in tool_results
        if not res.get("success", True) and _result_iteration(res) == target_iteration
    ]
    if failures:
        return failures
    # Fallback for older results without iteration metadata: check last result only.
    if all(_result_iteration(res) is None for res in tool_results):
        last_res = tool_results[-1]
        if not last_res.get("success", True):
            return [last_res]
    return []


def _detect_tool_loop(state: GraphState, window: int = 3) -> tuple[str, ...] | None:
    # Content-aware loop detection. Keying only on tool NAMES falsely flags legitimate
    # multi-step work (e.g. three sequential canvas_edit calls applying DIFFERENT ops, or
    # self-slicing a large canvas with different canvas_read scopes) as a loop and kills the
    # run. We only flag a loop when the same tool yields the SAME result with no progress.
    tool_results = state.get("tool_results") or []
    if not tool_results:
        return None
    grouped: dict[int, list[str]] = {}
    names_by_iter: dict[int, list[str]] = {}
    for res in tool_results:
        iter_val = _result_iteration(res)
        if iter_val is None:
            continue
        name = res.get("name")
        if not name:
            continue
        try:
            payload = res.get("error") if not res.get("success", True) else res.get("output")
            fingerprint = json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False)[:240]
        except Exception:
            fingerprint = ""
        grouped.setdefault(iter_val, []).append(f"{name}|{fingerprint}")
        names_by_iter.setdefault(iter_val, []).append(str(name))
    if len(grouped) < window:
        return None
    last_iters = sorted(grouped.keys())[-window:]
    signatures = [tuple(sorted(grouped.get(it, []))) for it in last_iters]
    if signatures and len(set(signatures)) == 1:
        # Report just the tool names (the content fingerprint is for detection only).
        return tuple(sorted({n for it in last_iters for n in names_by_iter.get(it, [])}))
    return None


def _summarize_tool_failures(failures: list[dict[str, Any]], limit: int = 360) -> str:
    """Concise error detail from failed tool results so the model can diagnose and self-correct
    (e.g. surface a CanvasWriteError {code, retryable, self_heal} or a validation message)."""
    parts: list[str] = []
    for f in (failures or [])[:3]:
        name = str(f.get("name") or "tool")
        err = f.get("error")
        if err in (None, "", {}):
            out = f.get("output")
            err = out if isinstance(out, (str, dict, list)) else None
        if isinstance(err, (dict, list)):
            try:
                err = json.dumps(err, ensure_ascii=False, default=str)
            except Exception:
                err = str(err)
        parts.append(f"{name}: {str(err)[:limit] if err else 'unknown error'}")
    return " | ".join(parts)


_CANVAS_MODIFY_KEYWORDS_CJK = (
    "创建", "添加", "新建", "插入", "删除", "断开", "改", "连", "分组", "成组", "组合",
    "移动", "重排", "整理", "对齐", "替换", "画", "标注", "组",
)
_CANVAS_MODIFY_KEYWORDS_EN = (
    "add", "create", "delete", "remove", "insert", "connect", "link", "move",
    "rename", "modify", "edit", "draw", "group", "arrange", "align", "layout",
    "reorganiz", "replace", "build",
)
# Explanatory / teaching intent — these requests should render as ONE rich node (a styled
# code html infographic / svg), not many plain text nodes or a mindmap.
_CANVAS_TEACH_KEYWORDS_CJK = (
    "讲解", "讲讲", "讲一下", "教学", "科普", "解释", "介绍", "说明", "概述", "扫盲", "入门", "原理",
)
_CANVAS_TEACH_KEYWORDS_EN = (
    "explain", "teach", "introduce", "overview", "guide to", "what is", "how does",
    "tutorial", "primer", "walk me through", "breakdown of",
)


def _canvas_modify_pending(state: GraphState, interaction_surface: str, latest_user_text: str) -> bool:
    """True when this is a canvas MODIFY request that has not written yet. Used to FORCE a tool
    call so the model cannot stall after canvas_read by replying with a prose plan. Flips false
    once a write op runs (-> the model may then give its text summary). Pure-read requests
    (no modify intent) are never forced."""
    if interaction_surface != "canvas":
        return False
    text = latest_user_text or ""
    low = text.lower()
    # Read-only / negated requests must NOT be treated as modify intent. The modify keyword
    # "改" also appears inside "别改/不改/只读不改", so guard explicitly before the keyword scan
    # — otherwise a pure-read query forces a write follow-through that never resolves.
    readonly_markers_cjk = ("只读", "别改", "别动", "不改", "不要改", "不要修改", "不修改", "勿改", "不删", "不要删")
    readonly_markers_en = ("read-only", "read only", "readonly", "don't change", "do not change",
                           "do not modify", "don't modify", "without chang", "no change")
    if any(m in text for m in readonly_markers_cjk) or any(m in low for m in readonly_markers_en):
        return False
    has_intent = any(k in text for k in _CANVAS_MODIFY_KEYWORDS_CJK) or any(k in low for k in _CANVAS_MODIFY_KEYWORDS_EN)
    if not has_intent:
        return False
    names = {str(r.get("name") or "") for r in (state.get("tool_results") or [])}
    return not (names & {"canvas_write", "canvas_edit"})


def _maybe_force_canvas_followthrough(state: GraphState, interaction_surface: str, latest_user_text: str) -> bool:
    """The model returned NO tool calls but a canvas MODIFY request is still unapplied (it likely
    replied with a prose 'plan'). Append a forceful nudge and signal the graph to loop back into
    call_model so the edit actually gets emitted. Bounded by a per-run cap to prevent looping."""
    if not _canvas_modify_pending(state, interaction_surface, latest_user_text):
        return False
    cap = _env_int("LLM_CANVAS_FOLLOWTHROUGH_MAX", 2, minimum=0)
    count = int(state.get("canvas_followthrough_count") or 0)
    if count >= cap:
        return False
    state["canvas_followthrough_count"] = count + 1
    mc = state.get("messages_context")
    if isinstance(mc, list):
        mc.append({
            "role": "system",
            "content": (
                "STOP — you replied with text/a plan but did NOT call any canvas tool, so the canvas is "
                "UNCHANGED and the request is NOT done. Prose does not modify the canvas; only tool calls do. "
                "Right now emit a single canvas_edit (or canvas_write) tool call whose operations apply the "
                "change you described. Do not write any more explanation before making that tool call."
            ),
        })
    return True


def _last_below_floor_presentation(state: GraphState) -> Optional[Dict[str, Any]]:
    """Scan canvas writes newest-first and return the most recent one that carries a
    presentation VERDICT: below_floor -> that dict (canvas is still unreadable); above-floor
    -> None (a later write already fixed it). Writes with no verdict (failed / no-op edits)
    are skipped so a failed move_node doesn't mask the earlier below-floor write — that was
    the bug that kept the repair loop from ever firing."""
    for r in reversed(state.get("tool_results") or []):
        if r.get("name") not in ("canvas_write", "canvas_edit"):
            continue
        out = r.get("output")
        # output may be a dict, a JSON string, or a double-encoded JSON string
        for _ in range(2):
            if isinstance(out, str):
                try:
                    out = json.loads(out)
                except Exception:
                    out = None
                    break
            else:
                break
        if isinstance(out, dict):
            pres = out.get("presentation")
            if isinstance(pres, dict):
                return pres if pres.get("below_floor") else None
        # no verdict on this write (failed / no-op) -> keep scanning further back
    return None


def _maybe_force_presentation_repair(state: GraphState, interaction_surface: str) -> bool:
    """The last canvas write scored BELOW the readability floor (e.g. a dead column). Inject
    the critic's concrete relayout suggestion and loop back so the agent RE-RENDERS into a
    readable shape — closing the perception->critique->repair loop in the live thin loop
    (no flagged subgraph). Bounded by a per-run cap whose counter is a declared graph channel
    so it actually holds across iterations (unlike the original followthrough-count bug)."""
    if interaction_surface != "canvas":
        return False
    pres = _last_below_floor_presentation(state)
    if not pres:
        return False
    cap = _env_int("LLM_CANVAS_PRESENTATION_REPAIR_MAX", 2, minimum=0)
    count = int(state.get("presentation_repair_count") or 0)
    if count >= cap:
        return False
    state["presentation_repair_count"] = count + 1
    findings = pres.get("findings") or []
    primary = next((f for f in findings if f.get("severity") == "error"), findings[0] if findings else {})
    detail = str(primary.get("detail") or "the layout is hard to read")
    mc = state.get("messages_context")
    if isinstance(mc, list):
        mc.append({
            "role": "system",
            "content": (
                f"PRESENTATION CHECK FAILED (readability score {pres.get('score')}): {detail} "
                "The content is written but the LAYOUT is an unreadable vertical column. Manual node "
                "moves will NOT fix this — STOP using mindmap/tree/nested groups and STOP emitting "
                "move_node. Instead: (1) DELETE every existing node ($delete all current ids), then "
                "(2) re-create the SAME content as a SINGLE `table` node (one row per item, columns like "
                "[类别, 要素, 说明]) via canvas_write nodes:[{type:'table', data:{rows:[...]}}] — a table "
                "renders compactly and is never a dead column. (If the content is truly a linear process, "
                "use a single `code` mermaid `flowchart` instead.) Emit that one corrective tool call now; "
                "do not summarize first. (Do NOT generate a large html document here — it can time out the "
                "gateway and lose the content.)"
            ),
        })
    return True


def _is_teach_request(interaction_surface: str, latest_user_text: str) -> bool:
    if interaction_surface != "canvas":
        return False
    text = latest_user_text or ""
    low = text.lower()
    return (any(k in text for k in _CANVAS_TEACH_KEYWORDS_CJK)
            or any(k in low for k in _CANVAS_TEACH_KEYWORDS_EN))


def _run_created_node_types(state: GraphState) -> set:
    """Node types created by canvas writes so far this run (from each write result's
    `created.nodes[].type`)."""
    types: set = set()
    for r in (state.get("tool_results") or []):
        if r.get("name") not in ("canvas_write", "canvas_edit"):
            continue
        out = r.get("output")
        for _ in range(2):
            if isinstance(out, str):
                try:
                    out = json.loads(out)
                except Exception:
                    out = None
                    break
            else:
                break
        if isinstance(out, dict):
            created = out.get("created") or {}
            for n in (created.get("nodes") or []):
                if isinstance(n, dict) and n.get("type"):
                    types.add(n.get("type"))
    return types


def _maybe_force_teach_rich(state: GraphState, interaction_surface: str, latest_user_text: str) -> bool:
    """An explanatory/teaching request that the model rendered as plain text nodes (not the
    rich format the user wants). If no `code` (html/svg) node and not a single `table` was
    produced, loop back once and force a single styled `code` html infographic. Bounded by a
    declared graph channel. Representation choice is semantic (prompt-guided), but THIS makes
    'teach -> rich node' an enforced outcome rather than a hope."""
    if not _is_teach_request(interaction_surface, latest_user_text):
        return False
    types = _run_created_node_types(state)
    if not types:
        return False  # nothing written yet (e.g. a read-only turn)
    if "code" in types or types == {"table"}:
        return False  # already a rich single representation
    cap = _env_int("LLM_CANVAS_TEACH_RICH_MAX", 1, minimum=0)
    count = int(state.get("teach_rich_count") or 0)
    if count >= cap:
        return False
    state["teach_rich_count"] = count + 1
    mc = state.get("messages_context")
    if isinstance(mc, list):
        mc.append({
            "role": "system",
            "content": (
                "This was an EXPLANATORY/teaching request (讲解/教学/解释), but you rendered it as plain "
                "nodes — that is NOT the rich format the user wants. Re-do it as ONE self-contained `code` "
                "html node: DELETE the current nodes ($delete all their ids), then emit canvas_write "
                "nodes:[{type:'code',codeType:'html',content:'<!DOCTYPE html>… a complete styled infographic "
                "— semantic sections, headings, color, cards, modern CSS layout …'}] (suggest width 960 "
                "height 680; content scrolls inside the node, height need not fit). Avoid localStorage/cookies/"
                "same-origin fetch and parent-page navigation (opaque-origin iframe). Emit that tool call now; "
                "do not summarize first."
            ),
        })
    return True


class DefaultCallModelNode:
    """
    Default model call node (streaming + function calling).

    This node:
    - streams AssistantChunkEvent while receiving tokens
    - collects tool_calls into state["pending_tool_calls"]
    - emits AssistantFinalEvent and LLMResponseEndEvent at the end of the model response
    """

    def __init__(self, tool_registry: Optional[ToolRegistry] = None) -> None:
        self._tool_registry = tool_registry

    async def __call__(self, state: GraphState, ctx: Any) -> GraphState:
        stop_event: Optional[asyncio.Event] = getattr(ctx, "stop_event", None)
        emit: Any = getattr(ctx, "emit")
        tool_context = getattr(ctx, "tool_context", {}) or {}
        interaction_mode = tool_context.get("interaction_mode")
        interaction_surface = _normalize_interaction_surface(tool_context.get("interaction_surface"))
        disable_tools = str(interaction_mode or "").strip().lower() == "chat"

        messages = state.get("messages_context") or []
        messages_for_llm = _normalize_tool_messages(list(messages))
        max_prompt_tokens = _env_int("LLM_HARD_PROMPT_TOKEN_LIMIT", 120_000, minimum=0)
        min_tail_messages = _env_int("LLM_HARD_PROMPT_MIN_TAIL_MESSAGES", 8, minimum=1)
        max_system_messages = _env_int("LLM_HARD_PROMPT_MAX_SYSTEM_MESSAGES", 2, minimum=0)
        if max_prompt_tokens > 0:
            trimmed_messages = _trim_messages_by_token_budget(
                messages_for_llm,
                llm_model=state["model_name"],
                max_prompt_tokens=max_prompt_tokens,
                min_tail_messages=min_tail_messages,
                max_system_messages=max_system_messages,
            )
            if len(trimmed_messages) != len(messages_for_llm):
                logger.info(
                    "Trimmed messages by prompt token budget",
                    agent_run_id=state.get("agent_run_id"),
                    original_count=len(messages_for_llm),
                    trimmed_count=len(trimmed_messages),
                    max_prompt_tokens=max_prompt_tokens,
                )
            messages_for_llm = trimmed_messages
        latest_user_text = _latest_user_text(messages_for_llm)

        forced_tool_payload = tool_context.get("forced_tool_call")
        if not disable_tools and isinstance(forced_tool_payload, dict):
            forced_tool_name = str(forced_tool_payload.get("tool") or "").strip()
            tool_spec = self._tool_registry.get(forced_tool_name) if (self._tool_registry and forced_tool_name) else None
            if not forced_tool_name:
                logger.warning(
                    "Forced tool call ignored due to missing tool name",
                    agent_run_id=state.get("agent_run_id"),
                )
                tool_context.pop("forced_tool_call", None)
            elif tool_spec is None:
                logger.warning(
                    "Forced tool call skipped because tool is unavailable",
                    tool=forced_tool_name,
                    agent_run_id=state.get("agent_run_id"),
                )
                tool_context.pop("forced_tool_call", None)
            else:
                forced_args: dict[str, Any] = {}
                raw_args = forced_tool_payload.get("arguments")
                if isinstance(raw_args, dict):
                    forced_args.update(raw_args)
                if forced_tool_name == "run_skill":
                    skill_id = forced_tool_payload.get("skill_id")
                    input_text = forced_tool_payload.get("input")
                    if isinstance(skill_id, str) and skill_id.strip():
                        forced_args["skill_id"] = skill_id.strip()
                    if isinstance(input_text, str) and input_text.strip():
                        forced_args["input"] = input_text.strip()
                    output_mode = forced_tool_payload.get("output_mode")
                    if isinstance(output_mode, str) and output_mode.strip():
                        forced_args["output_mode"] = output_mode.strip()

                if not forced_args:
                    logger.warning(
                        "Forced tool call ignored due to empty arguments",
                        tool=forced_tool_name,
                        agent_run_id=state.get("agent_run_id"),
                    )
                    tool_context.pop("forced_tool_call", None)
                else:
                    call_id = f"forced_{forced_tool_name}_{uuid.uuid4().hex[:10]}"
                    pending: list[ToolCall] = [
                        {
                            "id": call_id,
                            "name": forced_tool_name,
                            "arguments": forced_args,
                            "raw": {
                                "forced": True,
                                "reason": forced_tool_payload.get("reason"),
                                "score": forced_tool_payload.get("score"),
                                "threshold": forced_tool_payload.get("threshold"),
                            },
                        }
                    ]
                    state["pending_tool_calls"] = pending
                    tool_calls_payload = _format_tool_calls_for_message(pending)
                    assistant_message: dict[str, Any] = {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": tool_calls_payload,
                    }
                    messages_context = state.get("messages_context")
                    if not isinstance(messages_context, list):
                        messages_context = []
                        state["messages_context"] = messages_context
                    messages_context.append(assistant_message)

                    timestamp = _now_iso()
                    thread_run_id = f"tr_{uuid.uuid4().hex}"
                    await emit(
                        StatusEvent(
                            type="status",
                            timestamp=timestamp,
                            agent_run_id=state["agent_run_id"],
                            thread_id=state["thread_id"],
                            thread_run_id=thread_run_id,
                            iteration=state.get("iteration"),
                            message_id=str(uuid.uuid4()),
                            status_type="forced_tool_call",
                            data={
                                "tool_name": forced_tool_name,
                                "reason": forced_tool_payload.get("reason"),
                            },
                        )
                    )
                    await emit(
                        AssistantFinalEvent(
                            type="assistant_final",
                            timestamp=timestamp,
                            agent_run_id=state["agent_run_id"],
                            thread_id=state["thread_id"],
                            thread_run_id=thread_run_id,
                            iteration=state.get("iteration"),
                            message_id=str(uuid.uuid4()),
                            content=assistant_message,
                            metadata={
                                "engine": state.get("engine"),
                                "engine_version": state.get("engine_version"),
                                "forced_tool_call": True,
                            },
                        )
                    )
                    await emit(
                        LLMResponseEndEvent(
                            type="llm_response_end",
                            timestamp=timestamp,
                            agent_run_id=state["agent_run_id"],
                            thread_id=state["thread_id"],
                            thread_run_id=thread_run_id,
                            iteration=state.get("iteration"),
                            message_id=str(uuid.uuid4()),
                            llm_response_id=f"forced_{uuid.uuid4().hex}",
                            model=state["model_name"],
                            usage={},
                            finish_reason="tool_calls",
                            assistant_message=assistant_message,
                            metadata={
                                "tool_choice": "forced",
                                "engine": state.get("engine"),
                                "engine_version": state.get("engine_version"),
                                "forced_tool_call": True,
                            },
                        )
                    )

                    tool_context["forced_tool_call_consumed"] = True
                    tool_context.pop("forced_tool_call", None)
                    state["termination"] = {"should_terminate": False, "reason": "has_tool_calls"}
                    return state

        tool_failures = _recent_tool_failures(state)
        tool_loop_signature = _detect_tool_loop(state)
        # SELF-HEAL: give the model a bounded number of chances to diagnose a tool failure,
        # FIX its arguments, and retry WITH tools still available — instead of disabling tools
        # and ending the run on the first error (the prior behavior). Capped to avoid infinite
        # retry; the content-aware loop detector guards genuine no-progress loops.
        max_self_heal = _env_int("LLM_MAX_SELF_HEAL_ATTEMPTS", 2, minimum=0)
        self_heal_count = int(state.get("self_heal_count") or 0)
        self_healing = (
            bool(tool_failures)
            and not disable_tools
            and not tool_loop_signature
            and self_heal_count < max_self_heal
        )
        tool_failure_names = []
        if tool_failures:
            for failure in tool_failures:
                name = failure.get("name")
                if name:
                    tool_failure_names.append(str(name))
            failure_list = ", ".join(sorted(set(tool_failure_names))) if tool_failure_names else "tool"
            if self_healing:
                state["self_heal_count"] = self_heal_count + 1
                failure_detail = _summarize_tool_failures(tool_failures)
                messages_for_llm.append(
                    {
                        "role": "system",
                        "content": (
                            f"A tool call FAILED (self-heal attempt {self_heal_count + 1} of {max_self_heal}). "
                            f"Failed tool(s): {failure_list}. Error detail: {failure_detail}. "
                            "Diagnose the cause and FIX IT THIS TURN by calling the tool again with corrected "
                            "arguments — do not give up and do not just explain. Common fixes: on a duplicate/"
                            "conflicting node id, generate fresh unique ids (or re-read the canvas for the real "
                            "ids and reference those); on STALE_RELOAD, call canvas_read then re-apply; on "
                            "BATCH_TOO_LARGE, split into smaller op batches; on a validation error, correct the "
                            "argument shape. Retry the operation now."
                        ),
                    }
                )
            else:
                messages_for_llm.append(
                    {
                        "role": "system",
                        "content": (
                            "A tool call failed and recovery attempts are exhausted. Do not retry tools in this "
                            "turn. Reply to the user with a brief explanation and next steps. "
                            f"Failed tool(s): {failure_list}."
                        ),
                    }
                )
        elif self_heal_count:
            # A clean turn (no failures) resets the self-heal budget.
            state["self_heal_count"] = 0
        if tool_loop_signature and not tool_failures:
            loop_list = ", ".join(tool_loop_signature) if tool_loop_signature else "tool"
            messages_for_llm.append(
                {
                    "role": "system",
                    "content": (
                        "Tool calls appear to be looping without progress. "
                        "Do not call tools in this turn. Reply to the user with a brief update "
                        "and suggest retrying after checking connectivity. "
                        f"Looping tool(s): {loop_list}."
                    ),
                }
            )

        tools_schema = None
        tool_schema_summaries: dict[str, dict[str, Any]] = {}
        tool_choice = "none"
        if disable_tools:
            tools_schema = None
            tool_choice = "none"
        elif self._tool_registry and (self_healing or (not tool_failures and not tool_loop_signature)):
            try:
                tools_schema = self._tool_registry.openai_tools_schema()
                if tools_schema:
                    tool_choice = "auto"
                    # Force a tool call on a canvas MODIFY run until a write happens, so the model
                    # cannot read the canvas and then stop with a prose plan (the change unapplied).
                    # Flips back to "auto" after the first write so it can give its text summary.
                    if _canvas_modify_pending(state, interaction_surface, latest_user_text):
                        tool_choice = "required"
                    # Defensive: strip lingering 'const' keys for stricter gateways (e.g., Gemini).
                    tools_schema = _strip_const(tools_schema)
                    iteration = int(state.get("iteration") or 0)
                    trimmed_tools = _trim_tools_for_first_turn(
                        tools_schema,
                        iteration=iteration,
                        latest_user_text=latest_user_text,
                    )
                    if len(trimmed_tools) != len(tools_schema):
                        logger.info(
                            "Applied first-turn minimal tools",
                            agent_run_id=state.get("agent_run_id"),
                            original_count=len(tools_schema),
                            trimmed_count=len(trimmed_tools),
                        )
                    tools_schema = trimmed_tools
                    tool_schema_summaries = _summarize_tools_schema(tools_schema)
                else:
                    tools_schema = None
            except Exception:
                logger.exception("Failed to build tools schema; falling back to no-tools")
                tools_schema = None
                tool_choice = "none"

        initial_model = state["model_name"]
        model_chain = _resolve_fallback_chain(initial_model)
        request_timeout_sec = _resolve_timeout_seconds(
            tool_context.get("llm_request_timeout_sec"),
            config.LLM_REQUEST_TIMEOUT_SEC,
        )
        stream_idle_timeout_sec = _resolve_timeout_seconds(
            tool_context.get("llm_stream_idle_timeout_sec"),
            config.LLM_STREAM_IDLE_TIMEOUT_SEC,
        )

        accumulated_content = ""
        accumulated_reasoning = ""
        tool_calls_buf: Dict[str, Dict[str, Any]] = {}
        tool_call_ids_by_index: dict[int, str] = {}
        fallback_tool_calls: Any = None
        fallback_message_content: Any = None
        fallback_message_consumed = False
        finish_reason = "stop"
        usage: Dict[str, Any] = {}
        llm_response_id = f"llm_{uuid.uuid4().hex}"
        thread_run_id = f"tr_{uuid.uuid4().hex}"
        chunk_idx = 0

        last_error: Optional[Exception] = None
        model_attempts: list[str] = []
        used_model = initial_model
        success = False
        stop_requested = False

        for attempt_index, candidate_model in enumerate(model_chain):
            state["model_name"] = candidate_model
            model_attempts.append(candidate_model)

            accumulated_content = ""
            accumulated_reasoning = ""
            tool_calls_buf = {}
            tool_call_ids_by_index = {}
            fallback_tool_calls = None
            fallback_message_content = None
            fallback_message_consumed = False
            finish_reason = "stop"
            usage = {}
            llm_response_id = f"llm_{uuid.uuid4().hex}"
            thread_run_id = f"tr_{uuid.uuid4().hex}"
            chunk_idx = 0
            stop_requested = False

            try:
                iteration = int(state.get("iteration") or 0)
                stream_enabled = not _should_disable_tool_streaming(
                    model_name=candidate_model,
                    tools_schema=tools_schema,
                    tool_choice=tool_choice,
                    iteration=iteration,
                    latest_user_text=latest_user_text,
                )
                if not stream_enabled:
                    logger.debug(
                        "Tool streaming disabled for call",
                        agent_run_id=state.get("agent_run_id"),
                        model=candidate_model,
                        iteration=iteration,
                    )
                llm_stream = await _call_llm_with_timeout(
                    request_timeout_sec,
                    messages=messages_for_llm,
                    model_name=candidate_model,
                    tools=tools_schema,
                    tool_choice=tool_choice,
                    stream=stream_enabled,
                    enable_thinking=state.get("enable_thinking"),
                    reasoning_effort=state.get("reasoning_effort", "low"),
                )
            except asyncio.CancelledError:
                raise
            except Exception as e:
                if attempt_index < len(model_chain) - 1 and _should_retry_llm_error(e):
                    last_error = e
                    logger.warning(
                        "LLM call failed; retrying with fallback model",
                        model=candidate_model,
                        error=str(e),
                    )
                    continue
                state["termination"] = {"should_terminate": True, "reason": "llm_error", "message": str(e)}
                raise

            try:
                # Streaming path
                if hasattr(llm_stream, "__aiter__"):
                    async for chunk in _stream_with_timeout(llm_stream, stream_idle_timeout_sec):
                        if stop_event and stop_event.is_set():
                            state["termination"] = {"should_terminate": True, "reason": "stopped", "message": "stop_signal"}
                            stop_requested = True
                            break

                        # LiteLLM/OpenAI-style delta parsing
                        try:
                            if hasattr(chunk, "usage") and chunk.usage:
                                # Final usage is typically delivered on last chunk for some providers.
                                try:
                                    usage = chunk.usage.model_dump()  # type: ignore[attr-defined]
                                except Exception:
                                    usage = dict(chunk.usage) if isinstance(chunk.usage, dict) else usage

                            if hasattr(chunk, "choices") and chunk.choices:
                                choice0 = chunk.choices[0]
                                if getattr(choice0, "finish_reason", None):
                                    finish_reason = choice0.finish_reason

                                message = getattr(choice0, "message", None)
                                message_tool_calls = _get_attr(message, "tool_calls", None) if message else None
                                if message_tool_calls:
                                    fallback_tool_calls = message_tool_calls
                                message_function_call = _get_attr(message, "function_call", None) if message else None
                                if message_function_call:
                                    fallback_tool_calls = message_function_call
                                message_function_call_alt = _get_attr(message, "functionCall", None) if message else None
                                if message_function_call_alt:
                                    fallback_tool_calls = message_function_call_alt
                                direct_tool_calls = _get_attr(choice0, "tool_calls", None)
                                if direct_tool_calls:
                                    fallback_tool_calls = direct_tool_calls
                                direct_function_call = _get_attr(choice0, "function_call", None)
                                if direct_function_call:
                                    fallback_tool_calls = direct_function_call
                                direct_function_call_alt = _get_attr(choice0, "functionCall", None)
                                if direct_function_call_alt:
                                    fallback_tool_calls = direct_function_call_alt

                                message_content = None
                                if message is not None:
                                    message_content = _get_attr(message, "content", None)
                                    if message_content is None:
                                        message_content = _get_attr(message, "parts", None)
                                    if message_content is None:
                                        message_content = _get_attr(message, "text", None)
                                if message_content is None:
                                    message_content = _get_attr(choice0, "text", None)
                                if message_content is not None:
                                    fallback_message_content = message_content

                                delta = getattr(choice0, "delta", None)
                                if delta is None:
                                    if (
                                        fallback_message_content is not None
                                        and not fallback_message_consumed
                                        and not accumulated_content
                                    ):
                                        fallback_text, fallback_reasoning, fallback_tool_calls_content = _split_stream_content(
                                            fallback_message_content
                                        )
                                        if fallback_tool_calls_content:
                                            for payload in fallback_tool_calls_content:
                                                _merge_tool_calls_from_message(
                                                    tool_calls_buf,
                                                    payload,
                                                    index_map=tool_call_ids_by_index,
                                                )
                                        if fallback_reasoning:
                                            accumulated_reasoning += str(fallback_reasoning)
                                            await emit(
                                                AssistantChunkEvent(
                                                    type="assistant_chunk",
                                                    timestamp=_now_iso(),
                                                    agent_run_id=state["agent_run_id"],
                                                    thread_id=state["thread_id"],
                                                    thread_run_id=thread_run_id,
                                                    iteration=state.get("iteration"),
                                                    sequence=chunk_idx,
                                                    content=str(fallback_reasoning),
                                                    channel="reasoning",
                                                )
                                            )
                                            chunk_idx += 1
                                        if fallback_text:
                                            accumulated_content += str(fallback_text)
                                            await emit(
                                                AssistantChunkEvent(
                                                    type="assistant_chunk",
                                                    timestamp=_now_iso(),
                                                    agent_run_id=state["agent_run_id"],
                                                    thread_id=state["thread_id"],
                                                    thread_run_id=thread_run_id,
                                                    iteration=state.get("iteration"),
                                                    sequence=chunk_idx,
                                                    content=str(fallback_text),
                                                )
                                            )
                                            chunk_idx += 1
                                        fallback_message_consumed = True
                                    continue

                                # Content tokens
                                delta_content = getattr(delta, "content", None)
                                delta_parts = _get_attr(delta, "parts", None)
                                emitted_reasoning = False
                                parts_text = ""
                                parts_reasoning = ""
                                if delta_parts:
                                    parts_text, parts_reasoning, parts_tool_calls = _split_stream_content(delta_parts)
                                    if parts_tool_calls:
                                        for payload in parts_tool_calls:
                                            _merge_tool_calls_from_message(
                                                tool_calls_buf,
                                                payload,
                                                index_map=tool_call_ids_by_index,
                                            )
                                    if parts_reasoning:
                                        accumulated_reasoning += str(parts_reasoning)
                                        await emit(
                                            AssistantChunkEvent(
                                                type="assistant_chunk",
                                                timestamp=_now_iso(),
                                                agent_run_id=state["agent_run_id"],
                                                thread_id=state["thread_id"],
                                                thread_run_id=thread_run_id,
                                                iteration=state.get("iteration"),
                                                sequence=chunk_idx,
                                                content=str(parts_reasoning),
                                                channel="reasoning",
                                            )
                                        )
                                        chunk_idx += 1
                                        emitted_reasoning = True
                                if delta_content:
                                    content_text, content_reasoning, content_tool_calls = _split_stream_content(delta_content)
                                    if content_tool_calls:
                                        for payload in content_tool_calls:
                                            _merge_tool_calls_from_message(
                                                tool_calls_buf,
                                                payload,
                                                index_map=tool_call_ids_by_index,
                                            )
                                    if content_reasoning and (not parts_reasoning or content_reasoning.strip() != parts_reasoning.strip()):
                                        accumulated_reasoning += str(content_reasoning)
                                        await emit(
                                            AssistantChunkEvent(
                                                type="assistant_chunk",
                                                timestamp=_now_iso(),
                                                agent_run_id=state["agent_run_id"],
                                                thread_id=state["thread_id"],
                                                thread_run_id=thread_run_id,
                                                iteration=state.get("iteration"),
                                                sequence=chunk_idx,
                                                content=str(content_reasoning),
                                                channel="reasoning",
                                            )
                                        )
                                        chunk_idx += 1
                                        emitted_reasoning = True
                                    if content_text:
                                        accumulated_content += str(content_text)
                                        await emit(
                                            AssistantChunkEvent(
                                                type="assistant_chunk",
                                                timestamp=_now_iso(),
                                                agent_run_id=state["agent_run_id"],
                                                thread_id=state["thread_id"],
                                                thread_run_id=thread_run_id,
                                                iteration=state.get("iteration"),
                                                sequence=chunk_idx,
                                                content=str(content_text),
                                            )
                                        )
                                        chunk_idx += 1
                                elif delta_parts:
                                    if parts_text:
                                        accumulated_content += str(parts_text)
                                        await emit(
                                            AssistantChunkEvent(
                                                type="assistant_chunk",
                                                timestamp=_now_iso(),
                                                agent_run_id=state["agent_run_id"],
                                                thread_id=state["thread_id"],
                                                thread_run_id=thread_run_id,
                                                iteration=state.get("iteration"),
                                                sequence=chunk_idx,
                                                content=str(parts_text),
                                            )
                                        )
                                        chunk_idx += 1

                                if not emitted_reasoning:
                                    extra_reasoning = (
                                        _get_attr(delta, "reasoning_content", None)
                                        or _get_attr(delta, "reasoning", None)
                                        or _get_attr(delta, "thinking", None)
                                        or _get_attr(delta, "thought", None)
                                    )
                                    if extra_reasoning:
                                        extra_reasoning_text = _normalize_content(extra_reasoning)
                                        if extra_reasoning_text:
                                            accumulated_reasoning += str(extra_reasoning_text)
                                            await emit(
                                                AssistantChunkEvent(
                                                    type="assistant_chunk",
                                                    timestamp=_now_iso(),
                                                    agent_run_id=state["agent_run_id"],
                                                    thread_id=state["thread_id"],
                                                    thread_run_id=thread_run_id,
                                                    iteration=state.get("iteration"),
                                                    sequence=chunk_idx,
                                                    content=str(extra_reasoning_text),
                                                    channel="reasoning",
                                                )
                                            )
                                            chunk_idx += 1

                                # Tool calls (streamed arguments)
                                delta_tool_calls = _get_attr(delta, "tool_calls", None)
                                if delta_tool_calls:
                                    for tc in delta_tool_calls:
                                        tc_id, fn_name, fn_args, tc_index = _extract_tool_call_fields(tc)
                                        key = _tool_call_key(tc_id, tc_index, fallback_hint=fn_name, index_map=tool_call_ids_by_index)
                                        if not key:
                                            continue
                                        buf = tool_calls_buf.setdefault(key, {"name": fn_name, "arguments": ""})
                                        if "call_summary" not in buf:
                                            buf["call_summary"] = _summarize_tool_call_payload(tc)
                                        if fn_name:
                                            buf["name"] = fn_name
                                        if fn_args is not None:
                                            if isinstance(fn_args, dict):
                                                existing_args = _safe_json_loads_any(buf.get("arguments") or "")
                                                if isinstance(existing_args, dict):
                                                    merged = {**existing_args, **fn_args}
                                                    try:
                                                        buf["arguments"] = json.dumps(merged, ensure_ascii=False)
                                                    except Exception:
                                                        buf["arguments"] = str(merged)
                                                else:
                                                    try:
                                                        buf["arguments"] = json.dumps(fn_args, ensure_ascii=False)
                                                    except Exception:
                                                        buf["arguments"] = str(fn_args)
                                            elif isinstance(fn_args, list):
                                                try:
                                                    buf["arguments"] = json.dumps(fn_args, ensure_ascii=False)
                                                except Exception:
                                                    buf["arguments"] = str(fn_args)
                                            else:
                                                buf["arguments"] += str(fn_args)
                                delta_function_call = _get_attr(delta, "function_call", None) or _get_attr(delta, "functionCall", None)
                                if delta_function_call:
                                    tc_id, fn_name, fn_args, tc_index = _extract_tool_call_fields(delta_function_call)
                                    key = _tool_call_key(tc_id, tc_index, fallback_hint=fn_name, index_map=tool_call_ids_by_index)
                                    if not key:
                                        continue
                                    buf = tool_calls_buf.setdefault(key, {"name": fn_name, "arguments": ""})
                                    if "call_summary" not in buf:
                                        buf["call_summary"] = _summarize_tool_call_payload(delta_function_call)
                                    if fn_name:
                                        buf["name"] = fn_name
                                    if fn_args is not None:
                                        if isinstance(fn_args, dict):
                                            existing_args = _safe_json_loads_any(buf.get("arguments") or "")
                                            if isinstance(existing_args, dict):
                                                merged = {**existing_args, **fn_args}
                                                try:
                                                    buf["arguments"] = json.dumps(merged, ensure_ascii=False)
                                                except Exception:
                                                    buf["arguments"] = str(merged)
                                            else:
                                                try:
                                                    buf["arguments"] = json.dumps(fn_args, ensure_ascii=False)
                                                except Exception:
                                                    buf["arguments"] = str(fn_args)
                                        elif isinstance(fn_args, list):
                                            try:
                                                buf["arguments"] = json.dumps(fn_args, ensure_ascii=False)
                                            except Exception:
                                                buf["arguments"] = str(fn_args)
                                        else:
                                            buf["arguments"] += str(fn_args)
                                chunk_tool_calls = _get_attr(chunk, "tool_calls", None)
                                if chunk_tool_calls:
                                    _merge_tool_calls_from_message(
                                        tool_calls_buf,
                                        chunk_tool_calls,
                                        index_map=tool_call_ids_by_index,
                                    )
                                chunk_function_call = _get_attr(chunk, "function_call", None) or _get_attr(chunk, "functionCall", None)
                                if chunk_function_call:
                                    _merge_tool_calls_from_message(
                                        tool_calls_buf,
                                        chunk_function_call,
                                        index_map=tool_call_ids_by_index,
                                    )
                        except Exception:
                            # Be resilient to provider-specific stream shapes; never break streaming.
                            continue
                    if fallback_tool_calls:
                        _merge_tool_calls_from_message(
                            tool_calls_buf,
                            fallback_tool_calls,
                            index_map=tool_call_ids_by_index,
                        )
                    if (
                        not accumulated_content
                        and not tool_calls_buf
                        and fallback_message_content is not None
                        and not fallback_message_consumed
                    ):
                        fallback_text, fallback_reasoning, fallback_tool_calls_content = _split_stream_content(
                            fallback_message_content
                        )
                        if fallback_tool_calls_content:
                            for payload in fallback_tool_calls_content:
                                _merge_tool_calls_from_message(
                                    tool_calls_buf,
                                    payload,
                                    index_map=tool_call_ids_by_index,
                                )
                        if fallback_reasoning:
                            accumulated_reasoning += str(fallback_reasoning)
                        if fallback_text:
                            accumulated_content += str(fallback_text)
                        fallback_message_consumed = True
                    if _should_retry_nonstream_tool_parse(
                        tool_calls_buf=tool_calls_buf,
                        tool_schema_summaries=tool_schema_summaries,
                        accumulated_content=accumulated_content,
                    ):
                        retry_model_name = _resolve_tool_parse_retry_model(state["model_name"])
                        logger.warning("Streaming tool calls missing required args; retrying non-streaming tool call parse")
                        try:
                            retry_response = await make_llm_api_call(
                                messages=messages_for_llm,
                                model_name=retry_model_name,
                                tools=tools_schema,
                                tool_choice=tool_choice,
                                stream=False,
                                enable_thinking=state.get("enable_thinking"),
                                reasoning_effort=state.get("reasoning_effort", "low"),
                            )
                            retry_tool_calls = _extract_tool_calls_from_response(retry_response)
                            if retry_tool_calls:
                                retry_buf: dict[str, dict[str, Any]] = {}
                                retry_index_map: dict[int, str] = {}
                                _merge_tool_calls_from_message(
                                    retry_buf,
                                    retry_tool_calls,
                                    index_map=retry_index_map,
                                )
                                if not _tool_calls_missing_required_args(retry_buf, tool_schema_summaries):
                                    tool_calls_buf = retry_buf
                                    tool_call_ids_by_index = retry_index_map
                                else:
                                    logger.warning("Retry tool calls still missing required args; keeping streaming parse")
                            else:
                                logger.warning("Retry tool call parse returned no tool_calls")
                        except Exception:
                            logger.exception("Non-streaming tool call retry failed")
                else:
                    # Non-streaming fallback (some providers don't stream on error or config).
                    response = llm_stream
                    choices = _get_attr(response, "choices", []) or []
                    choice0 = choices[0] if choices else None
                    finish_reason = _get_attr(choice0, "finish_reason", None) or finish_reason

                    usage_obj = _get_attr(response, "usage", None)
                    if usage_obj:
                        try:
                            usage = usage_obj.model_dump()  # type: ignore[attr-defined]
                        except Exception:
                            usage = dict(usage_obj) if isinstance(usage_obj, dict) else usage

                    message = _get_attr(choice0, "message", None)
                    content = _get_attr(message, "content", None)
                    if content is None:
                        content = _get_attr(message, "parts", None)
                    accumulated_content = _normalize_content(content)

                    tool_calls = _get_attr(message, "tool_calls", None)
                    if tool_calls is None:
                        tool_calls = _get_attr(message, "function_call", None) or _get_attr(message, "functionCall", None) or []
                    if not tool_calls:
                        tool_calls = _get_attr(response, "tool_calls", None) or _get_attr(response, "function_call", None) or _get_attr(response, "functionCall", None) or []
                    if not tool_calls and isinstance(content, list):
                        _, content_tool_calls = _extract_tool_calls_from_content(content)
                        if content_tool_calls:
                            tool_calls = content_tool_calls
                    if isinstance(tool_calls, dict):
                        tool_calls = [tool_calls]
                    for tc in tool_calls or []:
                        tc_id, fn_name, fn_args, tc_index = _extract_tool_call_fields(tc)
                        key = _tool_call_key(tc_id, tc_index, fallback_hint=fn_name, index_map=tool_call_ids_by_index)
                        if not key:
                            continue
                        args_str = fn_args if isinstance(fn_args, str) else json.dumps(fn_args or {})
                        tool_calls_buf[str(key)] = {
                            "name": str(fn_name or ""),
                            "arguments": args_str,
                            "call_summary": _summarize_tool_call_payload(tc),
                        }
            except asyncio.CancelledError:
                raise
            except Exception as e:
                if (
                    attempt_index < len(model_chain) - 1
                    and _should_retry_llm_error(e)
                    and not accumulated_content
                    and not accumulated_reasoning
                    and chunk_idx == 0
                ):
                    last_error = e
                    logger.warning(
                        "LLM stream failed before output; retrying with fallback model",
                        model=candidate_model,
                        error=str(e),
                    )
                    continue
                state["termination"] = {"should_terminate": True, "reason": "llm_error", "message": str(e)}
                raise

            has_visible_response = bool(str(accumulated_content or "").strip()) or bool(tool_calls_buf)
            if (
                not stop_requested
                and not has_visible_response
                and _should_retry_empty_doc_response(
                    interaction_surface=interaction_surface,
                    attempt_index=attempt_index,
                    chain_len=len(model_chain),
                )
            ):
                logger.warning(
                    "Empty doc response detected; retrying with fallback model",
                    agent_run_id=state.get("agent_run_id"),
                    model=candidate_model,
                    attempt_index=attempt_index,
                    fallback_target=model_chain[attempt_index + 1],
                )
                continue

            used_model = candidate_model
            success = True
            last_error = None
            if stop_requested:
                break
            break

        if not success:
            error_message = str(last_error) if last_error else "LLM call failed"
            state["termination"] = {"should_terminate": True, "reason": "llm_error", "message": error_message}
            raise last_error or RuntimeError(error_message)

        # Finalize tool calls
        pending: list[ToolCall] = []
        for tc_id, data in tool_calls_buf.items():
            name = data.get("name") or ""
            args_str = data.get("arguments") or "{}"
            args = _safe_json_loads(args_str)
            hydrated = False
            if name:
                args, hydrated = _hydrate_minimal_tool_args(
                    name=name,
                    parsed=args,
                    latest_user_text=latest_user_text,
                )
            if name and not args:
                logger.debug(
                    "Tool call missing arguments",
                    tool=name,
                    tool_call_id=tc_id,
                    arguments_str=args_str,
                    call_summary=data.get("call_summary"),
                )
            if hydrated:
                logger.debug(
                    "Hydrated minimal tool arguments",
                    tool=name,
                    tool_call_id=tc_id,
                    had_raw_arguments=bool(str(args_str).strip()),
                )
            raw_payload: dict[str, Any] = {
                "arguments_str": args_str,
                "call_summary": data.get("call_summary"),
                "schema_summary": tool_schema_summaries.get(name) if name else None,
            }
            if hydrated:
                raw_payload["arguments_hydrated"] = True
            pending.append(
                {
                    "id": tc_id,
                    "name": name,
                    "arguments": args,
                    "raw": raw_payload,
                }
            )

        if pending:
            hydrated_from_doc_ops = _backfill_doc_update_title_from_pending_tool_calls(pending)
            if hydrated_from_doc_ops:
                logger.debug(
                    "Hydrated doc_update_title from sibling doc_apply_ops",
                    count=hydrated_from_doc_ops,
                )
            filtered: list[ToolCall] = []
            for tc in pending:
                name = tc.get("name") or ""
                args = tc.get("arguments")
                schema = tool_schema_summaries.get(name) if isinstance(name, str) else None
                required = schema.get("required") if isinstance(schema, dict) else []
                if required:
                    if not isinstance(args, dict):
                        logger.debug(
                            "Dropping tool call with non-dict args for required schema",
                            tool=name,
                            tool_call_id=tc.get("id"),
                            required=required,
                        )
                        continue
                    missing_required = False
                    for req in required:
                        if req not in args:
                            missing_required = True
                            break
                        value = args.get(req)
                        if isinstance(value, str) and not value.strip():
                            missing_required = True
                            break
                    if missing_required:
                        logger.debug(
                            "Dropping tool call missing required schema args",
                            tool=name,
                            tool_call_id=tc.get("id"),
                            required=required,
                            arguments=args,
                        )
                        continue
                if name in TOOLS_REQUIRE_NONEMPTY_ARGS and not _tool_args_satisfy_min_requirements(name, args):
                    logger.debug(
                        "Dropping tool call missing required args",
                        tool=name,
                        tool_call_id=tc.get("id"),
                        arguments=args,
                    )
                    continue
                filtered.append(tc)
            pending = filtered

        if (tool_failures or tool_loop_signature) and pending:
            logger.debug(
                "Dropping tool calls due to prior failures or loops",
                count=len(pending),
                agent_run_id=state.get("agent_run_id"),
            )
            pending = []

        if disable_tools and pending:
            logger.debug(
                "Chat mode: dropping tool calls",
                count=len(pending),
                agent_run_id=state.get("agent_run_id"),
            )
            pending = []

        empty_response_fallback_used = False
        if interaction_surface == "doc" and not pending and not str(accumulated_content or "").strip():
            accumulated_content = _empty_response_fallback_text(latest_user_text)
            empty_response_fallback_used = True
            logger.warning(
                "Injected fallback assistant message for empty doc response",
                agent_run_id=state.get("agent_run_id"),
                model=used_model,
            )

        state["pending_tool_calls"] = pending

        tool_calls_payload = _format_tool_calls_for_message(pending) if pending else None

        assistant_message: dict[str, Any] = {
            "role": "assistant",
            "content": accumulated_content,
        }
        if tool_calls_payload:
            assistant_message["tool_calls"] = tool_calls_payload

        messages_context = state.get("messages_context")
        if not isinstance(messages_context, list):
            messages_context = []
            state["messages_context"] = messages_context
        messages_context.append(assistant_message)

        # Emit assistant final (even if empty content; adapter may decide)
        asst_message_id = str(uuid.uuid4())
        await emit(
            AssistantFinalEvent(
                type="assistant_final",
                timestamp=_now_iso(),
                agent_run_id=state["agent_run_id"],
                thread_id=state["thread_id"],
                thread_run_id=thread_run_id,
                iteration=state.get("iteration"),
                message_id=asst_message_id,
                content=assistant_message,
                metadata={
                    "engine": state.get("engine"),
                    "engine_version": state.get("engine_version"),
                },
            )
        )

        if accumulated_reasoning.strip():
            await emit(
                StatusEvent(
                    type="status",
                    timestamp=_now_iso(),
                    agent_run_id=state["agent_run_id"],
                    thread_id=state["thread_id"],
                    thread_run_id=thread_run_id,
                    iteration=state.get("iteration"),
                    message_id=str(uuid.uuid4()),
                    status_type="reasoning",
                    data={"content": accumulated_reasoning},
                )
            )

        if not usage or (not usage.get("prompt_tokens") and not usage.get("completion_tokens")):
            try:
                usage = _estimate_usage(messages_for_llm, assistant_message, state["model_name"])
            except Exception:
                usage = usage or {}

        # Emit LLM end event
        end_message_id = str(uuid.uuid4())
        end_metadata = {
            "tool_choice": tool_choice,
            "engine": state.get("engine"),
            "engine_version": state.get("engine_version"),
        }
        if empty_response_fallback_used:
            end_metadata["empty_response_fallback"] = True
        if used_model != initial_model:
            end_metadata["model_switch"] = {
                "from": initial_model,
                "to": used_model,
                "attempted": model_attempts,
            }
        await emit(
            LLMResponseEndEvent(
                type="llm_response_end",
                timestamp=_now_iso(),
                agent_run_id=state["agent_run_id"],
                thread_id=state["thread_id"],
                thread_run_id=thread_run_id,
                iteration=state.get("iteration"),
                message_id=end_message_id,
                llm_response_id=llm_response_id,
                model=state["model_name"],
                usage=usage or {},
                finish_reason=finish_reason or "stop",
                assistant_message=assistant_message,
                metadata=end_metadata,
            )
        )

        # Termination decision
        state["force_continue"] = False
        if stop_event and stop_event.is_set():
            state["termination"] = {"should_terminate": True, "reason": "stopped", "message": "stop_signal"}
        elif pending:
            state["termination"] = {"should_terminate": False, "reason": "has_tool_calls"}
        elif _maybe_force_canvas_followthrough(state, interaction_surface, latest_user_text):
            # Model returned prose without applying a pending canvas modification — loop back
            # into call_model (the router honors force_continue) to force the edit tool call.
            state["force_continue"] = True
            state["termination"] = {"should_terminate": False, "reason": "canvas_followthrough"}
        elif _maybe_force_presentation_repair(state, interaction_surface):
            # The write succeeded but the deterministic LayoutCritic scored it below the
            # readability floor (e.g. a dead column) — loop back with the concrete relayout
            # suggestion so the agent re-renders into a readable shape. Bounded.
            state["force_continue"] = True
            state["termination"] = {"should_terminate": False, "reason": "presentation_repair"}
        else:
            # NOTE: a forced teach->html enforcement loop was tried and removed — on the habitat
            # Responses API, generating a full HTML infographic times out (524) and, combined with
            # a delete-first nudge, left the canvas EMPTY. teach->rich is steered by prompt only
            # (non-destructive); reliable large-HTML needs a faster / higher-timeout gateway.
            state["termination"] = {"should_terminate": True, "reason": "model_complete"}

        return state
