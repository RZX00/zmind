from core.langgraph_engine.stream.terminal import normalize_terminal_status


def test_normalize_terminal_status_mapping():
    assert normalize_terminal_status("completed") == "completed"
    assert normalize_terminal_status("stopped") == "stopped"
    assert normalize_terminal_status("failed") == "failed"
    assert normalize_terminal_status("error") == "failed"
    assert normalize_terminal_status("unexpected") == "unexpected"
