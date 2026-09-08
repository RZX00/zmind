from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Awaitable, Callable, Mapping, Protocol, Sequence, TypedDict, NotRequired

from pydantic import BaseModel

ToolArguments = dict[str, Any]


class SideEffectLevel(str, Enum):
    """
    Tool side-effect classification used for Shadow Mode gating.

    - READ_ONLY: safe to run in shadow
    - REVERSIBLE_WRITE: default disabled in shadow unless explicitly allowed
    - EXTERNAL_WRITE: always disabled in shadow
    """

    READ_ONLY = "READ_ONLY"
    REVERSIBLE_WRITE = "REVERSIBLE_WRITE"
    EXTERNAL_WRITE = "EXTERNAL_WRITE"


class ToolCall(TypedDict):
    """
    Canonical tool call produced by the model (pure function calling).

    Notes:
    - `id` should be stable for dedupe and tool result association.
    - `raw` can store provider-native payload for debugging (optional).
    """

    id: str
    name: str
    arguments: ToolArguments
    raw: NotRequired[Any]


class ToolExecutionResult(TypedDict):
    """
    Canonical tool execution result.

    `output` is the raw tool output (can be structured), while adapters/persistence
    may also derive a string representation for message content.
    """

    tool_call_id: str
    name: str
    success: bool
    started_at: str
    ended_at: str
    output: NotRequired[Any]
    error: NotRequired[str]
    metadata: NotRequired[dict[str, Any]]


ToolHandler = Callable[[ToolArguments, Mapping[str, Any]], Awaitable[ToolExecutionResult]]


@dataclass(frozen=True, slots=True)
class ToolSpec:
    """
    Standardized tool descriptor (WS-B will provide concrete registry + sanitizer).

    `args_model` must be a Pydantic v2 model used to generate strict JSON schema
    for function calling.
    """

    name: str
    description: str
    args_model: type[BaseModel]
    handler: ToolHandler
    side_effect_level: SideEffectLevel = SideEffectLevel.READ_ONLY
    timeout_s: float | None = None
    aliases: tuple[str, ...] = ()
    version: str = "v1"


class ToolSchemaSanitizer(Protocol):
    """Sanitize tool JSON schema to a provider-accepted subset."""

    def sanitize_openai_tool_schema(self, tool: ToolSpec) -> dict[str, Any]: ...


class ToolRegistry(Protocol):
    """Registry interface used by the engine to expose tools to the model."""

    def get(self, name: str) -> ToolSpec | None: ...

    def list_tools(self) -> Sequence[ToolSpec]: ...

    def openai_tools_schema(self) -> list[dict[str, Any]]: ...


# Shadow-mode fixed error string for disabled side-effect tools (Master Design Doc 4.4).
DISABLED_IN_SHADOW_ERROR: str = "disabled_in_shadow"

# v1 terminating tool names (Chief Architect decision; later replaced by WS-B catalog).
TERMINATING_TOOL_NAMES: frozenset[str] = frozenset(
    {"ask", "complete", "web_browser_takeover"}
)

