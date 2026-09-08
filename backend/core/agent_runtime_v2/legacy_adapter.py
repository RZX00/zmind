from __future__ import annotations

from typing import Any

from .adapters.legacy_events import AgentEventLegacyProjectionV2
from .contracts import AgentEventV2


def agent_event_v2_to_legacy_chunk(event: AgentEventV2) -> dict[str, Any]:
    return AgentEventLegacyProjectionV2.to_legacy_chunk(event)
