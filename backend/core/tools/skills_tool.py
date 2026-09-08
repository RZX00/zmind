from __future__ import annotations

import json
import uuid
from typing import Any, Dict, Optional

from core.langgraph_engine.supervisor.agent_defs import AgentDef
from core.langgraph_engine.research_graph.utils import extract_json_payload
from core.langgraph_engine.checkpoint_store import MemoryCheckpointStore, SupabaseCheckpointStore
from core.langgraph_engine.contracts.engine_interface import RunConfig
from core.langgraph_engine.engine import LangGraphEngine
from core.langgraph_engine.supervisor.subagent_runner import BillingOnlyEventPersister
from core.langgraph_engine.tools.catalog import build_registry
from core.services.supabase import DBConnection
from core.services.skills_import import SkillsImportService, SkillImportError
from core.services.skillsmp_client import get_skillsmp_client
from core.tools.base import Tool, ToolResult, openapi_schema, usage_example
from core.utils.logger import logger

from core.skills.registry import get_skill_by_name, get_skill_by_id, load_all_skills
from core.skills.types import SkillDefinition
from core.skills.hooks import get_hook_executor
from core.skills.fork_context import get_fork_executor


class SkillsTool(Tool):
    """Skill registry and execution tool (Official Standard)."""

    def __init__(
        self,
        *,
        thread_id: str,
        account_id: Optional[str] = None,
        agent_config: Optional[dict] = None,
        db_connection: Optional[DBConnection] = None,
        run_config: Optional[Any] = None,
        parent_state: Optional[dict] = None,
        tool_context: Optional[dict] = None,
    ) -> None:
        super().__init__()
        self.thread_id = thread_id
        self.account_id = account_id
        self.agent_config = agent_config or {}
        self.db = db_connection or DBConnection()
        self.run_config = run_config
        self.parent_state = parent_state or {}
        self.tool_context = tool_context or {}
        self.hook_executor = get_hook_executor()
        self.fork_executor = get_fork_executor()

    async def _get_account_id(self) -> Optional[str]:
        if self.account_id:
            return self.account_id
        try:
            client = await self.db.client
            res = (
                await client.table("threads")
                .select("account_id")
                .eq("thread_id", self.thread_id)
                .limit(1)
                .execute()
            )
            if res.data and len(res.data) > 0:
                return res.data[0].get("account_id")
        except Exception as exc:
            logger.warning("SkillsTool: failed to resolve account_id", error=str(exc))
        return None

    def _format_skill_prompt(self, skill: SkillDefinition) -> str:
        schema_text = ""
        output_schema = None
        if isinstance(skill.metadata, dict):
            output_schema = skill.metadata.get("output_schema") or skill.metadata.get("output-schema")
        if output_schema is not None:
            try:
                schema_text = json.dumps(output_schema, ensure_ascii=True, indent=2)
            except Exception:
                schema_text = json.dumps(output_schema, ensure_ascii=True)
        prompt_parts = [
            f"You are executing the skill: {skill.name}.",
        ]
        if skill.description:
            prompt_parts.append(f"Goal: {skill.description}")
        if schema_text:
            prompt_parts.append("Return JSON that matches this schema:")
            prompt_parts.append(schema_text)
        prompt_parts.append("Return only the JSON object and no extra text.")
        prompt_parts.append(skill.prompt.strip())
        return "\n".join(prompt_parts)

    def _parse_json_text(self, text: str) -> Any:
        if not text:
            return None
        try:
            return json.loads(text)
        except Exception:
            return extract_json_payload(text)

    def _validate_output_schema(self, payload: Any, schema: Any) -> tuple[bool, list[str]]:
        """Lightweight runtime check of a skill output against its declared output_schema
        (required keys + top-level types; stdlib only, no jsonschema dep). This promotes
        output_schema from advisory prompt text to an actual measured gate — the seed of
        'a skill structurally cannot publish malformed output'. Warn-then-gate: callers
        currently surface the result rather than hard-fail."""
        errors: list[str] = []
        if not isinstance(schema, dict):
            return True, errors
        if schema.get("type") == "object" and not isinstance(payload, dict):
            return False, [f"expected object, got {type(payload).__name__}"]
        if not isinstance(payload, dict):
            return True, errors
        _TYPES = {
            "string": str, "number": (int, float), "integer": int,
            "boolean": bool, "object": dict, "array": list,
        }
        for key in (schema.get("required") or []):
            if key not in payload:
                errors.append(f"missing required key: {key}")
        props = schema.get("properties") or {}
        if isinstance(props, dict):
            for key, spec in props.items():
                if key in payload and isinstance(spec, dict):
                    expected = spec.get("type")
                    if expected in _TYPES and not isinstance(payload[key], _TYPES[expected]):
                        errors.append(f"key '{key}' expected {expected}")
        return (len(errors) == 0), errors

    def _extract_tool_output(
        self, tool_messages: Any, allowed_tools: set[str]
    ) -> Optional[Dict[str, Any]]:
        if not isinstance(tool_messages, list) or not allowed_tools:
            return None
        for msg in reversed(tool_messages):
            if not isinstance(msg, dict):
                continue
            name = msg.get("name")
            if name not in allowed_tools:
                continue
            if msg.get("success") is False:
                continue
            content = msg.get("content")
            if not isinstance(content, str):
                continue
            payload = self._parse_json_text(content)
            if not isinstance(payload, dict):
                continue
            data = payload.get("data")
            if isinstance(data, dict):
                return data
            if "syntax" in payload:
                return payload
        return None

    def _build_agent_def(self, skill: SkillDefinition) -> AgentDef:
        allowlist = [name for name in skill.allowed_tools or [] if name and not name.startswith("transfer_to_")]
        allow_mcp = any(name.startswith("mcp__") for name in allowlist)
        allow_mcp_prefix = any(name.startswith("mcp__") and "*" in name for name in allowlist)
        allowed_prefixes = ("mcp__",) if allow_mcp_prefix else None
        allowed_names = set(allowlist) if allowlist else None
        return AgentDef(
            name=f"skill_{skill.name}",
            display_name=skill.name,
            prompt=self._format_skill_prompt(skill),
            allowed_names=allowed_names,
            allowed_prefixes=allowed_prefixes,
            allow_mcp=allow_mcp,
            max_iterations=4,
        )

    @openapi_schema(
        {
            "type": "function",
            "function": {
                "name": "list_skills",
                "description": "List built-in and user-defined skills.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "include_disabled": {
                            "type": "boolean",
                            "description": "Include disabled user skills.",
                            "default": False,
                        },
                        "include_prompt": {
                            "type": "boolean",
                            "description": "Include full prompt text in the response.",
                            "default": False,
                        }
                    },
                },
            },
        }
    )
    @usage_example(
        """
<function_calls>
  <invoke name="list_skills">
    <parameter name="include_disabled">false</parameter>
  </invoke>
</function_calls>
"""
    )
    async def list_skills(
        self,
        include_disabled: bool = False,
        include_prompt: bool = False,
    ) -> ToolResult:
        account_id = await self._get_account_id()
        skills = await load_all_skills(
            db=self.db,
            account_id=account_id,
            include_disabled=bool(include_disabled),
        )
        def to_public(skill: SkillDefinition, include_prompt: bool) -> dict[str, Any]:
            data: dict[str, Any] = {
                "name": skill.name,
                "description": skill.description,
                "allowed-tools": skill.allowed_tools,
                "user-invocable": skill.user_invocable,
                "disable-model-invocation": skill.disable_model_invocation,
            }
            if include_prompt:
                data["prompt"] = skill.prompt
            if skill.model is not None:
                data["model"] = skill.model
            if skill.context is not None:
                data["context"] = skill.context
            if skill.agent is not None:
                data["agent"] = skill.agent
            if skill.argument_hint is not None:
                data["argument-hint"] = skill.argument_hint
            if skill.license is not None:
                data["license"] = skill.license
            if skill.source is not None:
                data["source"] = skill.source
            if skill.location is not None:
                data["location"] = skill.location
            return data

        payload = {"skills": [to_public(skill, bool(include_prompt)) for skill in skills]}
        return self.success_response(payload)

    @openapi_schema(
        {
            "type": "function",
            "function": {
                "name": "install_skill",
                "description": "Install a skill from GitHub, manual markdown, or marketplace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "source_type": {
                            "type": "string",
                            "enum": ["github", "manual", "marketplace"],
                            "description": "Source type for the skill.",
                        },
                        "github_url": {
                            "type": "string",
                            "description": "GitHub blob URL to a SKILL.md file (for source_type=github).",
                        },
                        "markdown_content": {
                            "type": "string",
                            "description": "Full SKILL.md content (for source_type=manual).",
                        },
                        "marketplace_skill_id": {
                            "type": "string",
                            "description": "SkillsMP marketplace skill ID (for source_type=marketplace).",
                        },
                        "force": {
                            "type": "boolean",
                            "default": False,
                            "description": "Overwrite existing skill with the same name.",
                        },
                    },
                    "required": ["source_type"],
                },
            },
        }
    )
    @usage_example(
        """
<function_calls>
  <invoke name="install_skill">
    <parameter name="source_type">manual</parameter>
    <parameter name="markdown_content">---\\nname: my-skill\\ndescription: Example\\n---\\n\\nDo the thing.</parameter>
  </invoke>
</function_calls>
"""
    )
    async def install_skill(
        self,
        source_type: str,
        github_url: Optional[str] = None,
        markdown_content: Optional[str] = None,
        marketplace_skill_id: Optional[str] = None,
        force: bool = False,
    ) -> ToolResult:
        account_id = await self._get_account_id()
        if not account_id:
            return self.fail_response("Skill install failed. Missing account context.")

        import_service = SkillsImportService(self.db)
        try:
            if source_type == "github":
                if not github_url:
                    return self.fail_response("GitHub URL is required.")
                result = await import_service.import_from_github(
                    github_url=github_url,
                    account_id=account_id,
                    force=bool(force),
                )
            elif source_type == "manual":
                if not markdown_content:
                    return self.fail_response("Markdown content is required.")
                result = await import_service.import_from_raw_markdown(
                    markdown_content=markdown_content,
                    account_id=account_id,
                    force=bool(force),
                    source_type="manual",
                    source_url=None,
                )
            elif source_type == "marketplace":
                if not marketplace_skill_id:
                    return self.fail_response("Marketplace skill ID is required.")
                client = get_skillsmp_client()
                if not client.api_key:
                    return self.fail_response("Marketplace integration is not configured.")

                skill_detail = await client.get_skill_detail_from_search(
                    marketplace_skill_id
                )
                marketplace_metadata = {
                    "marketplace_id": marketplace_skill_id,
                    "author": skill_detail.author,
                    "install_count": skill_detail.stars,
                    "rating": None,
                    "tags": [],
                    "category": None,
                    "version": skill_detail.version,
                }

                result = await import_service.import_from_raw_markdown(
                    markdown_content=skill_detail.markdown_content,
                    account_id=account_id,
                    force=bool(force),
                    source_type="marketplace",
                    source_url=f"https://skillsmp.com/skills/{marketplace_skill_id}",
                    marketplace_metadata=marketplace_metadata,
                )
            else:
                return self.fail_response("Unsupported source type.")

            skill = result.get("skill")
            compatibility = result.get("compatibility")
            created = result.get("created", False)

            message = f"Installed skill '{skill.name}'." if skill else "Skill installed."
            if compatibility and compatibility.get("status") != "compatible":
                message = f"{message} {compatibility.get('reason', '')}".strip()

            payload = {
                "skill": skill.to_public_dict() if skill else None,
                "compatibility": compatibility,
                "created": created,
                "message": message,
            }
            return self.success_response(payload)
        except SkillImportError as exc:
            return self.fail_response(str(exc))
        except Exception as exc:
            logger.error("Skill install failed", error=str(exc))
            return self.fail_response("Skill install failed.")
        finally:
            await import_service.close()

    @openapi_schema(
        {
            "type": "function",
            "function": {
                "name": "run_skill",
                "description": "Run a skill by name with the given input. Supports fork context and hooks.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "skill_id": {"type": "string", "description": "Skill name (identifier)."},
                        "input": {"type": "string", "description": "Task input for the skill."},
                        "context": {"type": "string", "description": "Optional extra context."},
                        "output_mode": {
                            "type": "string",
                            "enum": ["last_message", "full_history"],
                            "default": "last_message",
                        },
                    },
                    "required": ["skill_id"],
                },
            },
        }
    )
    @usage_example(
        """
<function_calls>
  <invoke name="run_skill">
    <parameter name="skill_id">ppt-plan</parameter>
    <parameter name="input">Create a 10-slide deck for a SaaS pitch.</parameter>
  </invoke>
</function_calls>
"""
    )
    async def run_skill(
        self,
        skill_id: str,
        input: Optional[str] = None,
        context: Optional[str] = None,
        task_run_id: Optional[str] = None,
        output_mode: str = "last_message",
    ) -> ToolResult:
        account_id = await self._get_account_id()
        skill = await get_skill_by_name(skill_id, db=self.db, account_id=account_id)
        if not skill:
            return self.fail_response(f"Skill not found: {skill_id}")
        if skill.disable_model_invocation:
            return self.fail_response(
                "Skill execution blocked: disable-model-invocation is enabled."
            )
        if not self.run_config:
            return self.fail_response("Skill runner is unavailable (missing run_config).")

        # Fork context execution（官方标准）
        if skill.context == "fork":
            return await self._run_skill_fork(skill, input, context)

        agent_def = self._build_agent_def(skill)

        skill_run_id = str(task_run_id or "").strip()
        if not skill_run_id:
            skill_run_id = f"skill_{skill.name}_{uuid.uuid4().hex}"

        mcp_service = self.tool_context.get("mcp_service") if agent_def.allow_mcp else None
        allowed_prefixes = set(agent_def.allowed_prefixes or [])
        tool_registry = build_registry(
            mcp_service=mcp_service,
            allowed_names=agent_def.allowed_names,
            allowed_prefixes=allowed_prefixes or None,
        )

        checkpoint_store = None
        try:
            checkpoint_store = SupabaseCheckpointStore(db_connection=self.db)
        except Exception as exc:
            logger.warning("Skill checkpoint store unavailable; falling back to memory", error=str(exc))
            checkpoint_store = MemoryCheckpointStore()

        loaded_state = None
        try:
            loaded_state = await checkpoint_store.load(skill_run_id, None)
        except Exception:
            loaded_state = None

        if loaded_state:
            # Defensive: enforce thread/account invariants based on checkpoint payload.
            if str(loaded_state.get("thread_id") or "") != str(self.thread_id):
                return self.fail_response("task_run_id checkpoint does not match this thread.")
            if str(loaded_state.get("account_id") or "") != str(account_id or self.account_id or ""):
                return self.fail_response("task_run_id checkpoint does not match this account.")

        prompt_parts = [input.strip()] if isinstance(input, str) and input.strip() else []
        if context and isinstance(context, str) and context.strip():
            prompt_parts.append(f"Context:\n{context.strip()}")
        if not prompt_parts:
            prompt_parts = ["Run the skill."]
        user_prompt = "\n\n".join(prompt_parts)

        initial_messages = None
        append_messages = None
        reset_loaded_state = False
        if loaded_state:
            append_messages = [{"role": "user", "content": user_prompt}]
            reset_loaded_state = True
        else:
            initial_messages = [
                {"role": "system", "content": agent_def.prompt},
                {"role": "user", "content": user_prompt},
            ]

        run_config = RunConfig(
            agent_run_id=skill_run_id,
            thread_id=self.thread_id,
            project_id=self.tool_context.get("project_id"),
            account_id=str(account_id or self.account_id or ""),
            model_name=skill.model or getattr(self.run_config, "model_name", None) or "openai/gpt-4o-mini",
            enable_thinking=getattr(self.run_config, "enable_thinking", False),
            reasoning_effort=getattr(self.run_config, "reasoning_effort", "low"),
            enable_context_manager=False,
            enable_prompt_caching=False,
            agent_config=None,
            max_iterations=agent_def.max_iterations,
            engine=getattr(self.run_config, "engine", "langgraph"),
            engine_version=getattr(self.run_config, "engine_version", "v1"),
            is_shadow=getattr(self.run_config, "is_shadow", False),
            shadow_parent_run_id=getattr(self.run_config, "shadow_parent_run_id", None),
            side_effect_policy=getattr(self.run_config, "side_effect_policy", "allow_all"),
            checkpoint_id=None,
            stop_event=getattr(self.run_config, "stop_event", None),
            initial_messages_context=initial_messages,
            append_messages_context=append_messages,
            reset_loaded_state=reset_loaded_state,
        )

        engine = LangGraphEngine(
            tool_registry=tool_registry,
            tool_context=self.tool_context,
            checkpoint_store=checkpoint_store,
            event_persister=BillingOnlyEventPersister(),
            persist_events=True,
        )

        assistant_messages: list[dict[str, Any]] = []
        tool_messages: list[dict[str, Any]] = []
        last_error: str | None = None

        async for event in engine.run(run_config):
            if event.get("type") == "assistant_final":
                content = event.get("content")
                if isinstance(content, dict):
                    assistant_messages.append(content)
            if event.get("type") == "tool_call" and skill.hooks:
                # Execute PreToolUse hook before tool execution
                should_continue, hook_msg = await self.hook_executor.execute_pre_tool_use(
                    skill=skill,
                    tool_name=event.get("name", ""),
                    tool_input=event.get("input", {}),
                    thread_id=self.thread_id,
                    account_id=str(account_id or ""),
                )
                if not should_continue:
                    last_error = hook_msg or "PreToolUse hook aborted execution"
                    break
            if event.get("type") == "tool_message":
                tool_messages.append(
                    {
                        "name": event.get("name"),
                        "content": event.get("content"),
                        "success": event.get("success"),
                        "error": event.get("error"),
                        "tool_call_id": event.get("tool_call_id"),
                    }
                )
                # Execute PostToolUse hook after tool execution
                if skill.hooks:
                    await self.hook_executor.execute_post_tool_use(
                        skill=skill,
                        tool_name=event.get("name", ""),
                        tool_output=event.get("content"),
                        thread_id=self.thread_id,
                        account_id=str(account_id or ""),
                    )
            if event.get("type") == "error":
                last_error = str(event.get("message") or "skill_error")

        if last_error:
            return self.fail_response(last_error)

        if output_mode == "full_history":
            output_payload = {"messages": assistant_messages, "tool_messages": tool_messages}
        else:
            last_message = assistant_messages[-1] if assistant_messages else {"role": "assistant", "content": ""}
            output_payload = {
                "agent": agent_def.name,
                "display_name": agent_def.display_name,
                "content": str(last_message.get("content") or ""),
                "tool_messages": tool_messages,
            }

        result = {"success": True, "output": output_payload, "error": None}

        if not result.get("success"):
            return self.fail_response(result.get("error") or "Skill execution failed.")

        output_payload = result.get("output")
        parsed_output = None
        if isinstance(output_payload, dict):
            content = output_payload.get("content")
            if isinstance(content, str):
                parsed_output = self._parse_json_text(content)

        allowed_tools = set(skill.allowed_tools or [])
        tool_output = None
        if isinstance(output_payload, dict):
            tool_output = self._extract_tool_output(output_payload.get("tool_messages"), allowed_tools)
        if isinstance(tool_output, dict):
            if "syntax" in tool_output or parsed_output is None:
                parsed_output = tool_output

        response = {
            "skill_name": skill.name,
            "task_run_id": skill_run_id,
            "output": parsed_output or output_payload,
        }
        if parsed_output is not None:
            response["raw_output"] = output_payload

        # Runtime output_schema gate (warn-then-gate): make the declared schema an actual
        # measured contract instead of advisory prompt text.
        output_schema = None
        if isinstance(skill.metadata, dict):
            output_schema = skill.metadata.get("output_schema") or skill.metadata.get("output-schema")
        if output_schema is not None and parsed_output is not None:
            ok, errs = self._validate_output_schema(parsed_output, output_schema)
            response["schema_validation"] = {"valid": ok, "errors": errs}
            if not ok:
                logger.warning(
                    "skill output failed output_schema", skill=skill.name, errors=errs
                )

        return self.success_response(response)

    async def _run_skill_fork(
        self,
        skill: SkillDefinition,
        user_input: Optional[str],
        context: Optional[str],
    ) -> ToolResult:
        """Execute skill in fork context（隔离执行环境）"""
        account_id = await self._get_account_id()
        if not account_id:
            return self.fail_response("Account ID required for fork context")

        prompt_parts = [user_input.strip()] if user_input and user_input.strip() else []
        if context and context.strip():
            prompt_parts.append(f"Context:\n{context.strip()}")
        final_input = "\n\n".join(prompt_parts) if prompt_parts else "Run the skill."

        result = await self.fork_executor.execute(
            skill=skill,
            user_input=final_input,
            parent_thread_id=self.thread_id,
            parent_run_id=getattr(self.run_config, "agent_run_id", None) or str(uuid.uuid4()),
            account_id=account_id,
            project_id=self.tool_context.get("project_id"),
            db=self.db,
            base_model=getattr(self.run_config, "model_name", None) or "openai/gpt-4o-mini",
            agent_config=self.agent_config,
        )

        if not result.get("success"):
            return self.fail_response(result.get("error") or "Fork execution failed")

        return self.success_response({
            "skill_name": skill.name,
            "fork_thread_id": result.get("fork_thread_id"),
            "output": result.get("output"),
            "execution_mode": "fork",
        })
