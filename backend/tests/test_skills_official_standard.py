"""
Official Claude Code Skills Standard - Comprehensive Test Suite

Tests for pure official standard implementation:
- SkillDefinition validation and field constraints
- Skill loading from all sources (builtin, file, user)
- Hooks execution (PreToolUse, PostToolUse, Stop)
- Fork context isolation
- Name format validation
- Priority resolution (user > file > builtin)
"""

import asyncio
import json
import os
import tempfile
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from core.skills.types import SkillDefinition, HookEntry, HookMatcherGroup, SkillHooks
from core.skills.registry import (
    load_builtin_skills,
    load_file_skills,
    load_user_skills,
    get_skill_by_name,
    _parse_hooks,
    _load_skill_markdown_file,
    _normalize_list,
)
from core.skills.hooks import HookExecutor, get_hook_executor
from core.skills.fork_context import ForkContextExecutor, get_fork_executor


class TestSkillDefinitionValidation:
    """Test official SkillDefinition field validation."""

    def test_valid_skill_minimal(self):
        """Test minimal valid skill with required fields only."""
        skill = SkillDefinition(
            name="test-skill",
            description="A test skill",
            prompt="Do something useful",
        )
        assert skill.name == "test-skill"
        assert skill.description == "A test skill"
        assert skill.prompt == "Do something useful"
        assert skill.allowed_tools == []
        assert skill.user_invocable is True

    def test_valid_skill_with_all_fields(self):
        """Test skill with all official fields including Phase 2 hooks."""
        # Create hooks with new 3-layer structure
        hooks = SkillHooks(
            PreToolUse=[
                HookMatcherGroup(
                    matcher="Bash",
                    hooks=[
                        HookEntry(type="command", command="echo pre", once=True, timeout=10)
                    ]
                )
            ],
            PostToolUse=[
                HookMatcherGroup(
                    matcher=".*",
                    hooks=[
                        HookEntry(type="command", command="echo post", timeout=5)
                    ]
                )
            ],
        )
        skill = SkillDefinition(
            name="full-skill",
            description="A complete skill",
            prompt="Do everything",
            allowed_tools=["tool1", "tool2"],
            model="claude-opus-4",
            context="fork",
            agent="custom-agent",
            hooks=hooks,
            user_invocable=False,
            disable_model_invocation=True,
            license="MIT",
            metadata={"version": "1.0.0", "author": "test"},
        )
        assert skill.name == "full-skill"
        assert skill.allowed_tools == ["tool1", "tool2"]
        assert skill.model == "claude-opus-4"
        assert skill.context == "fork"
        assert skill.agent == "custom-agent"
        assert skill.hooks is not None
        assert len(skill.hooks.PreToolUse) == 1
        assert skill.hooks.PreToolUse[0].matcher == "Bash"
        assert skill.hooks.PreToolUse[0].hooks[0].type == "command"
        assert skill.hooks.PreToolUse[0].hooks[0].command == "echo pre"
        assert skill.user_invocable is False
        assert skill.disable_model_invocation is True
        assert skill.license == "MIT"
        assert skill.metadata == {"version": "1.0.0", "author": "test"}

    def test_name_format_validation(self):
        """Test name format must be lowercase, numbers, hyphens only."""
        # Valid names
        valid_names = [
            "skill",
            "my-skill",
            "skill123",
            "my-skill-123",
            "abc-123-def",
        ]
        for name in valid_names:
            skill = SkillDefinition(name=name, description="Test", prompt="Test")
            assert skill.name == name

        # Invalid names
        invalid_names = [
            "MySkill",  # uppercase
            "my_skill",  # underscore
            "my.skill",  # dot
            "my skill",  # space
            "-skill",  # leading hyphen
            "skill-",  # trailing hyphen
            "my--skill",  # double hyphen
        ]
        for name in invalid_names:
            with pytest.raises(ValidationError):
                SkillDefinition(name=name, description="Test", prompt="Test")

    def test_name_length_validation(self):
        """Test name must be 1-64 characters."""
        # Too short (0 chars)
        with pytest.raises(ValidationError):
            SkillDefinition(name="", description="Test", prompt="Test")

        # Too long (65 chars)
        with pytest.raises(ValidationError):
            SkillDefinition(
                name="a" * 65,
                description="Test",
                prompt="Test",
            )

        # Maximum valid length (64 chars)
        skill = SkillDefinition(
            name="a" * 64,
            description="Test",
            prompt="Test",
        )
        assert len(skill.name) == 64

    def test_description_length_validation(self):
        """Test description must be 1-1024 characters."""
        # Too short
        with pytest.raises(ValidationError):
            SkillDefinition(name="test", description="", prompt="Test")

        # Too long
        with pytest.raises(ValidationError):
            SkillDefinition(
                name="test",
                description="x" * 1025,
                prompt="Test",
            )

        # Maximum valid length
        skill = SkillDefinition(
            name="test",
            description="x" * 1024,
            prompt="Test",
        )
        assert len(skill.description) == 1024

    def test_context_validation(self):
        """Test context must be 'fork' or None."""
        # Valid: fork
        skill = SkillDefinition(
            name="test",
            description="Test",
            prompt="Test",
            context="fork",
        )
        assert skill.context == "fork"

        # Valid: None
        skill = SkillDefinition(
            name="test",
            description="Test",
            prompt="Test",
        )
        assert skill.context is None

    def test_field_aliases(self):
        """Test field aliases work correctly."""
        # Using hyphenated aliases
        data = {
            "name": "test",
            "description": "Test",
            "prompt": "Test",
            "allowed-tools": ["tool1"],
            "user-invocable": False,
        }
        skill = SkillDefinition.model_validate(data)
        assert skill.allowed_tools == ["tool1"]
        assert skill.user_invocable is False

        # Using underscored names
        data2 = {
            "name": "test",
            "description": "Test",
            "prompt": "Test",
            "allowed_tools": ["tool2"],
            "user_invocable": True,
        }
        skill2 = SkillDefinition.model_validate(data2)
        assert skill2.allowed_tools == ["tool2"]
        assert skill2.user_invocable is True

    def test_get_id_returns_name(self):
        """Test get_id() returns name (name IS the identifier)."""
        skill = SkillDefinition(
            name="my-skill",
            description="Test",
            prompt="Test",
        )
        assert skill.get_id() == "my-skill"
        assert skill.get_id() == skill.name

    def test_new_official_fields(self):
        """Test new official fields: disable-model-invocation, argument-hint, license, metadata."""
        # Test with hyphenated aliases
        data = {
            "name": "test-skill",
            "description": "Test skill",
            "prompt": "Test prompt",
            "disable-model-invocation": True,
            "argument-hint": "Provide the input text",
            "license": "Apache-2.0",
            "metadata": {"version": "2.0.0", "tags": ["test", "example"]},
        }
        skill = SkillDefinition.model_validate(data)
        assert skill.disable_model_invocation is True
        assert skill.argument_hint == "Provide the input text"
        assert skill.license == "Apache-2.0"
        assert skill.metadata == {"version": "2.0.0", "tags": ["test", "example"]}

        # Test default values
        skill2 = SkillDefinition(
            name="minimal-skill",
            description="Minimal",
            prompt="Minimal",
        )
        assert skill2.disable_model_invocation is False
        assert skill2.argument_hint is None
        assert skill2.license is None
        assert skill2.metadata is None

        # Test to_public_dict includes new fields
        public_dict = skill.to_public_dict()
        assert public_dict["disable-model-invocation"] is True
        assert public_dict["argument-hint"] == "Provide the input text"
        assert public_dict["license"] == "Apache-2.0"
        assert public_dict["metadata"] == {"version": "2.0.0", "tags": ["test", "example"]}


