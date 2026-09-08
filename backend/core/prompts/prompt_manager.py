from __future__ import annotations

import datetime
import json
import os
import re
from typing import Optional, Any

from core.prompts.prompt import get_system_prompt, get_chat_prompt
from core.prompts.prompt_files import read_prompt_file_or_fallback, safe_format, escape_braces
from core.tools.mcp_tool_wrapper import MCPToolWrapper
from core.canvas.workspace_context import build_workspace_scope_metadata
from core.canvas.agent_context import (
    extract_ambiguous_titles,
    extract_canvas_id_from_payload,
    normalize_selection_context_payload,
)
from core.langgraph_engine.supervisor.agent_defs import (
    CANVAS_READ_TOOL_NAMES,
    CANVAS_WRITE_TOOL_NAMES,
    SUPERVISOR_AGENT_DEFS,
    supervisor_instructions,
)
from core.utils.logger import logger


def _schema_is_openapi(schema: Any) -> bool:
    schema_type = getattr(schema, "schema_type", None)
    schema_type_value = getattr(schema_type, "value", schema_type)
    return schema_type_value == "openapi"


def _load_fragment(name: str, fallback: str) -> str:
    return read_prompt_file_or_fallback(f"fragments/{name}", fallback)


def _extract_user_message_text(raw_content: Any) -> str:
    if isinstance(raw_content, dict):
        content = raw_content.get("content")
        if isinstance(content, str):
            return content.strip()
        return ""
    if isinstance(raw_content, str):
        text = raw_content.strip()
        if not text:
            return ""
        try:
            parsed = json.loads(text)
        except Exception:
            return text
        if isinstance(parsed, dict):
            content = parsed.get("content")
            if isinstance(content, str):
                return content.strip()
        return text
    return ""


