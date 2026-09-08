"""
Core tool system providing the foundation for creating and managing tools.

This module defines the base classes and decorators for creating tools:
- Tool base class for implementing tool functionality
- Schema decorators for OpenAPI tool definitions
- Result containers for standardized tool outputs
"""

from typing import Dict, Any, Union, List, Optional
from dataclasses import dataclass
from abc import ABC
import json
import inspect
from enum import Enum


class SchemaType(Enum):
    """Enumeration of supported schema types for tool definitions."""

    OPENAPI = "openapi"
    USAGE_EXAMPLE = "usage_example"


@dataclass
class ToolSchema:
    """Container for tool schemas with type information.

    Attributes:
        schema_type (SchemaType): Type of schema (OpenAPI)
        schema (Dict[str, Any]): The actual schema definition
    """

    schema_type: SchemaType
    schema: Dict[str, Any]


@dataclass
class ToolResult:
    """Container for tool execution results.

    Attributes:
        success (bool): Whether the tool execution succeeded
        output (str): Output message or error description
        metadata (Optional[Dict[str, Any]]): Optional metadata for tool consumers
    """

    success: bool
    output: str
    metadata: Optional[Dict[str, Any]] = None


class Tool(ABC):
    """Abstract base class for all tools.

    Provides the foundation for implementing tools with schema registration
    and result handling capabilities.

    Attributes:
        _schemas (Dict[str, List[ToolSchema]]): Registered schemas for tool methods

    Methods:
        get_schemas: Get all registered tool schemas
        success_response: Create a successful result
        fail_response: Create a failed result
    """

    def __init__(self):
        """Initialize tool with empty schema registry."""
        self._schemas: Dict[str, List[ToolSchema]] = {}
        self._register_schemas()

    def _register_schemas(self):
        """Register schemas from all decorated methods."""
        for name, method in inspect.getmembers(self, predicate=inspect.ismethod):
            if hasattr(method, "tool_schemas"):
                self._schemas[name] = method.tool_schemas

    def get_schemas(self) -> Dict[str, List[ToolSchema]]:
        """Get all registered tool schemas.

        Returns:
            Dict mapping method names to their schema definitions
        """
        return self._schemas

    def success_response(
        self,
        data: Union[Dict[str, Any], str],
        *,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> ToolResult:
        """Create a successful tool result.

        Args:
            data: Result data (dictionary or string)

        Returns:
            ToolResult with success=True and formatted output
        """
        if isinstance(data, str):
            text = data
        else:
            text = json.dumps(data, indent=2)
        return ToolResult(success=True, output=text, metadata=metadata)

    def fail_response(self, msg: str, *, metadata: Optional[Dict[str, Any]] = None) -> ToolResult:
        """Create a failed tool result.

        Args:
            msg: Error message describing the failure

        Returns:
            ToolResult with success=False and error message
        """
        return ToolResult(success=False, output=msg, metadata=metadata)


def _add_schema(func, schema: ToolSchema):
    """Helper to add schema to a function."""
    if not hasattr(func, "tool_schemas"):
        func.tool_schemas = []
    func.tool_schemas.append(schema)
    return func


def openapi_schema(schema: Dict[str, Any]):
    """Decorator for OpenAPI schema tools."""

    def decorator(func):
        return _add_schema(
            func,
            ToolSchema(schema_type=SchemaType.OPENAPI, schema=schema),
        )

    return decorator


def usage_example(example: str):
    """Decorator for providing usage examples for tools in prompts."""

    def decorator(func):
        return _add_schema(
            func,
            ToolSchema(schema_type=SchemaType.USAGE_EXAMPLE, schema={"example": example}),
        )

    return decorator