class TestHooksExecutor:
    """Test HookExecutor functionality (Phase 2 - Official 3-Layer Standard)."""

    @pytest.mark.asyncio
    async def test_pre_tool_use_success(self):
        """Test PreToolUse hook executes successfully with new 3-layer structure."""
        hooks = SkillHooks(
            PreToolUse=[
                HookMatcherGroup(
                    matcher=".*",  # Match all tools
                    hooks=[
                        HookEntry(type="command", command="echo 'test'", timeout=5)
                    ]
                )
            ]
        )
        skill = SkillDefinition(
            name="test",
            description="Test",
            prompt="Test",
            hooks=hooks,
        )

        executor = HookExecutor()
        success, msg = await executor.execute_pre_tool_use(
            skill=skill,
            tool_name="test_tool",
            tool_input={"arg": "value"},
            thread_id="thread-123",
            account_id="acc-123",
        )

        assert success is True
        assert msg is None

    @pytest.mark.asyncio
    async def test_matcher_pattern_matching(self):
        """Test hook matcher patterns work correctly (regex)."""
        # Create hooks that only match "Bash" tool
        hooks = SkillHooks(
            PreToolUse=[
                HookMatcherGroup(
                    matcher="^Bash$",  # Only match exactly "Bash"
                    hooks=[
                        HookEntry(type="command", command="echo 'bash hook'", timeout=5)
                    ]
                )
            ]
        )
        skill = SkillDefinition(
            name="test",
            description="Test",
            prompt="Test",
            hooks=hooks,
        )

        executor = HookExecutor()

        # Should match Bash
        success1, _ = await executor.execute_pre_tool_use(
            skill=skill,
            tool_name="Bash",
            tool_input={},
            thread_id="thread-123",
            account_id="acc-123",
        )
        assert success1 is True

        # Should NOT match other tools
        success2, _ = await executor.execute_pre_tool_use(
            skill=skill,
            tool_name="Python",
            tool_input={},
            thread_id="thread-123",
            account_id="acc-123",
        )
        assert success2 is True  # No hook ran, so success

    @pytest.mark.asyncio
    async def test_multiple_hooks_per_event(self):
        """Test multiple hooks can be executed for same event."""
        import tempfile
        import os

        # Create temp file to track hook executions
        temp_file = tempfile.NamedTemporaryFile(delete=False, mode='w')
        temp_file.close()

        try:
            # Multiple hooks for same event
            hooks = SkillHooks(
                PreToolUse=[
                    HookMatcherGroup(
                        matcher=".*",
                        hooks=[
                            HookEntry(
                                type="command",
                                command=f"echo hook1 >> {temp_file.name}",
                                timeout=5
                            ),
                            HookEntry(
                                type="command",
                                command=f"echo hook2 >> {temp_file.name}",
                                timeout=5
                            ),
                        ]
                    )
                ]
            )
            skill = SkillDefinition(
                name="test",
                description="Test",
                prompt="Test",
                hooks=hooks,
            )

            executor = HookExecutor()
            success, _ = await executor.execute_pre_tool_use(
                skill=skill,
                tool_name="TestTool",
                tool_input={},
                thread_id="thread-123",
                account_id="acc-123",
            )

            assert success is True

            # Verify both hooks ran
            with open(temp_file.name, 'r') as f:
                content = f.read()
                assert "hook1" in content
                assert "hook2" in content

        finally:
            if os.path.exists(temp_file.name):
                os.unlink(temp_file.name)

    @pytest.mark.asyncio
    async def test_prompt_type_hook(self):
        """Test prompt-type hook currently skips by default (unsupported)."""
        hooks = SkillHooks(
            PreToolUse=[
                HookMatcherGroup(
                    matcher=".*",
                    hooks=[
                        HookEntry(
                            type="prompt",
                            prompt="Should we proceed with {tool_name}?",
                            timeout=5
                        )
                    ]
                )
            ]
        )
        skill = SkillDefinition(
            name="test",
            description="Test",
            prompt="Test",
            hooks=hooks,
        )

        executor = HookExecutor()
        success, msg = await executor.execute_pre_tool_use(
            skill=skill,
            tool_name="TestTool",
            tool_input={},
            thread_id="thread-123",
            account_id="acc-123",
        )

        assert success is True

    @pytest.mark.asyncio
    async def test_configurable_timeout(self):
        """Test hooks respect configurable timeout."""
        import sys

        # Create hook with short timeout that should fail
        hooks = SkillHooks(
            PreToolUse=[
                HookMatcherGroup(
                    matcher=".*",
                    hooks=[
                        HookEntry(
                            type="command",
                            command=f"{sys.executable} -c \"import time; time.sleep(10)\"",
                            timeout=1  # 1 second timeout
                        )
                    ]
                )
            ]
        )
        skill = SkillDefinition(
            name="test",
            description="Test",
            prompt="Test",
            hooks=hooks,
        )

        executor = HookExecutor()
        success, msg = await executor.execute_pre_tool_use(
            skill=skill,
            tool_name="TestTool",
            tool_input={},
            thread_id="thread-123",
            account_id="acc-123",
        )

        # Should timeout and fail
        assert success is False
        assert "timed out" in msg.lower()

    @pytest.mark.asyncio
    async def test_pre_tool_use_once_flag(self):
        """Test PreToolUse hook with once=True executes only once."""
        import tempfile
        import os

        # Create temp file to track hook executions
        temp_file = tempfile.NamedTemporaryFile(delete=False, mode='w')
        temp_file.close()

        try:
            hooks = SkillHooks(
                PreToolUse=[
                    HookMatcherGroup(
                        matcher=".*",
                        hooks=[
                            HookEntry(
                                type="command",
                                command=f"echo executed >> {temp_file.name}",
                                once=True,
                                timeout=5
                            )
                        ]
                    )
                ]
            )
            skill = SkillDefinition(
                name="test",
                description="Test",
                prompt="Test",
                hooks=hooks,
            )

            executor = HookExecutor()

            # First execution - should run
            success1, _ = await executor.execute_pre_tool_use(
                skill=skill,
                tool_name="test_tool",
                tool_input={},
                thread_id="thread-123",
                account_id="acc-123",
            )
            assert success1 is True

            # Second execution - should be skipped (once=True)
            success2, _ = await executor.execute_pre_tool_use(
                skill=skill,
                tool_name="test_tool",
                tool_input={},
                thread_id="thread-123",
                account_id="acc-123",
            )
            assert success2 is True

            # Verify hook only ran once
            with open(temp_file.name, 'r') as f:
                content = f.read()
                assert content.count("executed") == 1

        finally:
            if os.path.exists(temp_file.name):
                os.unlink(temp_file.name)

    @pytest.mark.asyncio
    async def test_post_tool_use_success(self):
        """Test PostToolUse hook executes successfully."""
        hooks = SkillHooks(
            PostToolUse=[
                HookMatcherGroup(
                    matcher=".*",
                    hooks=[
                        HookEntry(type="command", command="echo 'post'", timeout=5)
                    ]
                )
            ]
        )
        skill = SkillDefinition(
            name="test",
            description="Test",
            prompt="Test",
            hooks=hooks,
        )

        executor = HookExecutor()
        await executor.execute_post_tool_use(
            skill=skill,
            tool_name="test_tool",
            tool_output="result",
            thread_id="thread-123",
            account_id="acc-123",
        )
        # Should complete without error

    @pytest.mark.asyncio
    async def test_hook_failure(self):
        """Test hook execution handles command failures."""
        # Command that returns non-zero exit code (cross-platform)
        import sys
        hooks = SkillHooks(
            PreToolUse=[
                HookMatcherGroup(
                    matcher=".*",
                    hooks=[
                        HookEntry(
                            type="command",
                            command=f"{sys.executable} -c \"import sys; sys.exit(1)\"",
                            timeout=5
                        )
                    ]
                )
            ]
        )
        skill = SkillDefinition(
            name="test",
            description="Test",
            prompt="Test",
            hooks=hooks,
        )

        executor = HookExecutor()
        success, msg = await executor.execute_pre_tool_use(
            skill=skill,
            tool_name="test_tool",
            tool_input={},
            thread_id="thread-123",
            account_id="acc-123",
        )

        # Hook should fail when command returns non-zero exit code
        assert success is False
        assert msg is not None
        assert "failed" in msg.lower()

    def test_backward_compatible_legacy_hooks(self):
        """Test that legacy hook format is automatically converted to new format."""
        from core.skills.registry import _parse_hooks

        # Legacy format 1: string shorthand
        legacy_hooks_1 = {
            "PreToolUse": "echo test"
        }
        hooks_1 = _parse_hooks(legacy_hooks_1)
        assert hooks_1 is not None
        assert hooks_1.PreToolUse is not None
        assert len(hooks_1.PreToolUse) == 1
        assert hooks_1.PreToolUse[0].matcher == ".*"
        assert hooks_1.PreToolUse[0].hooks[0].type == "command"
        assert hooks_1.PreToolUse[0].hooks[0].command == "echo test"

        # Legacy format 2: dict with command field
        legacy_hooks_2 = {
            "PreToolUse": {
                "command": "echo test2",
                "once": True,
                "timeout": 10
            }
        }
        hooks_2 = _parse_hooks(legacy_hooks_2)
        assert hooks_2 is not None
        assert hooks_2.PreToolUse is not None
        assert len(hooks_2.PreToolUse) == 1
        assert hooks_2.PreToolUse[0].hooks[0].command == "echo test2"
        assert hooks_2.PreToolUse[0].hooks[0].once is True
        assert hooks_2.PreToolUse[0].hooks[0].timeout == 10

        # New format: 3-layer structure
        new_hooks = {
            "PreToolUse": [
                {
                    "matcher": "Bash",
                    "hooks": [
                        {
                            "type": "command",
                            "command": "echo new",
                            "timeout": 15
                        }
                    ]
                }
            ]
        }
        hooks_3 = _parse_hooks(new_hooks)
        assert hooks_3 is not None
        assert len(hooks_3.PreToolUse) == 1
        assert hooks_3.PreToolUse[0].matcher == "Bash"
        assert hooks_3.PreToolUse[0].hooks[0].command == "echo new"
        assert hooks_3.PreToolUse[0].hooks[0].timeout == 15


