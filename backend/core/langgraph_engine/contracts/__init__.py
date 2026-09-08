"""
Frozen contracts (v1) for the LangGraph engine upgrade.

These modules intentionally contain *only* types, constants, and fixtures.
Business logic must not live here.
"""

from .checkpoint_contract import CHECKPOINT_TABLE_NAME, CheckpointRecord, CheckpointStore
from .engine_interface import BaseEngine, RunConfig
from .event_schema import (
    AssistantChunkEvent,
    AssistantFinalEvent,
    EngineEvent,
    EngineEventType,
    ErrorEvent,
    LLMResponseEndEvent,
    StatusEvent,
    ToolMessageEvent,
)
from . import fixtures as fixtures
from .legacy_stream_contract import (
    LEGACY_REDIS_CONTROL_CHANNEL_TEMPLATE,
    LEGACY_REDIS_RESPONSE_CHANNEL_TEMPLATE,
    LEGACY_REDIS_RESPONSE_LIST_KEY_TEMPLATE,
    LegacyChannel,
    LegacyChunkContentObj,
    LegacyChunkMetadataObj,
    LegacyMessageChunk,
    LegacyMessageType,
    LegacyPingChunk,
    LegacySSEPayload,
    LegacyStreamChunk,
    LegacyStreamStatus,
    LegacyTerminalRunStatus,
    LegacyTerminalStatusChunk,
)
from .state_schema import EngineName, GraphState, SideEffectPolicy, TerminationState
from .tool_interface import (
    DISABLED_IN_SHADOW_ERROR,
    TERMINATING_TOOL_NAMES,
    SideEffectLevel,
    ToolCall,
    ToolExecutionResult,
    ToolRegistry,
    ToolSchemaSanitizer,
    ToolSpec,
)

__all__ = [
    # State
    "EngineName",
    "GraphState",
    "SideEffectPolicy",
    "TerminationState",
    # Engine interface
    "BaseEngine",
    "RunConfig",
    # Events
    "EngineEventType",
    "EngineEvent",
    "AssistantChunkEvent",
    "AssistantFinalEvent",
    "ToolMessageEvent",
    "StatusEvent",
    "LLMResponseEndEvent",
    "ErrorEvent",
    # Tools
    "SideEffectLevel",
    "ToolCall",
    "ToolExecutionResult",
    "ToolSpec",
    "ToolRegistry",
    "ToolSchemaSanitizer",
    "TERMINATING_TOOL_NAMES",
    "DISABLED_IN_SHADOW_ERROR",
    # Checkpoint
    "CHECKPOINT_TABLE_NAME",
    "CheckpointRecord",
    "CheckpointStore",
    # Legacy stream
    "LEGACY_REDIS_RESPONSE_LIST_KEY_TEMPLATE",
    "LEGACY_REDIS_RESPONSE_CHANNEL_TEMPLATE",
    "LEGACY_REDIS_CONTROL_CHANNEL_TEMPLATE",
    "LegacyMessageType",
    "LegacyStreamStatus",
    "LegacyChannel",
    "LegacyChunkMetadataObj",
    "LegacyChunkContentObj",
    "LegacyMessageChunk",
    "LegacyTerminalRunStatus",
    "LegacyTerminalStatusChunk",
    "LegacyPingChunk",
    "LegacyStreamChunk",
    "LegacySSEPayload",
    # Fixtures
    "fixtures",
]
