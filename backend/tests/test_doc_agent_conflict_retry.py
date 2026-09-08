import json

import pytest
from fastapi import HTTPException
from pydantic import BaseModel

from core.tools.doc_agent_tool import DocAgentTool


class _FakeApplyResult:
    def __init__(self, payload):
        self._payload = payload

    def model_dump(self):
        return dict(self._payload)


class _DocsServiceConflictThenSuccess:
    def __init__(self):
        self.calls = []

    async def apply_doc_ops(self, *, workspace_id: str, user_id: str, item_id: str, payload, client_request_id=None):
        self.calls.append(payload.baseVersion)
        if len(self.calls) == 1:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Doc version conflict",
                    "currentVersion": 14,
                    "expectedVersion": payload.baseVersion,
                },
            )
        return _FakeApplyResult(
            {
                "itemId": item_id,
                "revisionId": "docrev_retry",
                "previousVersion": 14,
                "version": 15,
                "updatedAt": 123,
                "appliedOps": 1,
                "summary": "ok",
                "idempotentReplay": False,
            }
        )


class _DocsServiceConflictWithoutVersion:
    async def apply_doc_ops(self, *, workspace_id: str, user_id: str, item_id: str, payload, client_request_id=None):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Doc version conflict",
                "expectedVersion": payload.baseVersion,
            },
        )


class _DocBlock(BaseModel):
    blockId: str


class _DocsServicePositionToBlockId:
    def __init__(self):
        self.last_payload = None

    async def list_doc_blocks(self, *, workspace_id: str, item_id: str):
        return [
            _DocBlock(blockId="block_0"),
            _DocBlock(blockId="block_1"),
            _DocBlock(blockId="block_2"),
        ]

    async def apply_doc_ops(self, *, workspace_id: str, user_id: str, item_id: str, payload, client_request_id=None):
        self.last_payload = payload
        return _FakeApplyResult(
            {
                "itemId": item_id,
                "revisionId": "docrev_pos",
                "previousVersion": payload.baseVersion,
                "version": payload.baseVersion + 1,
                "updatedAt": 123,
                "appliedOps": 1,
                "summary": "ok",
                "idempotentReplay": False,
            }
        )


@pytest.mark.asyncio
async def test_doc_apply_ops_auto_retries_with_current_version() -> None:
    docs_service = _DocsServiceConflictThenSuccess()
    tool = DocAgentTool(
        thread_id="thread_retry",
        account_id="acct",
        doc_item_id="item_retry",
        docs_service=docs_service,
    )

    result = await tool.doc_apply_ops(
        base_version=11,
        ops=[{"op": "replace_document", "contentMd": "next"}],
    )

    assert result.success is True
    payload = json.loads(result.output)
    assert payload["version"] == 15
    assert payload["autoRebasedOnConflict"] is True
    assert payload["requestedBaseVersion"] == 11
    assert payload["effectiveBaseVersion"] == 14
    assert docs_service.calls == [11, 14]


@pytest.mark.asyncio
async def test_doc_apply_ops_conflict_without_current_version_still_fails() -> None:
    tool = DocAgentTool(
        thread_id="thread_fail",
        account_id="acct",
        doc_item_id="item_fail",
        docs_service=_DocsServiceConflictWithoutVersion(),
    )

    result = await tool.doc_apply_ops(
        base_version=11,
        ops=[{"op": "replace_document", "contentMd": "next"}],
    )

    assert result.success is False
    assert "doc_apply_ops_http_409" in result.output


@pytest.mark.asyncio
async def test_doc_apply_ops_maps_position_to_block_id_for_block_insert_ops() -> None:
    docs_service = _DocsServicePositionToBlockId()
    tool = DocAgentTool(
        thread_id="thread_map",
        account_id="acct",
        doc_item_id="item_map",
        docs_service=docs_service,
    )

    result = await tool.doc_apply_ops(
        base_version=7,
        ops=[
            {
                "op": "insert_after_block",
                "position": 1,
                "content_md": "hello",
            }
        ],
    )

    assert result.success is True
    assert docs_service.last_payload is not None
    op_payload = docs_service.last_payload.ops[0].model_dump(by_alias=True)
    assert op_payload["op"] == "insert_after_block"
    assert op_payload["blockId"] == "block_1"
    assert op_payload["contentMd"] == "hello"