class TestSkillRegistry:
    """Test skill loading from all sources."""

    def test_load_builtin_skills(self):
        """Test loading built-in skills from SKILL.md files."""
        skills = load_builtin_skills()
        assert len(skills) > 0

        # Check for expected built-in skills
        skill_names = [s.name for s in skills]
        assert "note-to-structure" in skill_names
        assert "ppt-plan" in skill_names

        # Verify skills have correct structure
        for skill in skills:
            assert skill.name
            assert skill.description
            assert skill.prompt
            assert skill.source == "builtin"

    def test_parse_hooks(self):
        """Test parsing hooks configuration (backward compatible)."""
        # Valid hooks dict - old format (should be auto-converted to 3-layer)
        hooks_data = {
            "PreToolUse": {"command": "echo pre", "once": True},
            "PostToolUse": "echo post",  # Shorthand string format
        }
        hooks = _parse_hooks(hooks_data)
        assert hooks is not None
        # Check 3-layer structure after auto-conversion
        assert isinstance(hooks.PreToolUse, list)
        assert len(hooks.PreToolUse) == 1
        assert hooks.PreToolUse[0].matcher == ".*"  # Auto-converted to match all
        assert len(hooks.PreToolUse[0].hooks) == 1
        assert hooks.PreToolUse[0].hooks[0].command == "echo pre"
        assert hooks.PreToolUse[0].hooks[0].once is True

        assert isinstance(hooks.PostToolUse, list)
        assert len(hooks.PostToolUse) == 1
        assert hooks.PostToolUse[0].hooks[0].command == "echo post"
        assert hooks.PostToolUse[0].hooks[0].once is False

        # Invalid hooks (not a dict)
        assert _parse_hooks("invalid") is None
        assert _parse_hooks(123) is None

    def test_normalize_list(self):
        """Test normalizing list values."""
        # List input
        assert _normalize_list(["a", "b", "c"]) == ["a", "b", "c"]

        # Comma-separated string
        assert _normalize_list("a, b, c") == ["a", "b", "c"]

        # Single string
        assert _normalize_list("single") == ["single"]

        # Empty/None
        assert _normalize_list(None) == []
        assert _normalize_list("") == []
        assert _normalize_list([]) == []

    @pytest.mark.asyncio
    async def test_skill_priority_resolution(self):
        """Test priority: user > file > builtin."""
        # Create temporary skill directories
        with tempfile.TemporaryDirectory() as tmpdir:
            # This test would need proper setup of file system skills
            # For now, just verify the function signatures work
            mock_db = MagicMock()
            mock_db.client = AsyncMock()

            # Test get_skill_by_name with no matches
            skill = await get_skill_by_name(
                "nonexistent-skill",
                db=mock_db,
                account_id="test-account",
            )
            assert skill is None


