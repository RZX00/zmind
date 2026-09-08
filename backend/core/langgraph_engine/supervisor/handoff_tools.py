from __future__ import annotations

import json as _json
import re
import uuid
from typing import Any, Optional

from pydantic import Field, AliasChoices

from core.langgraph_engine.contracts import SideEffectLevel, ToolSpec
from core.langgraph_engine.tools.catalog import build_registry
from core.langgraph_engine.tools.adapters.native_tool_adapter import ToolArgs
from core.langgraph_engine.persistence.message_writer import message_writer
from core.utils.logger import logger

from .agent_defs import AgentDef, SUPERVISOR_AGENT_DEFS
from .subagent_runner import run_subagent


class HandoffArgs(ToolArgs):
    task: Optional[str] = Field(
        default=None,
        description="Clear, specific task for the target agent.",
        validation_alias=AliasChoices("task", "query", "instruction", "instructions", "goal"),
    )
    context: Optional[str] = Field(
        default=None,
        description="Optional extra context, constraints, or details needed by the agent.",
        validation_alias=AliasChoices("context", "content", "details", "draft"),
    )
    output_mode: str = Field(
        default="last_message",
        description="Return mode: 'last_message' or 'full_history'.",
    )


def _handoff_description(agent: AgentDef) -> str:
    if agent.name == "canvas_agent":
        return (
            "Delegate to Canvas Agent for canvas read/edit work. "
            "Include the exact content to place on the canvas in `context`."
        )
    if agent.name == "presentation_agent":
        return (
            "Delegate to Presentation Agent for HTML slide presentation generation."
        )
    return f"Delegate to {agent.display_name}. Use for tasks that require this specialist."


def _normalize_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, list):
        return "".join(str(item) for item in content)
    if isinstance(content, dict):
        inner = content.get("content")
        if isinstance(inner, str):
            return inner
    return str(content)


_LOW_SIGNAL_TOKENS = {
    "continue",
    "goon",
    "next",
    "resume",
    "proceed",
    "start",
    "begin",
    "ok",
    "okay",
    "yes",
    "y",
    "\u7ee7\u7eed",
    "\u7ee7\u7eed\u5427",
    "\u7ee7\u7eed\u4e00\u4e0b",
    "\u5f00\u59cb",
    "\u597d",
    "\u597d\u7684",
    "\u662f\u7684",
}


def _normalize_low_signal(text: str) -> str:
    cleaned = text.strip().lower()
    cleaned = re.sub(r"[\s\.\,\!\?\u3002\uff01\uff1f]+", "", cleaned)
    return cleaned


def _is_low_signal(text: str) -> bool:
    if not text:
        return True
    normalized = _normalize_low_signal(text)
    return normalized in _LOW_SIGNAL_TOKENS


def _fallback_task(args: dict[str, Any], parent_state: dict[str, Any]) -> str:
    task = str(args.get("task") or "").strip()
    if task:
        return task
    messages = parent_state.get("messages_context") or []
    for msg in reversed(messages):
        if isinstance(msg, dict) and msg.get("role") == "user":
            candidate = _normalize_content(msg.get("content")).strip()
            if candidate and not _is_low_signal(candidate):
                return candidate
    for msg in reversed(messages):
        if isinstance(msg, dict) and msg.get("role") == "user":
            candidate = _normalize_content(msg.get("content")).strip()
            if candidate:
                return candidate
    return "Handle the user's latest request."


def _fallback_context(args: dict[str, Any], parent_state: dict[str, Any]) -> str | None:
    context = str(args.get("context") or "").strip()
    if context:
        return context
    messages = parent_state.get("messages_context") or []

    def _extract_cta_context() -> str | None:
        for msg in reversed(messages):
            if not isinstance(msg, dict) or msg.get("role") != "user":
                continue
            metadata = msg.get("metadata") or {}
            if isinstance(metadata, str):
                try:
                    import json as _json
                    metadata = _json.loads(metadata)
                except Exception:
                    metadata = {}
            if not isinstance(metadata, dict):
                continue
            action = metadata.get("cta_action") or metadata.get("ctaAction")
            if not isinstance(action, str) or not action.strip():
                continue
            label = metadata.get("cta_label") or metadata.get("ctaLabel")
            payload = metadata.get("cta_payload") or metadata.get("ctaPayload")
            parts = [f"CTA action: {action.strip()}"]
            if isinstance(label, str) and label.strip():
                parts.append(f"CTA label: {label.strip()}")
            if payload is not None:
                try:
                    payload_text = _json.dumps(payload, ensure_ascii=True)
                except Exception:
                    payload_text = str(payload)
                parts.append(f"CTA payload: {payload_text}")
            return "\n".join(parts)
        return None

    cta_context = _extract_cta_context()

    recent_user_messages: list[str] = []
    for msg in reversed(messages):
        if not isinstance(msg, dict) or msg.get("role") != "user":
            continue
        candidate = _normalize_content(msg.get("content")).strip()
        if not candidate or _is_low_signal(candidate):
            continue
        if candidate not in recent_user_messages:
            recent_user_messages.append(candidate)
        if len(recent_user_messages) >= 2:
            break

    parts: list[str] = []
    if recent_user_messages:
        parts.append(f"User request: {recent_user_messages[0]}")
        if len(recent_user_messages) > 1:
            parts.append(f"Earlier context: {recent_user_messages[1]}")

    if parts:
        if cta_context:
            parts.append(cta_context)
        return "\n".join(parts)

    if cta_context:
        return cta_context
    return None


