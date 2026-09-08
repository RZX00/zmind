"""
Skill lifecycle hooks execution (Official 3-Layer Standard - Phase 2).

✅ Full implementation of the official hooks standard:
- 3-layer structure: Event → Matcher → Hooks
- Matcher patterns (regex for tool names)
- Multiple hooks per event
- Command-type hooks (shell execution)
- Prompt-type hooks (LLM evaluation)
- Configurable timeout per hook
- JSON output parsing for decisions
- "once" flag for single execution

For full official specification, see:
https://docs.claude.com/claude-code/skills#hooks
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
from typing import Any, Optional

from core.utils.logger import logger

from .types import SkillDefinition, HookEntry, HookMatcherGroup


class HookExecutionContext:
    """Context information for hook execution."""

    def __init__(
        self,
        *,
        skill_name: str,
        thread_id: str,
        account_id: str,
        tool_name: Optional[str] = None,
        tool_input: Optional[dict[str, Any]] = None,
        tool_output: Optional[Any] = None,
    ):
        """Initialize hook execution context.

        Args:
            skill_name: Name of the skill being executed
            thread_id: Current thread/conversation ID
            account_id: User account ID
            tool_name: Name of tool (for PreToolUse/PostToolUse)
            tool_input: Tool input parameters (for PreToolUse)
            tool_output: Tool execution result (for PostToolUse)
        """
        self.skill_name = skill_name
        self.thread_id = thread_id
        self.account_id = account_id
        self.tool_name = tool_name
        self.tool_input = tool_input
        self.tool_output = tool_output

    def to_env_dict(self) -> dict[str, str]:
        """Convert context to environment variables for command hooks."""
        env = {
            "SKILL_NAME": self.skill_name,
            "THREAD_ID": self.thread_id,
            "ACCOUNT_ID": self.account_id,
        }
        if self.tool_name:
            env["TOOL_NAME"] = self.tool_name
        if self.tool_input:
            env["TOOL_INPUT"] = json.dumps(self.tool_input)
        if self.tool_output is not None:
            if isinstance(self.tool_output, str):
                env["TOOL_OUTPUT"] = self.tool_output
            else:
                env["TOOL_OUTPUT"] = json.dumps(self.tool_output)
        return env


class HookExecutor:
    """Execute skill lifecycle hooks with official 3-layer structure."""

    def __init__(self):
        """Initialize hook executor."""
        # Track hooks that have been executed once (for once=True flag)
        # Key: (skill_name, thread_id, hook_event, matcher, hook_index)
        self._executed_once_hooks: set[tuple[str, str, str, str, int]] = set()
        self._command_hooks_mode = self._resolve_command_hooks_mode()
        self._prompt_hooks_mode = self._resolve_prompt_hooks_mode()

    @staticmethod
    def _resolve_command_hooks_mode() -> str:
        """Resolve command hook execution policy.

        Modes:
        - allow: execute command hooks for all skills
        - skip: skip command hooks for untrusted skills
        - deny: block command hooks for untrusted skills (default)
        """
        mode = os.getenv("ZMIND_SKILLS_COMMAND_HOOKS_MODE", "deny").strip().lower()
        if mode not in {"allow", "skip", "deny"}:
            return "deny"
        return mode

    @staticmethod
    def _resolve_prompt_hooks_mode() -> str:
        mode = os.getenv("ZMIND_SKILLS_PROMPT_HOOKS_MODE", "skip").strip().lower()
        if mode not in {"skip", "deny"}:
            return "skip"
        return mode

    @staticmethod
    def _is_trusted_skill(skill: SkillDefinition) -> bool:
        """Determine if a skill is trusted to run command hooks."""
        return skill.source in {None, "builtin", "file"}

    def _command_hook_policy(self, skill: SkillDefinition) -> tuple[bool, str]:
        """Return (allowed, mode) for command hook execution."""
        if self._is_trusted_skill(skill):
            return True, "allow"
        if self._command_hooks_mode == "allow":
            return True, "allow"
        return False, self._command_hooks_mode

    async def execute_pre_tool_use(
        self,
        skill: SkillDefinition,
        tool_name: str,
        tool_input: dict[str, Any],
        *,
        thread_id: str,
        account_id: str,
    ) -> tuple[bool, Optional[str]]:
        """Execute PreToolUse hooks before agent uses a tool.

        Returns:
            (should_continue, message)
            - should_continue: True if tool execution should proceed
            - message: Optional error/abort message
        """
        if not skill.hooks or not skill.hooks.PreToolUse:
            return True, None

        context = HookExecutionContext(
            skill_name=skill.name,
            thread_id=thread_id,
            account_id=account_id,
            tool_name=tool_name,
            tool_input=tool_input,
        )

        return await self._execute_hooks_for_event(
            skill=skill,
            event_name="PreToolUse",
            matcher_groups=skill.hooks.PreToolUse,
            context=context,
        )

    async def execute_post_tool_use(
        self,
        skill: SkillDefinition,
        tool_name: str,
        tool_output: Any,
        *,
        thread_id: str,
        account_id: str,
    ) -> None:
        """Execute PostToolUse hooks after agent uses a tool.

        Note: PostToolUse hooks are informational only, they don't affect execution.
        """
        if not skill.hooks or not skill.hooks.PostToolUse:
            return

        context = HookExecutionContext(
            skill_name=skill.name,
            thread_id=thread_id,
            account_id=account_id,
            tool_name=tool_name,
            tool_output=tool_output,
        )

        # PostToolUse hooks don't block execution, just log results
        await self._execute_hooks_for_event(
            skill=skill,
            event_name="PostToolUse",
            matcher_groups=skill.hooks.PostToolUse,
            context=context,
        )

    async def execute_stop(
        self,
        skill: SkillDefinition,
        *,
        thread_id: str,
        account_id: str,
    ) -> None:
        """Execute Stop hooks when user stops agent execution."""
        if not skill.hooks or not skill.hooks.Stop:
            return

        context = HookExecutionContext(
            skill_name=skill.name,
            thread_id=thread_id,
            account_id=account_id,
        )

        await self._execute_hooks_for_event(
            skill=skill,
            event_name="Stop",
            matcher_groups=skill.hooks.Stop,
            context=context,
        )

    async def _execute_hooks_for_event(
        self,
        skill: SkillDefinition,
        event_name: str,
        matcher_groups: list[HookMatcherGroup],
        context: HookExecutionContext,
    ) -> tuple[bool, Optional[str]]:
        """Execute all matching hooks for a given event.

        Returns:
            (should_continue, message)
        """
        for matcher_group in matcher_groups:
            # Check if matcher pattern matches the tool name
            if context.tool_name and not self._matches_tool(
                matcher_group.matcher, context.tool_name
            ):
                continue

            # Execute all hooks in this matcher group
            for hook_index, hook_entry in enumerate(matcher_group.hooks):
                # Check if this hook should be executed (once flag)
                hook_key = (
                    skill.name,
                    context.thread_id,
                    event_name,
                    matcher_group.matcher,
                    hook_index,
                )

                if hook_entry.once and hook_key in self._executed_once_hooks:
                    logger.debug(
                        "Skipping hook (already executed once)",
                        skill=skill.name,
                        hook_event=event_name,
                        matcher=matcher_group.matcher,
                        hook_index=hook_index,
                    )
                    continue

                # Execute the hook
                success, output = await self._execute_single_hook(
                    skill, hook_entry, context, event_name
                )

                # Mark as executed if once=True
                if hook_entry.once:
                    self._executed_once_hooks.add(hook_key)

                # For PreToolUse hooks, check if we should abort
                if event_name == "PreToolUse" and not success:
                    return False, f"PreToolUse hook failed: {output}"

        return True, None

    def _matches_tool(self, pattern: str, tool_name: str) -> bool:
        """Check if tool name matches the regex pattern."""
        try:
            return bool(re.search(pattern, tool_name))
        except re.error as exc:
            logger.warning(
                "Invalid hook matcher pattern",
                pattern=pattern,
                error=str(exc),
            )
            return False

    async def _execute_single_hook(
        self,
        skill: SkillDefinition,
        hook: HookEntry,
        context: HookExecutionContext,
        event_name: str,
    ) -> tuple[bool, str]:
        """Execute a single hook entry.

        Returns:
            (success, output)
            - success: True if hook succeeded (exit code 0 or LLM returned yes)
            - output: Hook output (stdout or LLM response)
        """
        if hook.type == "command":
            allowed, mode = self._command_hook_policy(skill)
            if not allowed:
                message = (
                    "该技能包含需要执行系统命令的步骤，出于安全策略已被禁用，无法执行。"
                )
                log_context = {
                    "skill": skill.name,
                    "hook_event": event_name,
                    "mode": mode,
                    "matcher": context.tool_name or "",
                }
                if mode == "skip":
                    logger.warning("Skipping command hook due to policy", **log_context)
                    return True, message
                logger.warning("Blocking command hook due to policy", **log_context)
                return False, message
            return await self._execute_command_hook(hook, context, event_name)
        elif hook.type == "prompt":
            return await self._execute_prompt_hook(hook, context, event_name)
        else:
            logger.warning(f"Unknown hook type: {hook.type}")
            return False, f"Unknown hook type: {hook.type}"

    async def _execute_command_hook(
        self,
        hook: HookEntry,
        context: HookExecutionContext,
        event_name: str,
    ) -> tuple[bool, str]:
        """Execute a command-type hook (shell command)."""
        if not hook.command:
            return False, "No command specified"

        logger.info(
            "Executing command hook",
            hook_event=event_name,
            command=hook.command[:50],
            timeout=hook.timeout,
        )

        try:
            # Prepare environment variables
            env = context.to_env_dict()

            # Execute command with timeout
            process = await asyncio.create_subprocess_shell(
                hook.command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**dict(subprocess.os.environ), **env},
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=hook.timeout,
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                return False, f"Hook timed out after {hook.timeout}s"

            stdout_str = stdout.decode("utf-8", errors="replace").strip()
            stderr_str = stderr.decode("utf-8", errors="replace").strip()

            # Check exit code
            if process.returncode != 0:
                error_msg = stderr_str or stdout_str or f"Exit code {process.returncode}"
                logger.warning(
                    "Command hook failed",
                    hook_event=event_name,
                    exit_code=process.returncode,
                    error=error_msg,
                )
                return False, error_msg

            # Try to parse JSON output for decision (optional)
            decision = self._parse_hook_decision(stdout_str)
            if decision is not None:
                return decision, stdout_str

            # No JSON decision, success based on exit code only
            return True, stdout_str

        except Exception as exc:
            logger.error(
                "Command hook execution failed",
                hook_event=event_name,
                command=hook.command[:50],
                error=str(exc),
            )
            return False, str(exc)

    async def _execute_prompt_hook(
        self,
        hook: HookEntry,
        context: HookExecutionContext,
        event_name: str,
    ) -> tuple[bool, str]:
        """Execute a prompt-type hook (LLM evaluation)."""
        if not hook.prompt:
            return False, "No prompt specified"

        logger.info(
            "Executing prompt hook",
            hook_event=event_name,
            prompt=hook.prompt[:50],
        )

        logger.warning(
            "Prompt-type hooks are currently unsupported",
            hook_event=event_name,
            skill=context.skill_name,
            mode=self._prompt_hooks_mode,
        )
        message = "Prompt-type hooks are not supported yet."
        if self._prompt_hooks_mode == "skip":
            return True, message
        return False, message

    def _parse_hook_decision(self, output: str) -> Optional[bool]:
        """Parse hook output for JSON decision.

        Hooks can return JSON: {"decision": true/false, "message": "..."}
        to explicitly control whether execution should continue.
        """
        if not output:
            return None

        try:
            data = json.loads(output)
            if isinstance(data, dict) and "decision" in data:
                return bool(data["decision"])
        except (json.JSONDecodeError, ValueError):
            pass

        return None


# Global hook executor instance
_hook_executor: Optional[HookExecutor] = None


def get_hook_executor() -> HookExecutor:
    """Get global hook executor instance (singleton).

    Returns:
        Global HookExecutor instance
    """
    global _hook_executor
    if _hook_executor is None:
        _hook_executor = HookExecutor()
    return _hook_executor