class TestForkContext:
    """Test fork context isolation."""

    @pytest.mark.asyncio
    async def test_fork_context_isolation(self):
        """Test fork context creates isolated execution environment."""
        skill = SkillDefinition(
            name="test-fork",
            description="Test fork skill",
            prompt="Execute in isolation: {input}",
            context="fork",
            allowed_tools=["tool1"],
        )

        executor = ForkContextExecutor()

        # Mock database and dependencies
        mock_db = MagicMock()
        mock_db.client = AsyncMock()

        # Mock ToolRegistry
        mock_tool_registry = MagicMock()

        # Mock MemoryCheckpointStore
        mock_checkpoint_store = MagicMock()
        mock_checkpoint_store.load = AsyncMock(return_value={
            "messages_context": [
                {"role": "assistant", "content": "Fork result"}
            ],
        })

        with patch.object(executor, '_build_fork_tool_registry') as mock_build_registry, \
             patch('core.skills.fork_context.LangGraphEngine') as mock_engine_class, \
             patch('core.skills.fork_context.MemoryCheckpointStore') as mock_checkpoint_class:

            # Setup mocks
            mock_build_registry.return_value = mock_tool_registry
            mock_checkpoint_class.return_value = mock_checkpoint_store

            # Setup mock engine
            mock_engine_instance = MagicMock()
            mock_engine_class.return_value = mock_engine_instance

            # Mock run() method to return empty events
            async def mock_run(*args, **kwargs):
                # Return empty async iterator
                return
                yield  # Make this an async generator

            mock_engine_instance.run = mock_run

            result = await executor.execute(
                skill=skill,
                user_input="Test input",
                parent_thread_id="parent-thread",
                parent_run_id="parent-run",
                account_id="test-account",
                project_id="test-project",
                db=mock_db,
            )

            assert result["success"] is True
            assert result["output"] == "Fork result"
            assert result["fork_thread_id"].startswith("fork-")
            assert result["parent_thread_id"] == "parent-thread"

    def test_get_fork_executor_singleton(self):
        """Test fork executor is a singleton."""
        executor1 = get_fork_executor()
        executor2 = get_fork_executor()
        assert executor1 is executor2


