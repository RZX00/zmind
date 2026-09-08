import pytest

from core.application.use_cases.media.resolve_reference_images import ResolveReferenceImagesUseCase
from core.domains.media.reference_image import ReferenceImageInput
from core.domains.media.ports.canvas_media_repository import CanvasMediaNode


class FakeReferenceRepo:
    def __init__(self, by_id=None, by_path=None):
        self.by_id = by_id or {}
        self.by_path = by_path or {}

    async def get_file_by_id(self, file_id, account_id):
        record = self.by_id.get(file_id)
        if not record:
            return None
        return {"id": file_id, "storage_path": record}

    async def get_file_by_storage_path(self, storage_path, account_id):
        file_id = self.by_path.get(storage_path)
        if not file_id:
            return None
        return {"id": file_id, "storage_path": storage_path}


class FakeCanvasRepo:
    def __init__(self, nodes):
        self.nodes = nodes
        self.updated = []

    async def list_media_nodes(self, canvas_id, account_id):
        return self.nodes

    async def update_node_file_id(self, canvas_id, account_id, node_id, file_id):
        self.updated.append((node_id, file_id))
        return True


@pytest.mark.asyncio
async def test_resolve_reference_images_by_storage_path_and_backfill():
    storage_path = "acct/canvas-media/2026/02/05/image.png"
    file_id = "file-123"
    node_id = "node-1"
    reference_repo = FakeReferenceRepo(by_path={storage_path: file_id})
    canvas_repo = FakeCanvasRepo(
        [
            CanvasMediaNode(
                node_id=node_id,
                file_id=None,
                storage_path=storage_path,
                label="Test",
                width=512,
                height=512,
                updated_at=123,
            )
        ]
    )
    use_case = ResolveReferenceImagesUseCase(reference_repo, canvas_repo)
    result = await use_case.execute(
        [ReferenceImageInput(storage_path=storage_path, node_id=node_id)],
        account_id="acct",
        canvas_id="canvas",
    )
    assert result.resolved
    assert result.resolved[0].file_id == file_id
    assert node_id in result.backfilled_nodes


@pytest.mark.asyncio
async def test_unresolved_reference_returns_candidates():
    node_id = "node-2"
    file_id = "file-999"
    reference_repo = FakeReferenceRepo(by_id={file_id: "path.png"})
    canvas_repo = FakeCanvasRepo(
        [
            CanvasMediaNode(
                node_id=node_id,
                file_id=file_id,
                storage_path="path.png",
                label="Candidate",
                width=256,
                height=256,
                updated_at=999,
            )
        ]
    )
    use_case = ResolveReferenceImagesUseCase(reference_repo, canvas_repo)
    result = await use_case.execute(
        [ReferenceImageInput(file_id="missing")],
        account_id="acct",
        canvas_id="canvas",
    )
    assert result.unresolved
    assert result.candidates
