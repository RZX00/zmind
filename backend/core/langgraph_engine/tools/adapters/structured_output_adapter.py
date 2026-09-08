from __future__ import annotations

from enum import Enum
from typing import Any, Callable, Mapping

from pydantic import BaseModel, ConfigDict, Field

from core.langgraph_engine.contracts.tool_interface import ToolExecutionResult


class StructuredOutputType(str, Enum):
    RAW = "raw"
    EVIDENCE = "evidence"
    GRAPH_OPS = "graph_ops"
    SUMMARY = "summary"


class StructuredOutput(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: StructuredOutputType = StructuredOutputType.RAW
    payload: dict[str, Any] = Field(default_factory=dict)
    refs: list[str] = Field(default_factory=list)
    confidence: float | None = None


StructuredOutputAdapter = Callable[[ToolExecutionResult, Mapping[str, Any]], ToolExecutionResult]


def attach_structured_output(
    result: ToolExecutionResult,
    structured: StructuredOutput | dict[str, Any],
) -> ToolExecutionResult:
    payload = structured.model_dump() if hasattr(structured, "model_dump") else dict(structured)
    updated: ToolExecutionResult = dict(result)
    metadata = dict(updated.get("metadata") or {})
    if "structured_output" not in metadata:
        metadata["structured_output"] = payload
    updated["metadata"] = metadata
    return updated


def wrap_raw_output(result: ToolExecutionResult) -> ToolExecutionResult:
    if result.get("metadata") and isinstance(result.get("metadata"), dict):
        if "structured_output" in result["metadata"]:
            return result
    raw_payload = {"raw_output": result.get("output")}
    structured = StructuredOutput(type=StructuredOutputType.RAW, payload=raw_payload)
    return attach_structured_output(result, structured)