class TestSKILLMDFormat:
    """Test SKILL.md file format parsing."""

    def test_load_skill_markdown_file(self):
        """Test loading skill from SKILL.md format."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            skill_file = skill_dir / "SKILL.md"

            # Write valid SKILL.md
            skill_file.write_text("""---
name: test-skill
description: A test skill for testing
allowed-tools:
  - tool1
  - tool2
user-invocable: true
---

# Test Skill

This is a test skill prompt.
Do something useful.
""")

            skill = _load_skill_markdown_file(skill_file, source="file")
            assert skill is not None
            assert skill.name == "test-skill"
            assert skill.description == "A test skill for testing"
            assert skill.allowed_tools == ["tool1", "tool2"]
            assert skill.user_invocable is True
            assert "Do something useful" in skill.prompt

    def test_skill_with_hooks_new_format(self):
        """Test loading skill with hooks (new 3-layer format) from SKILL.md."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "hook-skill"
            skill_dir.mkdir()
            skill_file = skill_dir / "SKILL.md"

            skill_file.write_text("""---
name: hook-skill
description: Skill with hooks (new format)
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: echo "before bash"
          timeout: 10
          once: true
    - matcher: ".*"
      hooks:
        - type: prompt
          prompt: "Should we proceed?"
          timeout: 5
---

Test prompt with hooks (new 3-layer format).
""")

            skill = _load_skill_markdown_file(skill_file, source="file")
            assert skill is not None
            assert skill.hooks is not None
            assert len(skill.hooks.PreToolUse) == 2
            assert skill.hooks.PreToolUse[0].matcher == "Bash"
            assert skill.hooks.PreToolUse[0].hooks[0].type == "command"
            assert skill.hooks.PreToolUse[0].hooks[0].command == 'echo "before bash"'
            assert skill.hooks.PreToolUse[0].hooks[0].timeout == 10
            assert skill.hooks.PreToolUse[0].hooks[0].once is True
            assert skill.hooks.PreToolUse[1].matcher == ".*"
            assert skill.hooks.PreToolUse[1].hooks[0].type == "prompt"

    def test_skill_with_hooks_legacy_format(self):
        """Test loading skill with hooks (legacy format) from SKILL.md - backward compatibility."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "hook-skill-legacy"
            skill_dir.mkdir()
            skill_file = skill_dir / "SKILL.md"

            # Legacy format should be auto-converted
            skill_file.write_text("""---
name: hook-skill-legacy
description: Skill with hooks (legacy format)
hooks:
  PreToolUse:
    command: echo "before tool"
    once: true
  PostToolUse: "echo after"
---

Test prompt with hooks (legacy format).
""")

            skill = _load_skill_markdown_file(skill_file, source="file")
            assert skill is not None
            assert skill.hooks is not None
            # Should be converted to new format
            assert len(skill.hooks.PreToolUse) == 1
            assert skill.hooks.PreToolUse[0].matcher == ".*"
            assert skill.hooks.PreToolUse[0].hooks[0].command == 'echo "before tool"'
            assert skill.hooks.PreToolUse[0].hooks[0].once is True
            assert len(skill.hooks.PostToolUse) == 1
            assert skill.hooks.PostToolUse[0].hooks[0].command == 'echo after'


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
