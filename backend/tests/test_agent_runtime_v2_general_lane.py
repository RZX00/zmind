from __future__ import annotations

import pytest

from core.agent_runtime_v2.adapters.langgraph_general_lane import LangGraphGeneralLaneAdapter
from core.agent_runtime_v2.contracts import RuntimeContextV2, RuntimeIdentityV2
from core.agent_runtime_v2.event_bus import CanonicalEventBusV2
from core.agent_runtime_v2.tool_policy import ToolPolicyDecisionV2
from core.agent_runtime_v2.tool_pool import ToolPoolV2


class _FakeEngine:
    init_kwargs = None
    last_run_config = None

    def __init__(self, **kwargs) -> None:
        type(self).init_kwargs = kwargs

    async def run(self, run_config):
        type(self).last_run_config = run_config
        yield {"type": "assistant_final", "content": {"role": "assistant", "content": "done"}}
        yield {"type": "status", "terminal_status": "completed"}


@pytest.mark.asyncio
async def test_langgraph_general_lane_uses_kernel_context_and_canonical_mapping() -> None:
    context = RuntimeContextV2(
        identity=RuntimeIdentityV2(
            run_id="run_1",
            thread_id="thread_1",
            account_id="acct_1",
            project_id=None,
        ),
        surface="doc",
        lane="general",
        latest_user_text="Summarize the current document",
        prompt_context={
            "assembled": {
                "messages_context": [
                    {
                        "role": "system",
                        "content": "Runtime Context V2\nsurface=doc\nlane=general",
                    }
                ]
            }
        },
        policy_context={
            "tool_policy": {"side_effect_policy": "allow_all"},
            "tool_pool": {"tool_count": 0},
        },
    )
    bus = CanonicalEventBusV2(runtime_context=context)
    tool_pool = ToolPoolV2(
        registry=None,
        policy=ToolPolicyDecisionV2(
            allowed_names=None,
            allowed_prefixes=None,
            source="test",
            side_effect_policy="allow_all",
            decision_trace={},
        ),
        mcp_enabled=False,
    )
    adapter = LangGraphGeneralLaneAdapter(
        checkpoint_store=object(),
        engine_factory=_FakeEngine,
    )

    events = [event async for event in adapter.run(context=context, bus=bus, tool_pool=tool_pool)]

    assert _FakeEngine.init_kwargs["persist_events"] is False
    assert _FakeEngine.init_kwargs["async_event_persistence"] is False
    assert _FakeEngine.last_run_config.append_messages_context == context.prompt_context["assembled"]["messages_context"]
    assert [event.event_type for event in events] == ["run.message", "run.completed"]
