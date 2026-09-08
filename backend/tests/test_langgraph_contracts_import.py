from core.langgraph_engine.contracts import TERMINATING_TOOL_NAMES, fixtures


def test_contracts_fixtures_importable():
    assert fixtures.SAMPLE_RUN_CONFIG.agent_run_id
    assert fixtures.SAMPLE_STATE["checkpoint_thread_id"] == fixtures.SAMPLE_RUN_CONFIG.agent_run_id
    assert fixtures.SAMPLE_EVENTS
    assert fixtures.SAMPLE_LEGACY_SSE_PAYLOADS
    assert "complete" in TERMINATING_TOOL_NAMES
