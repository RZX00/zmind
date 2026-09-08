"""
Pure Claude Code Skills type definitions (Official Standard).

This module implements the official Claude Code Skills specification from:
https://docs.claude.com/claude-code/skills

Zero custom extensions - 100% official standard compliance.
"""

from __future__ import annotations

import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class HookEntry(BaseModel):
    """Single hook entry in the official hooks structure (Level 3).

    Official format supports two hook types:
    - command: Execute a shell command
    - prompt: Evaluate a prompt with LLM
    """

    type: Literal["command", "prompt"] = Field(..., description="Hook type: command or prompt")
    command: Optional[str] = Field(default=None, description="Shell command to execute (for command type)")
    prompt: Optional[str] = Field(default=None, description="Prompt to evaluate (for prompt type)")
    timeout: int = Field(default=5, description="Timeout in seconds", ge=1, le=300)
    once: bool = Field(default=False, description="Execute only once per conversation")

    class Config:
        extra = "forbid"

    @field_validator("command", "prompt")
    @classmethod
    def validate_command_or_prompt(cls, v, info):
        """Ensure command type has command, prompt type has prompt."""
        hook_type = info.data.get("type")
        field_name = info.field_name

        if hook_type == "command" and field_name == "command" and not v:
            raise ValueError("command type hook must have 'command' field")
        if hook_type == "prompt" and field_name == "prompt" and not v:
            raise ValueError("prompt type hook must have 'prompt' field")

        return v


class HookMatcherGroup(BaseModel):
    """Hook matcher group in the official hooks structure (Level 2).

    Contains a matcher pattern (regex) and list of hooks to execute
    when the pattern matches the tool name.
    """

    matcher: str = Field(..., description="Regex pattern to match tool names")
    hooks: list[HookEntry] = Field(..., description="List of hooks to execute for matching tools")

    class Config:
        extra = "forbid"


class SkillHooks(BaseModel):
    """Lifecycle hooks for skill execution (Official 3-Layer Standard).

    Official structure:
    hooks:
      PreToolUse:
        - matcher: "Bash"
          hooks:
            - type: command
              command: "./check.sh"
              timeout: 60
            - type: prompt
              prompt: "Should we proceed?"
      PostToolUse:
        - matcher: ".*"
          hooks:
            - type: command
              command: "echo done"
    """

    PreToolUse: Optional[list[HookMatcherGroup]] = Field(
        default=None,
        description="Hooks executed before agent uses a tool"
    )
    PostToolUse: Optional[list[HookMatcherGroup]] = Field(
        default=None,
        description="Hooks executed after agent uses a tool"
    )
    Stop: Optional[list[HookMatcherGroup]] = Field(
        default=None,
        description="Hooks executed when user stops agent"
    )

    class Config:
        extra = "forbid"


class SkillDefinition(BaseModel):
    """Pure Claude Code Skills definition (official standard only)."""

    # Required fields
    name: str = Field(..., min_length=1, max_length=64, description="Unique skill identifier")
    description: str = Field(..., min_length=1, max_length=1024, description="Brief skill description")
    prompt: str = Field(..., description="The skill's system prompt")

    # Optional official fields
    allowed_tools: list[str] = Field(default_factory=list, alias="allowed-tools")
    model: Optional[str] = Field(default=None)
    context: Optional[Literal["fork"]] = Field(default=None)
    agent: Optional[str] = Field(default=None)
    hooks: Optional[SkillHooks] = Field(default=None)
    user_invocable: bool = Field(default=True, alias="user-invocable")
    disable_model_invocation: bool = Field(default=False, alias="disable-model-invocation")
    argument_hint: Optional[str] = Field(default=None, alias="argument-hint")
    license: Optional[str] = Field(default=None)
    metadata: Optional[dict[str, Any]] = Field(default=None)

    # Runtime metadata
    source: Optional[Literal["builtin", "file", "user"]] = Field(default=None)
    location: Optional[str] = Field(default=None)

    class Config:
        extra = "forbid"
        populate_by_name = True

    @field_validator("name")
    @classmethod
    def validate_name_format(cls, v: str) -> str:
        """Validate name follows official format: lowercase, numbers, hyphens only."""
        if not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", v):
            raise ValueError(f"Invalid skill name '{v}'. Must contain only lowercase letters, numbers, and hyphens")
        return v

    def get_id(self) -> str:
        """Get skill unique identifier (name IS the identifier in official standard)."""
        return self.name

    def to_public_dict(self) -> dict[str, Any]:
        """Convert to public dictionary format."""
        result = {
            "name": self.name,
            "description": self.description,
            "prompt": self.prompt,
            "allowed-tools": self.allowed_tools,
            "user-invocable": self.user_invocable,
            "disable-model-invocation": self.disable_model_invocation,
        }
        if self.model is not None:
            result["model"] = self.model
        if self.context is not None:
            result["context"] = self.context
        if self.agent is not None:
            result["agent"] = self.agent
        if self.hooks is not None:
            result["hooks"] = self.hooks.model_dump(by_alias=False, exclude_none=True)
        if self.argument_hint is not None:
            result["argument-hint"] = self.argument_hint
        if self.license is not None:
            result["license"] = self.license
        if self.metadata is not None:
            result["metadata"] = self.metadata
        if self.source is not None:
            result["source"] = self.source
        if self.location is not None:
            result["location"] = self.location
        return result