def _extract_research_cta_confirmation(parent_state: dict[str, Any]) -> dict[str, Any] | None:
    """Extract research_plan.start CTA payload from the most recent user message."""
    messages = parent_state.get("messages_context") or []
    for msg in reversed(messages):
        if not isinstance(msg, dict) or msg.get("role") != "user":
            continue
        metadata = msg.get("metadata") or {}
        if isinstance(metadata, str):
            try:
                metadata = _json.loads(metadata)
            except Exception:
                metadata = {}
        if not isinstance(metadata, dict):
            continue
        action = metadata.get("cta_action") or metadata.get("ctaAction") or ""
        if action == "research_plan.start":
            payload = metadata.get("cta_payload") or metadata.get("ctaPayload") or {}
            return payload if isinstance(payload, dict) else {}
        if isinstance(action, str) and action.startswith("research_plan."):
            return None
        break
    return None


def _decode_tool_message_content(raw: Any) -> Any:
    if isinstance(raw, str):
        try:
            return _json.loads(raw)
        except Exception:
            return raw
    return raw


def _extract_rendered_html(tool_messages: list[dict[str, Any]]) -> str | None:
    for msg in reversed(tool_messages):
        if not isinstance(msg, dict):
            continue
        if msg.get("name") != "render_presentation":
            continue
        if not bool(msg.get("success")):
            continue
        content = _decode_tool_message_content(msg.get("content"))
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, dict):
            candidate = content.get("html") or content.get("output")
            if isinstance(candidate, str) and candidate.strip():
                return candidate
    return None


def _extract_presentation_metadata(output: dict[str, Any], tool_messages: list[dict[str, Any]]) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "schema": "presentation.v1",
        "role": "result_html",
        "kind": "ppt_html",
        "version": "2",
        "capabilities": {
            "fullscreen": True,
            "downloadPptx": True,
            "exportGoogleSlides": True,
        },
    }

    render_meta: dict[str, Any] = {}
    for msg in reversed(tool_messages):
        if not isinstance(msg, dict) or msg.get("name") != "render_presentation":
            continue
        if not bool(msg.get("success")):
            continue
        maybe_meta = msg.get("metadata")
        if isinstance(maybe_meta, dict):
            render_meta = maybe_meta
            break

    slides_json = render_meta.get("slides_json")
    if isinstance(slides_json, dict):
        meta["slides_json"] = slides_json
        title = slides_json.get("title")
        if isinstance(title, str) and title.strip():
            meta["title"] = title.strip()
        style = slides_json.get("style")
        if isinstance(style, str) and style.strip():
            meta["style"] = style.strip()
        slides = slides_json.get("slides")
        if isinstance(slides, list):
            meta["slideCount"] = len(slides)

    if "style" not in meta:
        style = render_meta.get("style")
        if isinstance(style, str) and style.strip():
            meta["style"] = style.strip()
    if "slideCount" not in meta:
        slide_count = render_meta.get("slide_count")
        if isinstance(slide_count, int) and slide_count >= 0:
            meta["slideCount"] = slide_count

    if "slides_json" not in meta:
        raw = output.get("content")
        if isinstance(raw, str) and raw.strip():
            try:
                parsed = _json.loads(raw)
            except Exception:
                parsed = None
            if isinstance(parsed, dict):
                meta["slides_json"] = parsed
                title = parsed.get("title")
                if isinstance(title, str) and title.strip():
                    meta["title"] = title.strip()
                style = parsed.get("style")
                if isinstance(style, str) and style.strip():
                    meta["style"] = style.strip()
                slides = parsed.get("slides")
                if isinstance(slides, list):
                    meta["slideCount"] = len(slides)
    return meta