class PromptManager:
    @staticmethod
    async def build_system_prompt(
        model_name: str,
        agent_config: Optional[dict],
        thread_id: str,
        mcp_wrapper_instance: Optional[MCPToolWrapper],
        client=None,
        tool_registry=None,
        interaction_mode: Optional[str] = None,
        interaction_surface: Optional[str] = None,
        include_xml_examples: bool = False,
        xml_tool_calling: bool = True,
        selection_context_override: Optional[dict] = None,
        cta_override: Optional[dict] = None,
        datetime_override: Optional[str] = None,
    ) -> dict:
        is_chat_mode = str(interaction_mode or "").strip().lower() == "chat"
        is_doc_surface = str(interaction_surface or "").strip().lower() in {"doc", "document"}
        is_canvas_surface = str(interaction_surface or "").strip().lower() == "canvas"
        default_system_content = get_chat_prompt() if is_chat_mode else get_system_prompt()
        # Canvas surface = EXECUTE, not Socratic. The base prompt mandates a "guided mode"
        # that ends every reply with an open question / calls the `ask` tool, which makes the
        # agent refuse to act on canvas requests. Prepend a high-priority override at the very
        # top (highest salience, same system message — avoids the two-system-message conflict)
        # that neutralizes guided-mode for canvas while keeping the canvas tool contract intact.
        if is_canvas_surface and not is_chat_mode:
            canvas_exec_header = (
                "# 🅰 CANVAS EXECUTION MODE (HIGHEST PRIORITY — OVERRIDES ALL CONFLICTING RULES BELOW)\n"
                "You are operating the user's live canvas directly. This is an EXECUTE request, not a "
                "Socratic/exploratory one. The rules below about ending replies with an open question, "
                "guided/深度引导 mode, or using the `ask` tool DO NOT APPLY here unless the request is "
                "genuinely impossible to act on.\n"
                "- DO the canvas work by calling the canvas tools (canvas_read to see state, then "
                "canvas_write to create / canvas_edit to modify). Do not merely describe a plan.\n"
                "- THIS IS A MULTI-STEP LOOP. After canvas_read, KEEP GOING in the SAME run: immediately "
                "issue the canvas_write/canvas_edit tool calls that apply the change. NEVER finish a turn "
                "with only a plan, a numbered list of steps, or 'now I will…' — if you have stated what to "
                "do, you MUST actually call the tools to do it before replying. The task is NOT complete "
                "until the canvas itself reflects the change. Prefer batching related ops into ONE "
                "canvas_edit `operations` array (e.g. delete_connection + add_node + add_connection "
                "together) rather than one tool call per step.\n"
                "- If a tool call fails, read the error, FIX your arguments, and retry — do not give up.\n"
                "- REQUIRED pattern for a modify request (follow it exactly): first canvas_read to get "
                "the real node/connection ids, then your VERY NEXT action is a canvas_edit tool call that "
                "applies everything in one operations array. Example for 'insert X between A and B': call "
                "canvas_edit with operations=[{\"op\":\"delete_connection\",\"id\":\"<A→B id>\"},"
                "{\"op\":\"add_node\",\"id\":\"X\",\"type\":\"text\",\"content\":\"X\",\"x\":..,\"y\":..},"
                "{\"op\":\"add_connection\",\"from\":\"<A id>\",\"to\":\"X\"},"
                "{\"op\":\"add_connection\",\"from\":\"X\",\"to\":\"<B id>\"}]. Writing those steps as prose "
                "instead of emitting the canvas_edit tool call is a FAILURE — emit the tool call.\n"
                "- Do NOT end with an open question and do NOT call the `ask` tool when the request is "
                "specific enough to act on. Only ask if the target is truly ambiguous (e.g. which of "
                "several canvases).\n"
                "- A write tool that returns success (with an idMap) HAS ALREADY persisted the change. "
                "Do NOT call canvas_read again to verify or re-inspect what you just wrote — that wastes a "
                "full round-trip. Treat the successful tool result as ground truth.\n"
                "- READABILITY: never lay out many parallel/sibling items as one `mindmap`/`tree` (it "
                "degenerates into an unreadable vertical column). For wide, shallow content use a `table`, "
                "a `layout:'row'` of `column` containers, or a single `code` mermaid `mindmap` (self-balancing). "
                "If a write tool result contains a `presentation` block with `below_floor: true`, your layout "
                "IS unreadable — immediately apply its `findings[].suggestion` (delete/restructure and re-render "
                "in the better shape) before you summarize.\n"
                "- For rich EXPLANATORY/teaching content (讲解/教学/解释 a concept or topic), prefer a SINGLE "
                "self-contained `code` html node (a full styled infographic that scrolls internally) — or a "
                "`code` svg node for a pure vector diagram/chart — over many small text nodes, a mindmap/tree, "
                "or a table; keep `table` ONLY for genuinely tabular/attribute data.\n"
                "- Only after the changes are applied, reply with a short one-line summary of what you changed.\n\n"
            )
            default_system_content = canvas_exec_header + default_system_content
        # Sanitize legacy sandbox/workflow content from the base prompt
        if not is_chat_mode:
            try:
                # Remove hardcoded edit_file enforcement block if present
                default_system_content = re.sub(
                    r"ALWAYS use the `edit_file` tool[\s\S]*?(?:\n\n|$)",
                    "",
                    default_system_content,
                    flags=re.IGNORECASE,
                )
                # Remove workflow management sections entirely
                default_system_content = re.sub(
                    r"# 5\. WORKFLOW MANAGEMENT[\s\S]*$",
                    "",
                    default_system_content,
                )
                # Remove entire Agent Creation + Workflow sections if present
                default_system_content = re.sub(
                    r"# \U0001F916 AGENT CREATION CAPABILITIES[\s\S]*$",
                    "",
                    default_system_content,
                )
            except Exception as exc:
                logger.warning(f"Prompt sanitization skipped due to error: {exc}")

        # Sample prompt injection disabled by default (set ENABLE_PROMPT_SAMPLES=1 to enable)
        if os.getenv("ENABLE_PROMPT_SAMPLES") == "1" and "anthropic" not in model_name.lower():
            try:
                sample_response = read_prompt_file_or_fallback(
                    "docs/sample_1.txt",
                    "",
                )
                if not sample_response:
                    sample_response_path = os.path.join(os.path.dirname(__file__), "samples/1.txt")
                    with open(sample_response_path, "r", encoding="utf-8") as file:
                        sample_response = file.read()
                default_system_content = (
                    default_system_content
                    + "\n\n <sample_assistant_response>"
                    + sample_response
                    + "</sample_assistant_response>"
                )
            except Exception as exc:
                logger.warning(f"Sample prompt injection skipped: {exc}")

        # Start with agent's normal system prompt or default
        if agent_config and agent_config.get("system_prompt"):
            system_content = agent_config["system_prompt"].strip()
        else:
            system_content = default_system_content
        # Apply the same sanitization to whichever content is selected
        if not is_chat_mode:
            try:
                system_content = re.sub(
                    r"ALWAYS use the `edit_file` tool[\s\S]*?(?:\n\n|$)",
                    "",
                    system_content,
                    flags=re.IGNORECASE,
                )
                system_content = re.sub(
                    r"# 5\. WORKFLOW MANAGEMENT[\s\S]*$",
                    "",
                    system_content,
                )
                system_content = re.sub(
                    r"# \U0001F916 AGENT CREATION CAPABILITIES[\s\S]*$",
                    "",
                    system_content,
                )
            except Exception as exc:
                logger.warning(f"Prompt sanitization (selected) skipped due to error: {exc}")

        # Add agent knowledge base context if available
        if agent_config and client and "agent_id" in agent_config:
            try:
                logger.debug(
                    "Retrieving agent knowledge base context for agent %s",
                    agent_config["agent_id"],
                )

                # Use only agent-based knowledge base context
                kb_result = await client.rpc(
                    "get_agent_knowledge_base_context",
                    {"p_agent_id": agent_config["agent_id"]},
                ).execute()

                if kb_result.data and kb_result.data.strip():
                    logger.debug(
                        "Found agent knowledge base context, adding to system prompt (length: %s chars)",
                        len(kb_result.data),
                    )

                    # Construct a well-formatted knowledge base section
                    kb_body = str(kb_result.data)
                    default_template = (
                        "=== AGENT KNOWLEDGE BASE ===\n"
                        "NOTICE: The following is your specialized knowledge base. This information should be considered authoritative for your responses and should take precedence over general knowledge when relevant.\n\n"
                        "{kb_context}\n\n"
                        "=== END AGENT KNOWLEDGE BASE ===\n\n"
                        "IMPORTANT: Always reference and utilize the knowledge base information above when it's relevant to user queries. This knowledge is specific to your role and capabilities."
                    )
                    template = _load_fragment("kb_context.fragment.md", default_template)
                    kb_section = safe_format(template, kb_context=escape_braces(kb_body))
                    system_content += "\n\n" + kb_section.strip("\n")
                else:
                    logger.debug("No knowledge base context found for this agent")

            except Exception as exc:
                logger.error(
                    "Error retrieving knowledge base context for agent %s: %s",
                    agent_config.get("agent_id", "unknown"),
                    exc,
                )
                # Continue without knowledge base context rather than failing

        # Inject Canvas Selection Context (if the latest user message provided one)
        try:
            if client:
                sel_rows = (
                    await client.table("messages")
                    .select("type, content, metadata, created_at")
                    .eq("thread_id", thread_id)
                    .eq("type", "user")
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )

                if sel_rows and sel_rows.data:
                    md = sel_rows.data[0].get("metadata") or {}
                    latest_user_text = _extract_user_message_text(sel_rows.data[0].get("content"))
                    if isinstance(md, str):
                        try:
                            md = json.loads(md)
                        except Exception:
                            md = {}

                    workspace_scope = md.get("workspace_scope")
                    if not isinstance(workspace_scope, dict):
                        workspace_scope = build_workspace_scope_metadata(latest_user_text)

                    scope_mode = str(workspace_scope.get("mode") or "local").strip().lower() or "local"
                    query_keywords = workspace_scope.get("query_keywords")
                    if not isinstance(query_keywords, list):
                        query_keywords = []
                    query_keywords = [str(item).strip() for item in query_keywords if str(item).strip()][:12]

                    scope_body_lines = [f"workspace_scope_mode: {scope_mode}"]
                    if query_keywords:
                        scope_body_lines.append(f"workspace_query_keywords: {', '.join(query_keywords)}")

                    write_policy = md.get("workspace_write_policy")
                    if not isinstance(write_policy, dict):
                        write_policy = {}
                    default_canvas_id = extract_canvas_id_from_payload(
                        write_policy.get("default_canvas_id")
                    )
                    policy_target_canvas_id = extract_canvas_id_from_payload(
                        write_policy.get("target_canvas_id")
                    )
                    cross_canvas_write_allowed = bool(write_policy.get("cross_canvas_write_allowed"))
                    cross_canvas_write_requires_explicit_target = bool(
                        write_policy.get("cross_canvas_write_requires_explicit_target", True)
                    )
                    if default_canvas_id:
                        scope_body_lines.append(f"default_canvas_id: {default_canvas_id}")
                    if policy_target_canvas_id:
                        scope_body_lines.append(f"write_policy_target_canvas_id: {policy_target_canvas_id}")
                    scope_body_lines.append(
                        "cross_canvas_write_allowed: "
                        + ("true" if cross_canvas_write_allowed else "false")
                    )
                    scope_body_lines.append(
                        "cross_canvas_write_requires_explicit_target: "
                        + ("true" if cross_canvas_write_requires_explicit_target else "false")
                    )
                    scope_body = "\n".join(scope_body_lines)

                    scope_rules_lines: list[str] = []
                    if scope_mode == "global_read":
                        scope_rules_lines.extend(
                            [
                                "- This global scope was explicitly requested by the user.",
                                "- Read sequentially across the workspace: call workspace_list_canvases with pagination (offset += limit) until exhausted.",
                                "- For each canvas, run a first-pass canvas_read with where + limit using query keywords.",
                                "- Only deepen reads for canvases that matched in first-pass.",
                                "- Do not write across canvases unless one explicit target canvas is confirmed by the user.",
                            ]
                        )
                    else:
                        scope_rules_lines.extend(
                            [
                                "- Default scope is the current thread-bound canvas.",
                                "- Do not call workspace_list_canvases unless the user explicitly asks for global/cross-canvas access.",
                                "- For write operations, keep target on current canvas unless user explicitly names another canvas.",
                            ]
                        )

                    if cross_canvas_write_allowed and policy_target_canvas_id:
                        scope_rules_lines.append(
                            f"- Cross-canvas write is allowed only for canvas_id='{policy_target_canvas_id}'."
                        )
                    else:
                        scope_rules_lines.append(
                            "- Cross-canvas write is blocked unless one explicit target canvas is confirmed by user metadata."
                        )

                    ambiguous_titles = extract_ambiguous_titles(md.get("workspace_target_canvas_ambiguous"))
                    if not ambiguous_titles:
                        ambiguous_titles = extract_ambiguous_titles(write_policy.get("ambiguous_titles"))
                    if ambiguous_titles:
                        scope_body += "\nambiguous_target_canvases: " + ", ".join(ambiguous_titles)
                        scope_rules_lines.append(
                            "- Target canvas match is ambiguous; ask user to pick one before any cross-canvas write."
                        )

                    scope_rules = "\n".join(scope_rules_lines)
                    scope_default_template = (
                        "=== WORKSPACE SCOPE CONTEXT ===\n"
                        "{workspace_scope_body}\n\n"
                        "WORKSPACE RULES:\n"
                        "{workspace_scope_rules}"
                    )
                    scope_template = _load_fragment("workspace_scope_context.fragment.md", scope_default_template)
                    scope_section = safe_format(
                        scope_template,
                        workspace_scope_body=escape_braces(scope_body),
                        workspace_scope_rules=escape_braces(scope_rules),
                    )
                    system_content += "\n\n" + scope_section.strip("\n")

                    target_canvas_id_for_selection: Optional[str] = policy_target_canvas_id or default_canvas_id
                    target_canvas = md.get("workspace_target_canvas")
                    if isinstance(target_canvas, dict):
                        target_canvas_id = (
                            extract_canvas_id_from_payload(target_canvas)
                        )
                        target_canvas_title = target_canvas.get("title") or target_canvas.get("name")
                        if isinstance(target_canvas_id, str) and target_canvas_id.strip():
                            target_canvas_id_for_selection = target_canvas_id.strip()
                            target_canvas_lines = [f"target_canvas_id: {target_canvas_id.strip()}"]
                            if isinstance(target_canvas_title, str) and target_canvas_title.strip():
                                target_canvas_lines.append(f"target_canvas_title: {target_canvas_title.strip()}")
                            target_canvas_body = "\n".join(target_canvas_lines)

                            target_rules_lines = [
                                "- Unless user explicitly overrides, operate on the target canvas above.",
                                "- For canvas_read/canvas_write/canvas_edit, pass canvas_id explicitly.",
                                "- If canvas identity is ambiguous, call workspace_list_canvases first.",
                            ]
                            if is_chat_mode:
                                target_rules_lines.append(
                                    "- Chat mode is read-only; use this target only as context for responses."
                                )
                            target_canvas_rules = "\n".join(target_rules_lines)

                            default_template = (
                                "=== TARGET CANVAS CONTEXT ===\n"
                                "{target_canvas_body}\n\n"
                                "TARGET RULES:\n"
                                "{target_canvas_rules}"
                            )
                            template = _load_fragment(
                                "target_canvas_context.fragment.md",
                                default_template,
                            )
                            target_canvas_section = safe_format(
                                template,
                                target_canvas_body=escape_braces(target_canvas_body),
                                target_canvas_rules=escape_braces(target_canvas_rules),
                            )
                            system_content += "\n\n" + target_canvas_section.strip("\n")

                    selection_ctx = (
                        selection_context_override
                        if selection_context_override is not None
                        else md.get("selection_context")
                    )
                    selection_ctx, selection_warnings = normalize_selection_context_payload(
                        selection_ctx,
                        target_canvas_id=target_canvas_id_for_selection,
                    )
                    if selection_warnings:
                        warning_body = ", ".join(selection_warnings)
                        system_content += (
                            "\n\n=== SELECTION CONTEXT STATUS ===\n"
                            "selection_context: ignored or reduced due to safety checks\n"
                            f"warnings: {warning_body}"
                        )
                    if selection_ctx and isinstance(selection_ctx, dict):
                        # Build a concise, token-efficient summary
                        meta = selection_ctx.get("meta") or {}
                        canvas_id = meta.get("canvas_id") or ""
                        nodes = selection_ctx.get("nodes") or []
                        conns = selection_ctx.get("connections") or []
                        groups = selection_ctx.get("groups") or []

                        def _summ_nodes(ns):
                            out = []
                            for n in ns[:20]:
                                try:
                                    nid = str(n.get("id"))
                                    ntype = str(n.get("type"))
                                    out.append(f"{nid}:{ntype}")
                                except Exception:
                                    continue
                            more = max(0, len(ns) - 20)
                            if more:
                                out.append(f"(+{more} more)")
                            return ", ".join(out) if out else "none"

                        def _summ_ids(items, key="id"):
                            vals = []
                            for it in items[:20]:
                                try:
                                    vals.append(str(it.get(key)))
                                except Exception:
                                    continue
                            more = max(0, len(items) - 20)
                            if more:
                                vals.append(f"(+{more} more)")
                            return ", ".join(vals) if vals else "none"

                        selection_body_lines = []
                        if canvas_id:
                            selection_body_lines.append(f"canvas_id: {canvas_id}")
                        selection_body_lines.append(f"selected_nodes: [{_summ_nodes(nodes)}]")
                        if conns:
                            selection_body_lines.append(f"selected_connections: [{_summ_ids(conns)}]")
                        if groups:
                            selection_body_lines.append(f"selected_groups: [{_summ_ids(groups)}]")
                        selection_body = "\n".join(selection_body_lines)

                        selection_rules_lines = [
                            "- Treat references like 'this', 'current selection', or unspecified targets as the SELECTED items above.",
                        ]
                        if is_chat_mode:
                            selection_rules_lines.append(
                                "- Use the selection as context only; Chat mode is read-only and cannot modify the canvas."
                            )
                        else:
                            selection_rules_lines.extend(
                                [
                                    "- Prioritize edits and creations relative to this selection. Do NOT modify non-selected nodes unless user explicitly asks.",
                                    "- When creating related nodes, place them adjacent to the selection and connect if requested.",
                                    "- Prefer using canvas_* tools on the selection (pass explicit node ids from the selection when applicable).",
                                ]
                            )
                        selection_rules = "\n".join(selection_rules_lines)

                        default_template = (
                            "=== CANVAS SELECTION CONTEXT ===\n"
                            "{selection_body}\n\n"
                            "SELECTION RULES:\n"
                            "{selection_rules}"
                        )
                        template = _load_fragment("selection_context.fragment.md", default_template)
                        selection_section = safe_format(
                            template,
                            selection_body=escape_braces(selection_body),
                            selection_rules=escape_braces(selection_rules),
                        )
                        system_content += "\n\n" + selection_section.strip("\n")

                    doc_context = md.get("doc_context")
                    if isinstance(doc_context, dict):
                        doc_item_id = str(doc_context.get("doc_item_id") or "").strip()
                        doc_title = str(doc_context.get("doc_title") or "").strip()
                        doc_mode = str(doc_context.get("mode") or "").strip().lower() or "doc"

                        selection_md = None
                        selection_payload = doc_context.get("selection")
                        if isinstance(selection_payload, dict):
                            raw_selection_md = selection_payload.get("markdown")
                            if isinstance(raw_selection_md, str):
                                selection_md = raw_selection_md.strip()

                        document_excerpt = None
                        document_payload = doc_context.get("document")
                        if isinstance(document_payload, dict):
                            raw_document_excerpt = document_payload.get("excerpt")
                            if isinstance(raw_document_excerpt, str):
                                document_excerpt = raw_document_excerpt.strip()

                        doc_body_lines: list[str] = []
                        if doc_item_id:
                            doc_body_lines.append(f"doc_item_id: {doc_item_id}")
                        if doc_title:
                            doc_body_lines.append(f"doc_title: {doc_title}")
                        doc_body_lines.append(f"doc_mode: {doc_mode}")
                        if selection_md:
                            doc_body_lines.append("selection_markdown:")
                            doc_body_lines.append(selection_md)
                        if document_excerpt:
                            doc_body_lines.append("document_excerpt:")
                            doc_body_lines.append(document_excerpt)

                        doc_rules_lines = [
                            "- The user is working in document mode (Markdown-centric editor).",
                            "- If selection_markdown exists, treat it as the highest-priority edit target.",
                            "- Keep edits localized when user intent is local; avoid rewriting the whole document unless explicitly requested.",
                            "- Return concrete replacement/insertable Markdown when user asks for writing help.",
                            "- When user asks to generate and insert images into the document, prefer doc_generate_image_and_insert.",
                        ]
                        if is_chat_mode:
                            doc_rules_lines.append(
                                "- Chat mode is read-only: provide suggested edits and patches; do not imply direct writes."
                            )
                        else:
                            doc_rules_lines.append(
                                "- Agent mode can execute write operations; prefer minimal, reversible changes."
                            )

                        doc_body = "\n".join(doc_body_lines)
                        doc_rules = "\n".join(doc_rules_lines)
                        default_template = (
                            "=== DOCUMENT CONTEXT ===\n"
                            "{doc_body}\n\n"
                            "DOCUMENT RULES:\n"
                            "{doc_rules}"
                        )
                        template = _load_fragment("doc_context.fragment.md", default_template)
                        doc_section = safe_format(
                            template,
                            doc_body=escape_braces(doc_body),
                            doc_rules=escape_braces(doc_rules),
                        )
                        system_content += "\n\n" + doc_section.strip("\n")

                    reference_images = md.get("reference_images")
                    if reference_images and isinstance(reference_images, list):
                        def _summ_refs(refs):
                            items = []
                            for idx, ref in enumerate(refs[:8]):
                                if not isinstance(ref, dict):
                                    continue
                                label = (
                                    (ref.get("label") or ref.get("node_id") or ref.get("file_id") or "image")
                                )
                                items.append(f"{idx + 1}. {label}")
                            more = max(0, len(refs) - 8)
                            if more:
                                items.append(f"(+{more} more)")
                            return "\n".join(items) if items else "none"

                        ref_section = "\n\n=== REFERENCE IMAGES ===\n"
                        ref_section += "The user has attached reference images for editing/generation.\n"
                        ref_section += _summ_refs(reference_images) + "\n"
                        ref_section += "Use these references when calling canvas_generate_image.\n"
                        system_content += ref_section

                    override_cta = cta_override if isinstance(cta_override, dict) else None
                    if override_cta and override_cta.get("action"):
                        cta_action = override_cta.get("action")
                        cta_label = override_cta.get("label")
                        cta_payload = override_cta.get("payload")
                    else:
                        cta_action = md.get("cta_action")
                        cta_label = md.get("cta_label")
                        cta_payload = md.get("cta_payload")
                    if cta_action:
                        cta_lines = []
                        if cta_label:
                            cta_lines.append(f"label: {cta_label}")
                        cta_lines.append(f"action: {cta_action}")
                        if cta_payload is not None:
                            try:
                                payload_text = json.dumps(cta_payload, ensure_ascii=True)
                            except Exception:
                                payload_text = str(cta_payload)
                            cta_lines.append(f"payload: {payload_text}")
                        cta_body = "\n".join(cta_lines)

                        default_template = "=== CTA ACTION ===\n{cta_body}"
                        template = _load_fragment("cta_context.fragment.md", default_template)
                        cta_section = safe_format(template, cta_body=escape_braces(cta_body))
                        system_content += "\n\n" + cta_section.strip("\n")
        except Exception as exc:
            # Do not fail system prompt building because of selection context
            logger.debug("Selection context injection skipped: %s", exc)

        if (
            agent_config
            and (agent_config.get("configured_mcps") or agent_config.get("custom_mcps"))
            and mcp_wrapper_instance
            and mcp_wrapper_instance._initialized
        ):
            mcp_lines: list[str] = []
            try:
                registered_schemas = mcp_wrapper_instance.get_schemas()
                for method_name, schema_list in registered_schemas.items():
                    for schema in schema_list:
                        if _schema_is_openapi(schema):
                            func_info = schema.schema.get("function", {})
                            description = func_info.get("description", "No description available")
                            mcp_lines.append(f"- **{method_name}**: {description}")

                            params = func_info.get("parameters", {})
                            props = params.get("properties", {})
                            if props:
                                mcp_lines.append(f"  Parameters: {', '.join(props.keys())}")

            except Exception as exc:
                logger.error(f"Error listing MCP tools: {exc}")
                mcp_lines.append("- Error loading MCP tool list")

            mcp_tools = "\n".join(mcp_lines)
            default_template = (
                "--- MCP Tools Available ---\n"
                "You have access to external MCP (Model Context Protocol) server tools.\n"
                "MCP tools are available via native function calling. Do not output XML/JSON tool payloads in chat.\n"
                "Available MCP tools:\n"
                "{mcp_tools}\n\n"
                "CRITICAL MCP TOOL RESULT INSTRUCTIONS\n"
                "When you use ANY MCP (Model Context Protocol) tools:\n"
                "1. ALWAYS read and use the EXACT results returned by the MCP tool\n"
                "2. For search tools: ONLY cite URLs, sources, and information from the actual search results\n"
                "3. For any tool: Base your response entirely on the tool's output - do NOT add external information\n"
                "4. DO NOT fabricate, invent, hallucinate, or make up any sources, URLs, or data\n"
                "5. If you need more information, call the MCP tool again with different parameters\n"
                "6. When writing reports/summaries: Reference ONLY the data from MCP tool results\n"
                "7. If the MCP tool doesn't return enough information, explicitly state this limitation\n"
                "8. Always double-check that every fact, URL, and reference comes from the MCP tool output\n\n"
                "IMPORTANT: MCP tool results are your PRIMARY and ONLY source of truth for external data!\n"
                "NEVER supplement MCP results with your training data or make assumptions beyond what the tools provide."
            )
            template = _load_fragment("mcp_tools.fragment.md", default_template)
            mcp_info = safe_format(template, mcp_tools=escape_braces(mcp_tools))
            system_content += "\n\n" + mcp_info.strip("\n")

        # Add XML tool calling instructions to system prompt if requested
        if include_xml_examples and tool_registry:
            system_content += (
                "\n\nTool calling is handled via native function calling. "
                "Do not output XML or JSON tool payloads in chat."
            )

        # Add built-in tool info dynamically to keep prompt aligned with reality
        try:
            tool_entries: list[tuple[str, str]] = []
            tool_names: list[str] = []
            prioritized_tool_order = {
                "task": 0,
            }

            def _tool_sort_key(name: str) -> tuple[int, int, str]:
                tool_name = str(name)
                if tool_name in prioritized_tool_order:
                    return (0, prioritized_tool_order[tool_name], tool_name)
                if tool_name.startswith("canvas_"):
                    return (1, 0, tool_name)
                if tool_name.startswith("transfer_to_"):
                    return (2, 0, tool_name)
                return (3, 0, tool_name)

            if tool_registry:
                if hasattr(tool_registry, "list_tools"):
                    specs = list(tool_registry.list_tools())
                    for spec in specs:
                        if str(spec.name).startswith("mcp__"):
                            continue
                        tool_entries.append(
                            (spec.name, getattr(spec, "description", "") or "No description available")
                        )
                        tool_names.append(spec.name)
                elif hasattr(tool_registry, "tools") and isinstance(tool_registry.tools, dict):
                    # Legacy registry path
                    ordered = list(tool_registry.tools.items())
                    try:
                        ordered.sort(
                            key=lambda kv: _tool_sort_key(str(kv[0]))
                        )
                    except Exception:
                        pass
                    for method_name, tool_info in ordered:
                        instance = tool_info.get("instance")
                        schema_obj = tool_info.get("schema")
                        if mcp_wrapper_instance and instance is mcp_wrapper_instance:
                            continue
                        if not schema_obj or not hasattr(schema_obj, "schema"):
                            continue
                        func = schema_obj.schema.get("function", {})
                        description = func.get("description", "No description available")
                        tool_entries.append((method_name, description))
                    tool_names = [name for name, _ in tool_entries]
            if tool_entries:
                try:
                    tool_entries.sort(
                        key=lambda entry: _tool_sort_key(str(entry[0]))
                    )
                except Exception:
                    pass

            if tool_entries:
                tool_lines: list[str] = []
                max_tool_hints = 12
                for idx, (method_name, description) in enumerate(tool_entries):
                    if idx >= max_tool_hints:
                        tool_lines.append(f"(and more: showing {max_tool_hints} of {len(tool_entries)})")
                        break
                    tool_lines.append(f"- {method_name}: {description}")
                tools_list = "\n".join(tool_lines)
                default_template = (
                    "--- Built-in Tools Available ---\n"
                    "You have access to built-in native tools.\n"
                    "{tools_list}"
                )
                template = _load_fragment("tools_list.fragment.md", default_template)
                tool_section = safe_format(template, tools_list=escape_braces(tools_list))
                system_content += "\n\n" + tool_section.strip("\n")

                tool_name_set = set(tool_names)

                if (
                    tool_names
                    and any(str(name).startswith("transfer_to_") for name in tool_names)
                    and not is_chat_mode
                    and not is_doc_surface
                ):
                    system_content += supervisor_instructions(SUPERVISOR_AGENT_DEFS.values())

                # If canvas read tools are registered, append a concise CANVAS CONTRACT
                try:
                    has_canvas_read = False
                    has_canvas_write = False
                    if tool_names:
                        has_canvas_read = any(n in tool_names for n in CANVAS_READ_TOOL_NAMES)
                        has_canvas_write = any(n in tool_names for n in CANVAS_WRITE_TOOL_NAMES)
                    elif tool_registry and hasattr(tool_registry, "tools"):
                        has_canvas_read = any(n in tool_registry.tools for n in CANVAS_READ_TOOL_NAMES)
                        has_canvas_write = any(n in tool_registry.tools for n in CANVAS_WRITE_TOOL_NAMES)
                    if has_canvas_read and not is_doc_surface:
                        if has_canvas_write and not is_chat_mode:
                            default_contract = """

--- CANVAS CONTRACT ---
You are collaborating on a visual canvas. Nodes/connections are plain JSON.

CANVAS TOOLS (CaC / single source of truth):
- Use ONLY: workspace_list_canvases, canvas_read, canvas_write, canvas_edit, canvas_generate_image
- Never call tool names that are not in the available tools list.

READ (canvas_read):
- Default scope is current thread-bound canvas.
- Use workspace_list_canvases only when user explicitly asks for global/workspace/cross-canvas reading.
- For global reading, paginate workspace_list_canvases sequentially and first-pass each canvas with where+limit before deeper reads.
- Optional canvas_id targets a specific canvas; omitted means thread-bound canvas.
- Use scope='selection' to read only selected nodes; default is all.
- scope='viewport' is best-effort: if viewport state is unavailable it falls back to a limited slice (use where/limit for targeted reads).
- Use where for filtering, e.g. { "type": "text", "content": { "$contains": "keyword" } }.

WRITE (canvas_write):
- Default write target is current thread-bound canvas.
- Cross-canvas write requires one explicit target canvas; ask user to clarify if ambiguous.
- Optional canvas_id targets a specific canvas; omitted means thread-bound canvas.
- Create new nodes and (optionally) connections with layout + anchor.
- Use temporary $id values ($1, $2, ...) for new nodes you need to reference later.
- Use the returned idMap to reference real node IDs in later calls.

EDIT (canvas_edit):
- Default edit target is current thread-bound canvas.
- Cross-canvas edit requires one explicit target canvas; ask user to clarify if ambiguous.
- Optional canvas_id targets a specific canvas; omitted means thread-bound canvas.
- Update nodes by ID: { "n1": { "content": "new" }, "n2": { "x": 100 } }.
- Delete nodes: { "$delete": ["n1", "n2"] }.
- Batch update with selector: { "$select": ".text[content*='TODO']", "$set": { "type": "todo" } }.
- Update canvas props: { "$canvas": { "title": "New Title" } }.
- Update/delete connections: { "$connections": { "conn-1": { "label": "..." }, "$delete": ["conn-2"] } }.
- Add connections between existing nodes: { "$connections": [ { "from": "node-1", "to": "node-2", "label": "..." } ] } or { "$operations": [ { "op": "add_connection", "from": "node-1", "to": "node-2", "label": "..." } ] }.

NODE TYPES:
- text: content (string), min 360x120
- todo: content (string), checkbox item
- code: content + codeType (mermaid|svg|html), min 420x260
- table: data { rows, columnWidths, rowHeights }
- group: children (node IDs), title in content first line
- column: children (node IDs), title in content first line
- canvas-link: title + targetCanvasId

NODE FIELDS:
- id (string), type, x, y, width, height, content
- Code nodes: add codeType
- Title: ONLY for canvas-link; groups/columns use content first line

MERMAID RULES:
- Allowed: flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt, pie, journey, mindmap, timeline
- First line declares type (e.g., flowchart LR)
- No Markdown fences, no classDef/style/init/CSS
- IDs: ASCII only; Chinese in labels with quotes or [label]

STRUCTURE GUIDELINES:
- One idea per node; preserve all essential details
- Layout matches structure: lists -> stack; comparisons -> row; processes -> chain; hierarchies -> mindmap/tree
- 5+ related nodes -> create a group
- Text nodes min 360x120; Mermaid min 420x260

IMAGE GENERATION (canvas_generate_image):
- Use for images/illustrations/photos/posters
- Draft a clear prompt before calling
- Use code nodes for diagrams/flowcharts instead

Response: Summarize changes; keep replies concise.
"""
                            canvas_contract = _load_fragment("canvas_contract.fragment.md", default_contract)
                            system_content += canvas_contract
                        else:
                            if is_chat_mode:
                                system_content += (
                                    "\n\n--- CANVAS ACCESS ---\n"
                                    "Canvas is read-only in Chat mode. You may read for context, but do not "
                                    "attempt edits or delegations.\n"
                                )
                            else:
                                system_content += (
                                    "\n\n--- CANVAS ACCESS ---\n"
                                    "Canvas is read-only for this agent. "
                                    "To write, delegate via transfer_to_canvas_agent.\n"
                                )
                except Exception:
                    pass

                # Append Canvas Tools Quickstart (built from usage_example decorators)
                try:
                    if tool_registry and hasattr(tool_registry, "get_usage_examples") and tool_names:
                        if any(str(name).startswith("canvas_") for name in tool_names):
                            usage_examples = tool_registry.get_usage_examples()
                            canvas_examples = {
                                k: v
                                for k, v in usage_examples.items()
                                if str(k).startswith("canvas_") and v
                            }
                            if canvas_examples:
                                system_content += "\n\n--- CANVAS TOOLS QUICKSTART ---\n"
                                system_content += (
                                    "Use native function calling to invoke canvas_* tools. "
                                    "Do not output tool call payloads in chat.\n"
                                )
                except Exception:
                    pass
        except Exception as exc:
            logger.error(f"Error adding tool list to system prompt: {exc}")

        if is_chat_mode:
            has_tools = False
            if tool_registry and hasattr(tool_registry, "list_tools"):
                try:
                    has_tools = bool(tool_registry.list_tools())
                except Exception:
                    has_tools = False
            if has_tools:
                chat_mode_header = "--- CHAT MODE (READ-ONLY) ---"
                chat_mode_notice = (
                    "This run is in Chat mode. You may use read-only tools for context, but do NOT perform "
                    "any write or side-effect actions, and do NOT delegate or hand off to other agents. "
                    "If the user asks for changes, explain that Chat mode is read-only and suggest switching "
                    "to Agent mode for execution."
                )
            else:
                chat_mode_header = "--- CHAT MODE ---"
                chat_mode_notice = (
                    "This run is in Chat mode. Tools are disabled. Answer directly and do not attempt "
                    "any tool calls, delegations, or side-effect actions. If the user asks for changes, "
                    "suggest switching to Agent mode for execution."
                )
            default_template = "{chat_mode_header}\n{chat_mode_notice}"
            template = _load_fragment("chat_mode.fragment.md", default_template)
            chat_mode_section = safe_format(
                template,
                chat_mode_header=escape_braces(chat_mode_header),
                chat_mode_notice=escape_braces(chat_mode_notice),
            )
            system_content += "\n\n" + chat_mode_section.strip("\n")

        now = None
        if datetime_override:
            try:
                parsed = datetime.datetime.fromisoformat(str(datetime_override))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=datetime.timezone.utc)
                now = parsed
            except Exception:
                now = None
        if now is None:
            now = datetime.datetime.now(datetime.timezone.utc)
        datetime_lines = [
            f"Today's date: {now.strftime('%A, %B %d, %Y')}",
            f"Current year: {now.strftime('%Y')}",
            f"Current month: {now.strftime('%B')}",
            f"Current day: {now.strftime('%A')}",
            "Use this information for any time-sensitive tasks, research, or when current date/time context is needed.",
        ]
        datetime_context = "\n".join(datetime_lines)
        default_template = "=== CURRENT DATE/TIME INFORMATION ===\n{datetime_context}"
        template = _load_fragment("datetime.fragment.md", default_template)
        datetime_section = safe_format(
            template,
            datetime_context=escape_braces(datetime_context),
        )

        system_content += "\n\n" + datetime_section.strip("\n")

        return {"role": "system", "content": system_content}
