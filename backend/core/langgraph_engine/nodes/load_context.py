from __future__ import annotations

import json
from typing import Any

from core.langgraph_engine.context_manager import ContextManager
from core.langgraph_engine.message_loader import (
    augment_messages_with_image_urls,
    load_thread_messages,
    _append_inline_attachments,
)
from core.langgraph_engine.prompt_caching import apply_anthropic_caching_strategy, validate_cache_blocks
from core.langgraph_engine.contracts.event_schema import StatusEvent
from core.langgraph_engine.contracts.state_schema import GraphState
from core.prompts.prompt_manager import PromptManager
from core.services.supabase import DBConnection
from core.utils.logger import logger

from .call_model import _now_iso


class DefaultLoadContextNode:
    """
    Load conversation context + system prompt, and emit thread_run_start.

    - Reuses the shared LangGraph message loader for continuity.
    - Prepends system prompt built via PromptManager (function-calling mode).
    - Respects existing state.messages_context (e.g., when resuming from checkpoint).
    """

    async def __call__(self, state: GraphState, ctx: Any) -> GraphState:
        emit = getattr(ctx, "emit")
        tool_context = getattr(ctx, "tool_context", {}) or {}
        run_config = getattr(ctx, "run_config", None)
        client_message_hint = tool_context.get("client_message_hint")

        # Emit start status early
        await emit(
            StatusEvent(
                type="status",
                timestamp=_now_iso(),
                agent_run_id=state["agent_run_id"],
                thread_id=state["thread_id"],
                status_type="thread_run_start",
                iteration=state.get("iteration"),
            )
        )

        tool_registry = tool_context.get("tool_registry")
        supervisor_hint = tool_context.get("supervisor_hint")
        interaction_mode = tool_context.get("interaction_mode")
        interaction_surface = tool_context.get("interaction_surface")
        db = tool_context.get("db_connection")
        if db is None:
            db = DBConnection()

        agent_config = state.get("agent_config") or (run_config.agent_config if run_config else None)
        model_name = state.get("model_name")
        thread_id = state.get("thread_id")
        account_id = tool_context.get("account_id")
        enable_context_manager = state.get("enable_context_manager")
        if enable_context_manager is None:
            enable_context_manager = True
        enable_prompt_caching = state.get("enable_prompt_caching")
        if enable_prompt_caching is None:
            enable_prompt_caching = True

        client = None
        try:
            client = await db.client  # type: ignore[attr-defined]
        except Exception:
            logger.debug("LoadContext: DB client unavailable for system prompt enrichment")

        async def _coerce_message_from_row(row: dict[str, Any]) -> dict[str, Any]:
            metadata = row.get("metadata") or {}
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata)
                except Exception:
                    metadata = {}

            content = row.get("content")
            msg_obj: dict[str, Any] = {}

            if isinstance(content, str):
                try:
                    parsed_item = json.loads(content)
                    msg_obj.update(parsed_item if isinstance(parsed_item, dict) else {"content": parsed_item})
                except json.JSONDecodeError:
                    msg_obj["content"] = content
            elif isinstance(content, dict):
                msg_obj.update(content)
            else:
                msg_obj["content"] = content

            if msg_obj.get("content") is None:
                msg_obj["content"] = ""

            msg_obj["message_id"] = row.get("message_id")
            msg_obj.setdefault("type", row.get("type"))
            msg_obj.setdefault("metadata", metadata)

            if "role" not in msg_obj:
                inferred_role = row.get("type") if row.get("type") in ("user", "assistant", "tool") else "assistant"
                msg_obj["role"] = inferred_role

            if msg_obj.get("role") == "user" and client is not None:
                try:
                    msg_obj = await _append_inline_attachments(msg_obj, metadata, account_id, client)
                except Exception:
                    logger.debug("LoadContext: failed to inline attachments for client hint message")

            return msg_obj

        async def _coerce_message_from_hint(hint: dict[str, Any]) -> dict[str, Any] | None:
            content = hint.get("content")
            if content is None:
                return None

            msg_obj: dict[str, Any] = {}
            if isinstance(content, str):
                try:
                    parsed_item = json.loads(content)
                    msg_obj.update(parsed_item if isinstance(parsed_item, dict) else {"content": parsed_item})
                except json.JSONDecodeError:
                    msg_obj["content"] = content
            elif isinstance(content, dict):
                msg_obj.update(content)
            else:
                msg_obj["content"] = content

            if msg_obj.get("content") is None:
                msg_obj["content"] = ""

            metadata = hint.get("metadata")
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata)
                except Exception:
                    metadata = {}
            if isinstance(metadata, dict):
                msg_obj.setdefault("metadata", metadata)

            if "role" not in msg_obj:
                msg_obj["role"] = hint.get("role") or ("user" if hint.get("type") == "user" else "user")

            message_id = hint.get("message_id")
            if message_id:
                msg_obj["message_id"] = message_id

            if msg_obj.get("role") == "user" and client is not None:
                try:
                    msg_obj = await _append_inline_attachments(msg_obj, msg_obj.get("metadata") or {}, account_id, client)
                except Exception:
                    logger.debug("LoadContext: failed to inline attachments for client hint fallback")

            return msg_obj

        async def _merge_client_message_hint(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
            if not isinstance(client_message_hint, dict) or not client_message_hint:
                return messages

            message_id = client_message_hint.get("message_id")
            if message_id:
                for msg in messages:
                    if isinstance(msg, dict) and msg.get("message_id") == message_id:
                        return messages

            ensured: dict[str, Any] | None = None
            if message_id and client is not None:
                try:
                    res = (
                        await client.table("messages")
                        .select("message_id, type, content, metadata, created_at")
                        .eq("thread_id", thread_id)
                        .eq("message_id", message_id)
                        .limit(1)
                        .execute()
                    )
                    if res.data:
                        ensured = await _coerce_message_from_row(res.data[0] or {})
                except Exception:
                    logger.debug("LoadContext: failed to resolve client hint message by id")

            if ensured is None:
                ensured = await _coerce_message_from_hint(client_message_hint)

            if not ensured:
                return messages

            if not message_id:
                last = messages[-1] if messages else None
                if isinstance(last, dict):
                    if last.get("role") == ensured.get("role") and last.get("content") == ensured.get("content"):
                        return messages

            return [*messages, ensured]

        # If checkpoint already carried context, keep it (but allow client hint merge).
        if state.get("messages_context"):
            messages_context = state.get("messages_context")
            if isinstance(messages_context, list) and client_message_hint:
                try:
                    merged = await _merge_client_message_hint(messages_context)
                    state["messages_context"] = merged
                    session_index = state.get("session_index", 0)
                    for msg in merged:
                        md = msg.get("metadata") if isinstance(msg, dict) else None
                        if isinstance(md, dict):
                            try:
                                session_index = max(session_index, int(md.get("session_index", 0) or 0))
                            except Exception:
                                continue
                    state["session_index"] = session_index
                except Exception:
                    logger.debug("LoadContext: failed to merge client hint into checkpoint context")
            return state

        try:
            # System prompt (function calling, no XML examples)
            system_prompt = await PromptManager.build_system_prompt(
                model_name=model_name,
                agent_config=agent_config,
                thread_id=thread_id,
                mcp_wrapper_instance=None,
                client=client,
                tool_registry=tool_registry,
                interaction_mode=interaction_mode,
                interaction_surface=interaction_surface,
                include_xml_examples=False,
                xml_tool_calling=False,
            )

            # Append LangGraph tool list (function calling) to keep prompt aligned with exposed tools.
            if system_prompt and isinstance(system_prompt.get("content"), str) and tool_registry:
                try:
                    # PromptManager already injects a curated tool list + canvas contract.
                    # Avoid duplicating tool hints (token bloat + more room for tool-name confusion).
                    if "--- Built-in Tools Available ---" not in str(system_prompt["content"]):
                        tool_lines = []
                        tools = getattr(tool_registry, "list_tools", lambda: [])()
                        MAX_TOOLS = 20
                        for idx, spec in enumerate(tools):
                            if idx >= MAX_TOOLS:
                                tool_lines.append(f"(+{len(tools) - MAX_TOOLS} more)")
                                break
                            desc = getattr(spec, "description", "") or ""
                            tool_lines.append(f"- {getattr(spec, 'name', '')}: {desc}")
                        if tool_lines:
                            section = "\n\n--- Available function tools ---\n" + "\n".join(tool_lines)
                            system_prompt["content"] = str(system_prompt["content"]) + section
                except Exception:
                    logger.debug("LoadContext: failed to append tool hints")
            if supervisor_hint and isinstance(system_prompt.get("content"), str):
                system_prompt["content"] = (
                    str(system_prompt["content"])
                    + "\n\n--- Supervisor Routing Hint ---\n"
                    + str(supervisor_hint)
                )
        except Exception:
            logger.exception("Failed to build system prompt; proceeding without it", agent_run_id=state.get("agent_run_id"))
            system_prompt = None

        try:
            messages = await load_thread_messages(
                thread_id=thread_id,
                llm_model=model_name,
                llm_max_tokens=None,
                db=db,
            )
            try:
                messages = augment_messages_with_image_urls(messages)
            except Exception:
                logger.debug("LoadContext: failed to augment image URLs")
            if client_message_hint:
                try:
                    messages = await _merge_client_message_hint(messages or [])
                except Exception:
                    logger.debug("LoadContext: failed to merge client hint into messages")
        except Exception:
            logger.exception("Failed to load messages_context; leaving empty", agent_run_id=state.get("agent_run_id"))
            messages = []

        if enable_context_manager:
            try:
                context_manager = ContextManager()
                messages = context_manager.compress_messages(messages, model_name, max_tokens=None)
            except Exception:
                logger.exception("Context manager compression failed; using raw messages", agent_run_id=state.get("agent_run_id"))

        combined = []
        if system_prompt:
            if enable_prompt_caching:
                try:
                    combined = apply_anthropic_caching_strategy(system_prompt, messages or [], model_name)
                    combined = validate_cache_blocks(combined, model_name)
                except Exception:
                    logger.exception("Prompt caching failed; falling back to raw prompt", agent_run_id=state.get("agent_run_id"))
                    combined = [system_prompt] + (messages or [])
            else:
                combined = [system_prompt] + (messages or [])
        else:
            combined = messages or []

        if combined:
            state["messages_context"] = combined
            session_index = state.get("session_index", 0)
            for msg in combined:
                md = msg.get("metadata") if isinstance(msg, dict) else None
                if isinstance(md, dict):
                    try:
                        session_index = max(session_index, int(md.get("session_index", 0) or 0))
                    except Exception:
                        continue
            state["session_index"] = session_index

        return state
