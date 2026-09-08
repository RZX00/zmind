from pathlib import Path


def test_ws_b_new_engine_has_no_xml_tool_parser_references():
    root = Path(__file__).resolve().parents[1] / "core" / "langgraph_engine"
    bad_tokens = ("XMLToolParser", "<function_calls>")
    offenders = []

    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8", errors="replace")
        for token in bad_tokens:
            if token in text:
                offenders.append(f"{path}:{token}")

    assert offenders == []

