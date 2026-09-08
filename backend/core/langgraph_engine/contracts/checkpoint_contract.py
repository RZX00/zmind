from __future__ import annotations

from typing import Any, Protocol, TypedDict

from .state_schema import GraphState


# v1 decision: store checkpoints in Supabase table `agent_run_checkpoints`.
CHECKPOINT_TABLE_NAME: str = "agent_run_checkpoints"


class CheckpointRecord(TypedDict):
    """
    Storage record for a checkpoint row.

    Recommended schema (decision 3):
    - agent_run_id (text)
    - checkpoint_id (text)
    - state_json (jsonb)
    - created_at (timestamp)
    Unique constraint: (agent_run_id, checkpoint_id)
    """

    agent_run_id: str
    checkpoint_id: str
    state_json: dict[str, Any]
    created_at: str


class CheckpointStore(Protocol):
    """
    Checkpoint interface (v1).

    Contract:
    - checkpoint_thread_id MUST equal agent_run_id.
    - save() returns the checkpoint_id written.
    - load() returns the state for (agent_run_id, checkpoint_id) or latest if checkpoint_id is None.
    """

    async def save(self, state: GraphState) -> str: ...

    async def load(self, agent_run_id: str, checkpoint_id: str | None = None) -> GraphState | None: ...

