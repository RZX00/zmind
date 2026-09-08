import json
from types import SimpleNamespace

import pytest

from core.media.generation_service import GeneratedMediaItem
from core.tools.doc_agent_tool import DocAgentTool
from core.utils.config import config


class _FakeApplyResult:
    def __init__(self, payload):
        self._payload = payload

    def model_dump(self):
        return dict(self._payload)


class _FakeDocsService:
    def __init__(self, *, version: int = 3, content: str = "# Doc\n"):
        self.doc = SimpleNamespace(version=version, contentMd=content)
        self.apply_calls = []

    async def get_doc(self, *, workspace_id: str, item_id: str):
        return self.doc

    async def apply_doc_ops(self, *, workspace_id: str, user_id: str, item_id: str, payload, client_request_id=None):
        self.apply_calls.append(
            {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "item_id": item_id,
                "payload": payload,
                "client_request_id": client_request_id,
            }
        )
        return _FakeApplyResult(
            {
                "itemId": item_id,
                "revisionId": "docrev_1",
                "previousVersion": payload.baseVersion,
                "version": payload.baseVersion + 1,
                "updatedAt": 123,
                "appliedOps": len(payload.ops),
                "summary": payload.summary or "",
                "idempotentReplay": False,
            }
        )


class _FakeMediaService:
    def __init__(self, items):
        self.items = items
        self.requests = []

    async def generate_images(self, request):
        self.requests.append(request)
        return list(self.items)


@pytest.mark.asyncio
async def test_doc_generate_image_and_insert_appends_and_links(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "SUPABASE_JWT_SECRET", "test-secret", raising=False)

    docs_service = _FakeDocsService(version=3, content="# Intro\n\nBody")
    media_service = _FakeMediaService(
        [
            GeneratedMediaItem(
                storage_path="acct/canvas-media/2026/03/04/img.png",
                width=1024,
                height=1024,
                mime_type="image/png",
                byte_size=1024,
                file_id="file_123",
            )
        ]
    )
    tool = DocAgentTool(
        thread_id="thread_1",
        account_id="acct",
        doc_item_id="item_1",
        docs_service=docs_service,
        media_service=media_service,
    )

    linked = []

    async def _fake_link_file_to_doc(*, file_id: str, doc_item_id: str):
        linked.append((file_id, doc_item_id))

    monkeypatch.setattr(tool, "_link_file_to_doc", _fake_link_file_to_doc)

    result = await tool.doc_generate_image_and_insert(
        prompt="A clean architecture diagram",
        placement="append",
    )

    assert result.success is True
    payload = json.loads(result.output)
    assert payload["itemId"] == "item_1"
    assert payload["version"] == 4
    assert payload["placement"] == "append"
    assert payload["generatedImages"][0]["fileId"] == "file_123"
    assert "doc_item_id=item_1" in payload["generatedImages"][0]["url"]
    assert linked == [("file_123", "item_1")]

    assert len(docs_service.apply_calls) == 1
    apply_call = docs_service.apply_calls[0]
    op = apply_call["payload"].ops[0].model_dump(by_alias=True)
    assert op["op"] == "insert_at"
    assert op["position"] == len("# Intro\n\nBody")
    assert "![A clean architecture diagram]" in op["contentMd"]


@pytest.mark.asyncio
async def test_doc_generate_image_and_insert_stale_base_version_auto_rebases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "SUPABASE_JWT_SECRET", "test-secret", raising=False)

    docs_service = _FakeDocsService(version=16, content="# Intro\n\nBody")
    media_service = _FakeMediaService(
        [
            GeneratedMediaItem(
                storage_path="acct/canvas-media/2026/03/04/img-rebase.png",
                width=1024,
                height=1024,
                mime_type="image/png",
                byte_size=1024,
                file_id="file_rebase",
            )
        ]
    )
    tool = DocAgentTool(
        thread_id="thread_rebase",
        account_id="acct",
        doc_item_id="item_rebase",
        docs_service=docs_service,
        media_service=media_service,
    )

    async def _noop_link_file_to_doc(*, file_id: str, doc_item_id: str) -> None:
        return None

    monkeypatch.setattr(tool, "_link_file_to_doc", _noop_link_file_to_doc)

    result = await tool.doc_generate_image_and_insert(
        prompt="A rebased architecture diagram",
        placement="append",
        base_version=15,
    )

    assert result.success is True
    payload = json.loads(result.output)
    assert payload["autoRebasedOnConflict"] is True
    assert payload["requestedBaseVersion"] == 15
    assert payload["effectiveBaseVersion"] == 16
    assert payload["version"] == 17
    assert len(docs_service.apply_calls) == 1
    assert docs_service.apply_calls[0]["payload"].baseVersion == 16


@pytest.mark.asyncio
async def test_doc_generate_image_and_insert_requires_block_id_for_block_placement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "SUPABASE_JWT_SECRET", "test-secret", raising=False)
    tool = DocAgentTool(
        thread_id="thread_2",
        account_id="acct",
        doc_item_id="item_2",
        docs_service=_FakeDocsService(),
        media_service=_FakeMediaService(
            [
                GeneratedMediaItem(
                    storage_path="acct/canvas-media/2026/03/04/img2.png",
                    width=800,
                    height=600,
                    mime_type="image/png",
                    byte_size=999,
                    file_id="file_2",
                )
            ]
        ),
    )
    async def _noop_link_file_to_doc(*, file_id: str, doc_item_id: str) -> None:
        return None

    monkeypatch.setattr(tool, "_link_file_to_doc", _noop_link_file_to_doc)

    result = await tool.doc_generate_image_and_insert(
        prompt="Generate image",
        placement="insert_after_block",
    )

    assert result.success is False
    assert "block_id is required" in result.output
