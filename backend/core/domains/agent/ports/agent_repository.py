from __future__ import annotations

from typing import Protocol

from core.domains.agent.model import Agent


class AgentRepository(Protocol):
    async def get(self, agent_id: str, workspace_id: str) -> Agent:
        ...
