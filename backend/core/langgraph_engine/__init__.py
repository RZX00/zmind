"""
LangGraph execution engine (WS-A).

This package is introduced as part of the LangGraph migration.
Contracts live under `core.langgraph_engine.contracts` and are treated as a frozen
team-wide baseline (v1).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

__all__ = [
    "LangGraphEngine",
    "LangGraphBuilder",
    "MemoryCheckpointStore",
    "SupabaseCheckpointStore",
]

if TYPE_CHECKING:
    from .engine import LangGraphEngine
    from .graph import LangGraphBuilder
    from .checkpoint_store import MemoryCheckpointStore, SupabaseCheckpointStore


def __getattr__(name: str):
    if name == "LangGraphEngine":
        from .engine import LangGraphEngine

        return LangGraphEngine
    if name == "LangGraphBuilder":
        from .graph import LangGraphBuilder

        return LangGraphBuilder
    if name == "MemoryCheckpointStore":
        from .checkpoint_store import MemoryCheckpointStore

        return MemoryCheckpointStore
    if name == "SupabaseCheckpointStore":
        from .checkpoint_store import SupabaseCheckpointStore

        return SupabaseCheckpointStore
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
