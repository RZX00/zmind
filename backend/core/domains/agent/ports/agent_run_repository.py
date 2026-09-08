from __future__ import annotations

from typing import Protocol, Optional, Dict, Any, Tuple

from core.domains.agent.model import AgentRun


class AgentRunRepository(Protocol):
    async def create_run(
        self,
        *,
        thread_id: str,
        status: str,
        started_at: Optional[str],
        agent_id: Optional[str],
        agent_version_id: Optional[str],
        metadata: Dict[str, Any],
        idempotency_key: Optional[str],
        skip_idempotency_lookup: bool = False,
    ) -> Tuple[AgentRun, bool]:
        ...

    async def update_status(
        self,
        *,
        agent_run_id: str,
        status: str,
        error: Optional[str] = None,
        completed_at: Optional[str] = None,
        expected_status: Optional[str] = None,
    ) -> Optional[AgentRun]:
        ...

    async def get_by_id(self, agent_run_id: str) -> Optional[AgentRun]:
        ...

    async def get_with_workspace(self, agent_run_id: str) -> Optional[AgentRun]:
        ...
