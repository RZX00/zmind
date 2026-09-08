from core.docs.agent_context import normalize_doc_context_payload


def test_normalize_doc_context_selection_mode() -> None:
    payload = {
        "surface": "doc",
        "doc_item_id": "doc-1",
        "doc_title": "Roadmap",
        "selection": {"markdown": "## Heading\n\ncontent"},
    }

    normalized, warnings = normalize_doc_context_payload(payload)

    assert warnings == []
    assert normalized is not None
    assert normalized["surface"] == "doc"
    assert normalized["doc_item_id"] == "doc-1"
    assert normalized["mode"] == "selection"
    assert normalized["selection"]["markdown"] == "## Heading\n\ncontent"


def test_normalize_doc_context_from_nested_key() -> None:
    payload = {
        "doc_context": {
            "docItemId": "doc-2",
            "documentExcerpt": "Body text",
        }
    }

    normalized, warnings = normalize_doc_context_payload(payload)

    assert normalized is not None
    assert normalized["doc_item_id"] == "doc-2"
    assert normalized["mode"] == "document"
    assert "document" in normalized
    assert "doc_context_missing_shape" not in warnings


def test_normalize_doc_context_rejects_non_doc_shape() -> None:
    payload = {"meta": {"canvas_id": "abc"}, "nodes": []}

    normalized, warnings = normalize_doc_context_payload(payload)

    assert normalized is None
    assert "doc_context_missing_shape" in warnings
