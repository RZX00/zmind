from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional

from core.services.supabase import DBConnection


@dataclass(slots=True)
class ToolRuntimeContext:
    thread_id: str
    project_id: Optional[str]
    account_id: Optional[str]
    agent_config: Optional[dict]
    canvas_id: Optional[str]
    db: DBConnection
    thread_manager: Any | None = None

    @classmethod
    def from_mapping(cls, context: Mapping[str, Any]) -> "ToolRuntimeContext":
        run_config = context.get("run_config")

        def _get(name: str):
            value = context.get(name)
            if value is None and run_config is not None:
                value = getattr(run_config, name, None)
            return value

        thread_id = _get("thread_id")
        if not thread_id:
            raise ValueError("thread_id is required for tool execution")

        db = context.get("db_connection") or context.get("db")
        if db is None:
            db = DBConnection()

        return cls(
            thread_id=str(thread_id),
            project_id=_get("project_id"),
            account_id=_get("account_id"),
            agent_config=_get("agent_config"),
            canvas_id=_get("canvas_id"),
            db=db,
            thread_manager=context.get("thread_manager"),
        )