def _has_successful_canvas_write(tool_messages: list[dict[str, Any]]) -> bool:
    for msg in tool_messages:
        if not isinstance(msg, dict):
            continue
        if msg.get("name") not in {"canvas_write", "canvas_edit"}:
            continue
        if bool(msg.get("success")):
            return True
    return False


async def _publish_presentation_html_to_canvas(
    result: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    output = result.get("output")
    if not isinstance(output, dict):
        return result

    tool_messages = output.get("tool_messages")
    if not isinstance(tool_messages, list) or not tool_messages:
        return result

    if _has_successful_canvas_write(tool_messages):
        if not bool(result.get("success")):
            metadata = result.get("metadata")
            if not isinstance(metadata, dict):
                metadata = {}
            publish_meta: dict[str, Any] = {
                "attempted": False,
                "write_success": True,
                "used_existing_canvas_write": True,
            }
            if result.get("error"):
                publish_meta["original_error"] = result.get("error")
            metadata["presentation_publish"] = publish_meta
            result["metadata"] = metadata
            result["success"] = True
            result["error"] = None
        return result

    html = _extract_rendered_html(tool_messages)
    if not html:
        return result

    node_data = {"presentation": _extract_presentation_metadata(output, tool_messages)}
    write_args = {
        "layout": "stack",
        "anchor": "viewport.center",
        "nodes": [
            {
                "type": "code",
                "codeType": "html",
                "content": html,
                "width": 960,
                "height": 600,
                "data": node_data,
            }
        ],
    }

    registry = build_registry(allowed_names={"canvas_write"})
    write_call_id = f"presentation_publish_{uuid.uuid4().hex[:12]}"
    write_result = await registry.execute_tool_call(
        {"id": write_call_id, "name": "canvas_write", "arguments": write_args},
        context,
    )

    tool_payload = write_result.get("output")
    if tool_payload is None and write_result.get("error"):
        tool_payload = {"error": write_result.get("error")}
    try:
        content_str = _json.dumps(tool_payload if tool_payload is not None else {}, ensure_ascii=False)
    except Exception:
        content_str = _json.dumps(str(tool_payload))

    tool_messages.append(
        {
            "name": "canvas_write",
            "content": content_str,
            "success": bool(write_result.get("success")),
            "error": write_result.get("error"),
            "tool_call_id": write_call_id,
        }
    )

    metadata = result.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    publish_meta: dict[str, Any] = {
        "attempted": True,
        "write_success": bool(write_result.get("success")),
        "deterministic_publish": True,
    }
    if result.get("error"):
        publish_meta["original_error"] = result.get("error")
    if write_result.get("error"):
        publish_meta["write_error"] = write_result.get("error")
    metadata["presentation_publish"] = publish_meta
    result["metadata"] = metadata

    if write_result.get("success"):
        result["success"] = True
        result["error"] = None

    return result


def build_handoff_tool_specs(agent_defs: dict[str, AgentDef] | None = None) -> list[ToolSpec]:
    defs = agent_defs or SUPERVISOR_AGENT_DEFS
    specs: list[ToolSpec] = []
    for agent in defs.values():
        tool_name = f"transfer_to_{agent.name}"

        async def _handler(args: dict[str, Any], context: dict[str, Any], _agent=agent) -> dict[str, Any]:
            try:
                parent_state = context.get("state") or {}
                run_config = context.get("run_config")
                if run_config is None:
                    raise ValueError("run_config is required for subagent handoff")
                task = _fallback_task(args, parent_state)
                handoff_context = _fallback_context(args, parent_state)
                output_mode = str(args.get("output_mode") or "last_message")
                tool_call_id = context.get("tool_call_id")
                session_index = parent_state.get("session_index")

                event_forwarder = None
                try:
                    from core.langgraph_engine.stream import LegacyStreamAdapter, RedisStreamWriter

                    agent_run_id = getattr(run_config, "agent_run_id", None)
                    thread_id = getattr(run_config, "thread_id", None)
                    if agent_run_id and thread_id:
                        adapter = LegacyStreamAdapter()
                        writer = RedisStreamWriter(agent_run_id)

                        persist_state: dict[str, Any] = {
                            "agent_run_id": agent_run_id,
                            "thread_id": thread_id,
                            "engine": getattr(run_config, "engine", None),
                            "engine_version": getattr(run_config, "engine_version", None),
                            "session_index": session_index or 0,
                            "checkpoint_id": parent_state.get("checkpoint_id"),
                            "is_shadow": bool(parent_state.get("is_shadow")),
                        }

                        async def _forward_event(event: dict[str, Any]) -> None:
                            event_type = event.get("type")
                            if event_type == "status":
                                status_type = event.get("status_type")
                                if status_type not in {"tool_started", "tool_completed", "tool_failed", "tool_error"}:
                                    return
                            elif event_type != "tool_message":
                                return

                            metadata = dict(event.get("metadata") or {})
                            metadata.setdefault("subagent", _agent.name)
                            if _agent.display_name:
                                metadata.setdefault("subagent_display_name", _agent.display_name)
                            if tool_call_id:
                                metadata.setdefault("parent_tool_call_id", tool_call_id)
                            if session_index is not None:
                                metadata.setdefault("session_index", session_index)

                            forwarded = dict(event)
                            forwarded["agent_run_id"] = agent_run_id
                            forwarded["thread_id"] = thread_id
                            forwarded["metadata"] = metadata

                            chunk = adapter.to_legacy_chunk(forwarded)
                            await writer.write_chunk(chunk)
                            if event_type == "tool_message":
                                try:
                                    await message_writer.write_once(persist_state, forwarded)
                                except Exception as persist_err:
                                    logger.warning(
                                        "Failed to persist subagent tool event",
                                        agent=_agent.name,
                                        error=str(persist_err),
                                    )

                        event_forwarder = _forward_event
                except Exception as stream_err:
                    logger.debug("Subagent stream bridge unavailable", agent=_agent.name, error=str(stream_err))

                # ── Two-stage research plan confirmation ──
                if _agent.runner == "research_graph":
                    agent_cfg = getattr(run_config, "agent_config", None) or {}
                    plan_confirmation_enabled = str(
                        agent_cfg.get("research_enable_plan_confirmation", "true")
                    ).strip().lower() in ("1", "true", "yes", "on")

                    if plan_confirmation_enabled:
                        cta_payload = _extract_research_cta_confirmation(parent_state)

                        if cta_payload is not None:
                            # Stage 2: user confirmed the plan — execute with confirmed queries
                            confirmed_queries = cta_payload.get("queries") or []
                            confirmed_task = cta_payload.get("clarified_task") or cta_payload.get("rewritten_task") or ""
                            if isinstance(confirmed_queries, list) and confirmed_queries:
                                result = await run_subagent(
                                    agent_def=_agent,
                                    task=task,
                                    context=handoff_context,
                                    parent_state=parent_state,
                                    parent_run_config=run_config,
                                    tool_context=context,
                                    output_mode=output_mode,
                                    event_forwarder=event_forwarder,
                                    confirmed_queries=confirmed_queries,
                                    confirmed_task=confirmed_task,
                                )
                                return result

                        # Stage 1: generate plan only
                        result = await run_subagent(
                            agent_def=_agent,
                            task=task,
                            context=handoff_context,
                            parent_state=parent_state,
                            parent_run_config=run_config,
                            tool_context=context,
                            output_mode=output_mode,
                            event_forwarder=event_forwarder,
                            plan_only=True,
                        )
                        # Attach CTA buttons to the plan result
                        if isinstance(result, dict) and result.get("success"):
                            output = result.get("output") or {}
                            plan = output.get("plan") or {}
                            queries = plan.get("queries") or []
                            if output.get("status") == "plan_generated" and queries:
                                cta_buttons = [
                                    {
                                        "label": "开始研究",
                                        "action": "research_plan.start",
                                        "style": "primary",
                                        "payload": plan,
                                    },
                                    {
                                        "label": "调整方向",
                                        "action": "research_plan.adjust",
                                        "style": "secondary",
                                    },
                                ]
                                metadata = result.get("metadata") or {}
                                if not isinstance(metadata, dict):
                                    metadata = {}
                                frontend_content = metadata.get("frontend_content") or {}
                                if not isinstance(frontend_content, dict):
                                    frontend_content = {}
                                frontend_content["cta"] = cta_buttons
                                metadata["frontend_content"] = frontend_content
                                result["metadata"] = metadata
                        return result

                result = await run_subagent(
                    agent_def=_agent,
                    task=task,
                    context=handoff_context,
                    parent_state=parent_state,
                    parent_run_config=run_config,
                    tool_context=context,
                    output_mode=output_mode,
                    event_forwarder=event_forwarder,
                )
                if _agent.name == "presentation_agent" and isinstance(result, dict):
                    result = await _publish_presentation_html_to_canvas(result, context)
                return result
            except Exception as exc:
                logger.exception("Subagent handoff failed", agent=_agent.name)
                return {"success": False, "error": str(exc)}

        specs.append(
            ToolSpec(
                name=tool_name,
                description=_handoff_description(agent),
                args_model=HandoffArgs,
                handler=_handler,
                side_effect_level=SideEffectLevel.READ_ONLY,
            )
        )
    return specs
