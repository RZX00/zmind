"""
Fork context execution for skills (Official Standard).

When a skill has `context: fork`, it runs in an isolated execution environment:
- Separate conversation history (new thread)
- Isolated tool registry (only allowed-tools for the skill)
- Independent memory checkpoint
- Model override support
- Parent-child relationship tracking

This allows skills to execute complex tasks without polluting the main conversation.
"""

from __future__ import annotations

import uuid
from typing import Any, AsyncIterator, Optional

from core.langgraph_engine.checkpoint_store import MemoryCheckpointStore
from core.langgraph_engine.contracts.engine_interface import BaseEngine, RunConfig
from core.langgraph_engine.contracts.tool_interface import ToolRegistry
from core.langgraph_engine.contracts.event_schema import EngineEvent
from core.langgraph_engine.engine import LangGraphEngine
from core.langgraph_engine.tools.catalog import build_registry
from core.services.supabase import DBConnection
from core.utils.logger import logger

from .types import SkillDefinition


class ForkContextExecutor:
    """Execute skill in isolated fork context.

    Fork context provides complete isolation:
    - New thread ID (conversation history)
    - Isolated tool registry (only allowed-tools)
    - Separate checkpoint store (memory)
    - Model override support
    - Parent-child relationship tracking
    """

    async def execute(
        self,
        skill: SkillDefinition,
        user_input: str,
        *,
        parent_thread_id: str,
        parent_run_id: str,
        account_id: str,
        project_id: str,
        db: DBConnection,
        base_model: str = "openai/gpt-4o-mini",
        agent_config: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Execute skill in isolated fork context.

        Args:
            skill: Skill definition with context: fork
            user_input: User's input/request for the skill
            parent_thread_id: Parent conversation thread ID
            parent_run_id: Parent agent run ID
            account_id: User account ID
            project_id: Project ID
            db: Database connection
            base_model: Base model to use (can be overridden by skill.model)
            agent_config: Agent configuration

        Returns:
            Result dictionary with:
            - success: bool
            - output: str (final response from fork)
            - fork_thread_id: str (isolated thread ID)
            - fork_run_id: str (isolated run ID)
            - messages: list (all messages from fork)
        """
        logger.info(
            "Executing skill in fork context",
            skill=skill.name,
            parent_thread=parent_thread_id,
            parent_run=parent_run_id,
        )

        # Create isolated thread ID for fork
        fork_thread_id = f"fork-{uuid.uuid4().hex[:16]}"
        fork_run_id = f"run-{uuid.uuid4().hex[:16]}"

        # Use skill's model override or base model
        model_name = skill.model or base_model

        # Build isolated tool registry (only allowed-tools)
        # Note: We don't pass MCP service here for security isolation
        fork_tool_registry = self._build_fork_tool_registry(
            skill=skill,
            mcp_service=None,
        )

        # Create isolated checkpoint store
        fork_checkpoint_store = MemoryCheckpointStore()

        # Create isolated engine
        fork_engine = LangGraphEngine(
            checkpoint_store=fork_checkpoint_store,
            tool_registry=fork_tool_registry,
            persist_events=True,  # Still persist events for observability
            tool_context={
                "db_connection": db,
                "db": db,
                "account_id": account_id,
                "project_id": project_id,
                "parent_thread_id": parent_thread_id,
                "parent_run_id": parent_run_id,
                "is_fork": True,
                "fork_skill_name": skill.name,
            },
        )

        system_prompt = str(skill.prompt or "").strip()
        if "{input}" in system_prompt:
            system_prompt = system_prompt.replace("{input}", user_input)
        if "{query}" in system_prompt:
            system_prompt = system_prompt.replace("{query}", user_input)
        if not system_prompt:
            system_prompt = "You are executing a skill."

        user_prompt = str(user_input or "").strip() or "Run the skill."

        # Build run configuration for fork
        fork_config = RunConfig(
            agent_run_id=fork_run_id,
            thread_id=fork_thread_id,
            project_id=project_id,
            account_id=account_id,
            model_name=model_name,
            enable_thinking=False,  # Forks don't use thinking mode
            reasoning_effort="medium",
            enable_context_manager=False,  # Forks don't need context manager
            enable_prompt_caching=True,
            agent_config=agent_config or {},
            max_iterations=50,  # Forks have limited iterations
            initial_messages_context=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            engine="langgraph",
            engine_version="2.0",
            is_shadow=True,  # Mark as shadow/fork execution
            shadow_parent_run_id=parent_run_id,
            side_effect_policy="readonly",  # Forks are read-only by default
        )

        # Execute fork
        try:
            final_state = None
            all_events = []

            async for event in fork_engine.run(fork_config):
                all_events.append(event)

                # Note: We don't track state_snapshot events here
                # Final state will be loaded from checkpoint after completion

            # Load final state from checkpoint after execution completes
            final_state = await fork_checkpoint_store.load(fork_run_id, None)

            # Extract final response
            final_output = self._extract_final_output(final_state, all_events)

            logger.info(
                "Fork context execution completed",
                skill=skill.name,
                fork_thread=fork_thread_id,
                fork_run=fork_run_id,
                success=True,
            )

            return {
                "success": True,
                "output": final_output,
                "fork_thread_id": fork_thread_id,
                "fork_run_id": fork_run_id,
                "messages": final_state.get("messages_context", []) if final_state else [],
                "parent_thread_id": parent_thread_id,
                "parent_run_id": parent_run_id,
                "skill_name": skill.name,
            }

        except Exception as exc:
            logger.error(
                "Fork context execution failed",
                skill=skill.name,
                fork_thread=fork_thread_id,
                error=str(exc),
            )
            return {
                "success": False,
                "output": f"Fork execution failed: {exc}",
                "fork_thread_id": fork_thread_id,
                "fork_run_id": fork_run_id,
                "messages": [],
                "parent_thread_id": parent_thread_id,
                "parent_run_id": parent_run_id,
                "skill_name": skill.name,
                "error": str(exc),
            }

    def _build_fork_tool_registry(
        self,
        skill: SkillDefinition,
        mcp_service: Any = None,
    ) -> ToolRegistry:
        """Build isolated tool registry for fork context.

        Only includes tools specified in skill's allowed-tools list.

        Args:
            skill: Skill definition
            mcp_service: Optional MCP service for external tools

        Returns:
            Isolated ToolRegistry with only allowed tools
        """
        # If no allowed-tools specified, default to full native tool catalog
        if not skill.allowed_tools:
            logger.debug(
                "Fork context using full native tool registry (no allowed-tools specified)",
                skill=skill.name,
            )
            return build_registry(mcp_service=mcp_service)

        # Build registry with only allowed tools
        allowed_set = set(skill.allowed_tools)
        fork_registry = build_registry(
            mcp_service=mcp_service,
            allowed_names=allowed_set,
        )

        logger.debug(
            "Fork context using filtered tool registry",
            skill=skill.name,
            allowed_tools=list(allowed_set),
        )

        return fork_registry

    def _extract_final_output(
        self,
        final_state: Optional[dict[str, Any]],
        all_events: list[EngineEvent],
    ) -> str:
        """Extract final output from fork execution.

        Args:
            final_state: Final graph state
            all_events: All events from fork execution

        Returns:
            Final response text
        """
        if not final_state:
            return "Fork execution completed with no output."

        # Try to get last assistant message
        messages = final_state.get("messages_context", [])
        for msg in reversed(messages):
            if isinstance(msg, dict) and msg.get("role") == "assistant":
                content = msg.get("content", "")
                if isinstance(content, str) and content.strip():
                    return content.strip()

        # Fallback: check for termination message
        termination = final_state.get("termination", {})
        if isinstance(termination, dict):
            reason = termination.get("reason", "")
            if reason and reason != "not_finished":
                return f"Fork completed: {reason}"

        return "Fork execution completed."


# Global fork context executor instance
_fork_executor: Optional[ForkContextExecutor] = None


def get_fork_executor() -> ForkContextExecutor:
    """Get global fork context executor instance (singleton).

    Returns:
        Global ForkContextExecutor instance
    """
    global _fork_executor
    if _fork_executor is None:
        _fork_executor = ForkContextExecutor()
    return _fork_executor
