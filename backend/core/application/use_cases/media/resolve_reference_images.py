from __future__ import annotations

from typing import Dict, List, Optional

from core.domains.media.reference_image import (
    ReferenceImageCandidate,
    ReferenceImageInput,
    ReferenceImageResolution,
    ResolvedReferenceImage,
    UnresolvedReferenceImage,
)
from core.domains.media.ports.canvas_media_repository import CanvasMediaRepository, CanvasMediaNode
from core.domains.media.ports.reference_image_repository import ReferenceImageRepository


class ResolveReferenceImagesUseCase:
    def __init__(
        self,
        reference_repo: ReferenceImageRepository,
        canvas_repo: CanvasMediaRepository,
    ) -> None:
        self._reference_repo = reference_repo
        self._canvas_repo = canvas_repo

    async def execute(
        self,
        reference_images: List[ReferenceImageInput],
        *,
        account_id: Optional[str],
        canvas_id: Optional[str],
        max_candidates: int = 12,
    ) -> ReferenceImageResolution:
        normalized = [img for img in reference_images if isinstance(img, ReferenceImageInput)]
        nodes = await self._load_nodes(canvas_id, account_id)
        node_map = {node.node_id: node for node in nodes}
        resolved: List[ResolvedReferenceImage] = []
        unresolved: List[UnresolvedReferenceImage] = []
        backfilled_nodes: List[str] = []
        seen_file_ids: set[str] = set()
        storage_cache: Dict[str, Optional[str]] = {}

        for img in normalized:
            if img.is_empty():
                continue
            resolved_img = await self._resolve_single(
                img,
                account_id=account_id,
                node_map=node_map,
                storage_cache=storage_cache,
            )
            if isinstance(resolved_img, ResolvedReferenceImage):
                if resolved_img.file_id not in seen_file_ids:
                    resolved.append(resolved_img)
                    seen_file_ids.add(resolved_img.file_id)
                if resolved_img.node_id and resolved_img.node_id in node_map:
                    node = node_map[resolved_img.node_id]
                    if not node.file_id and resolved_img.file_id:
                        if await self._backfill_node(canvas_id, account_id, resolved_img.node_id, resolved_img.file_id):
                            backfilled_nodes.append(resolved_img.node_id)
                continue
            unresolved.append(resolved_img)

        candidates = await self._build_candidates(
            nodes,
            account_id=account_id,
            canvas_id=canvas_id,
            max_candidates=max_candidates,
            storage_cache=storage_cache,
            backfilled_nodes=backfilled_nodes,
        )

        return ReferenceImageResolution(
            resolved=resolved,
            unresolved=unresolved,
            candidates=candidates,
            backfilled_nodes=backfilled_nodes,
        )

    async def _resolve_single(
        self,
        img: ReferenceImageInput,
        *,
        account_id: Optional[str],
        node_map: Dict[str, CanvasMediaNode],
        storage_cache: Dict[str, Optional[str]],
    ) -> ResolvedReferenceImage | UnresolvedReferenceImage:
        if img.file_id:
            record = await self._reference_repo.get_file_by_id(img.file_id, account_id)
            if record:
                return ResolvedReferenceImage(
                    file_id=record["id"],
                    storage_path=record.get("storage_path"),
                    node_id=img.node_id,
                    label=img.label,
                    width=img.width,
                    height=img.height,
                    source=img.source,
                )
            return UnresolvedReferenceImage(img, "file_id_not_found")

        if img.storage_path:
            file_id = await self._resolve_storage_path(img.storage_path, account_id, storage_cache)
            if file_id:
                return ResolvedReferenceImage(
                    file_id=file_id,
                    storage_path=img.storage_path,
                    node_id=img.node_id,
                    label=img.label,
                    width=img.width,
                    height=img.height,
                    source=img.source,
                )
            return UnresolvedReferenceImage(img, "storage_path_not_found")

        if img.node_id:
            node = node_map.get(img.node_id)
            if node and node.file_id:
                return ResolvedReferenceImage(
                    file_id=node.file_id,
                    storage_path=node.storage_path,
                    node_id=node.node_id,
                    label=img.label or node.label,
                    width=img.width or node.width,
                    height=img.height or node.height,
                    source=img.source,
                )
            if node and node.storage_path:
                file_id = await self._resolve_storage_path(node.storage_path, account_id, storage_cache)
                if file_id:
                    return ResolvedReferenceImage(
                        file_id=file_id,
                        storage_path=node.storage_path,
                        node_id=node.node_id,
                        label=img.label or node.label,
                        width=img.width or node.width,
                        height=img.height or node.height,
                        source=img.source,
                    )
            return UnresolvedReferenceImage(img, "node_reference_unresolved")

        return UnresolvedReferenceImage(img, "missing_reference")

    async def _resolve_storage_path(
        self,
        storage_path: str,
        account_id: Optional[str],
        storage_cache: Dict[str, Optional[str]],
    ) -> Optional[str]:
        if storage_path in storage_cache:
            return storage_cache[storage_path]
        record = await self._reference_repo.get_file_by_storage_path(storage_path, account_id)
        file_id = record.get("id") if record else None
        storage_cache[storage_path] = file_id
        return file_id

    async def _load_nodes(
        self, canvas_id: Optional[str], account_id: Optional[str]
    ) -> List[CanvasMediaNode]:
        if not canvas_id:
            return []
        return await self._canvas_repo.list_media_nodes(canvas_id, account_id)

    async def _backfill_node(
        self,
        canvas_id: Optional[str],
        account_id: Optional[str],
        node_id: str,
        file_id: str,
    ) -> bool:
        if not canvas_id:
            return False
        try:
            return await self._canvas_repo.update_node_file_id(canvas_id, account_id, node_id, file_id)
        except Exception:
            return False

    async def _build_candidates(
        self,
        nodes: List[CanvasMediaNode],
        *,
        account_id: Optional[str],
        canvas_id: Optional[str],
        max_candidates: int,
        storage_cache: Dict[str, Optional[str]],
        backfilled_nodes: List[str],
    ) -> List[ReferenceImageCandidate]:
        if not nodes:
            return []
        sorted_nodes = sorted(
            nodes,
            key=lambda n: (n.updated_at or 0),
            reverse=True,
        )
        candidates: List[ReferenceImageCandidate] = []
        for node in sorted_nodes:
            file_id = node.file_id
            if not file_id and node.storage_path:
                file_id = await self._resolve_storage_path(node.storage_path, account_id, storage_cache)
                if file_id and canvas_id:
                    if await self._backfill_node(canvas_id, account_id, node.node_id, file_id):
                        backfilled_nodes.append(node.node_id)
            if not file_id:
                continue
            candidates.append(
                ReferenceImageCandidate(
                    file_id=file_id,
                    storage_path=node.storage_path,
                    node_id=node.node_id,
                    label=node.label,
                    width=node.width,
                    height=node.height,
                )
            )
            if len(candidates) >= max_candidates:
                break
        return candidates
