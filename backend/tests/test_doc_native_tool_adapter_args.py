from core.langgraph_engine.tools.adapters.native_tool_adapter import _normalize_doc_tool_args


def test_normalize_doc_tool_args_maps_doc_apply_ops_aliases() -> None:
    raw = {
        "docItemId": "item_1",
        "baseVersion": 3,
        "idempotencyKey": "idem_1",
        "summary": "rewrite",
        "ops": [{"op": "replace_document", "contentMd": "new"}],
    }

    normalized = _normalize_doc_tool_args(raw)

    assert normalized["doc_item_id"] == "item_1"
    assert normalized["base_version"] == 3
    assert normalized["idempotency_key"] == "idem_1"
    assert normalized["summary"] == "rewrite"
    assert normalized["ops"] == raw["ops"]
    assert "docItemId" not in normalized
    assert "baseVersion" not in normalized
    assert "idempotencyKey" not in normalized


def test_normalize_doc_tool_args_preserves_existing_snake_case() -> None:
    raw = {
        "doc_item_id": "item_2",
        "revision_id": "rev_2",
        "expected_current_version": 9,
    }

    normalized = _normalize_doc_tool_args(raw)

    assert normalized["doc_item_id"] == "item_2"
    assert normalized["revision_id"] == "rev_2"
    assert normalized["expected_current_version"] == 9


def test_normalize_doc_tool_args_drops_aliases_before_method_call() -> None:
    raw = {
        "docItemId": "item_3",
        "baseVersion": 5,
        "ops": [],
        "summary": "x",
    }
    normalized = _normalize_doc_tool_args(raw)

    def _call_doc_apply_ops(*, doc_item_id: str, base_version: int, ops: list, summary: str):
        return doc_item_id, base_version, ops, summary

    result = _call_doc_apply_ops(**normalized)
    assert result == ("item_3", 5, [], "x")


def test_normalize_doc_tool_args_prefers_existing_snake_case_values() -> None:
    raw = {
        "doc_item_id": "canonical-item",
        "docItemId": "alias-item",
        "base_version": 11,
        "baseVersion": 99,
        "ops": [],
    }
    normalized = _normalize_doc_tool_args(raw)

    assert normalized["doc_item_id"] == "canonical-item"
    assert normalized["base_version"] == 11
    assert "docItemId" not in normalized
    assert "baseVersion" not in normalized


def test_normalize_doc_tool_args_maps_doc_update_title_aliases() -> None:
    raw = {
        "docItemId": "item_9",
        "docTitle": "Renamed by AI",
    }
    normalized = _normalize_doc_tool_args(raw)

    def _call_doc_update_title(*, doc_item_id: str, title: str):
        return doc_item_id, title

    result = _call_doc_update_title(**normalized)
    assert result == ("item_9", "Renamed by AI")
    assert "docItemId" not in normalized
    assert "docTitle" not in normalized


def test_normalize_doc_tool_args_maps_doc_generate_image_aliases() -> None:
    raw = {
        "docItemId": "item_77",
        "baseVersion": 12,
        "blockId": "block_1",
        "altText": "Alt copy",
        "aspectRatio": "16:9",
        "referenceImageIds": ["file_1", "file_2"],
        "urlTtlSeconds": 3600,
    }

    normalized = _normalize_doc_tool_args(raw)

    assert normalized["doc_item_id"] == "item_77"
    assert normalized["base_version"] == 12
    assert normalized["block_id"] == "block_1"
    assert normalized["alt_text"] == "Alt copy"
    assert normalized["aspect_ratio"] == "16:9"
    assert normalized["reference_image_ids"] == ["file_1", "file_2"]
    assert normalized["url_ttl_seconds"] == 3600
    assert "docItemId" not in normalized
    assert "baseVersion" not in normalized
    assert "blockId" not in normalized
    assert "altText" not in normalized
    assert "aspectRatio" not in normalized
    assert "referenceImageIds" not in normalized
    assert "urlTtlSeconds" not in normalized
