from __future__ import annotations

import asyncio
import base64
from datetime import datetime, timezone
from pathlib import PurePosixPath
import re
from typing import Any, Optional
from urllib.parse import quote
import uuid

from fastapi import HTTPException

from core.docs.api_models import CreateDocRequest
from core.docs.service import DocsService
from core.references.api_models import CreateReferenceRequest
from core.references.service import ReferencesService
from core.services.r2_storage import get_r2_bucket, get_r2_client
from core.services.supabase import DBConnection
from core.utils.logger import logger

from .link_resolver import normalize_resource_key, resolve_asset_target, resolve_note_target
from .parser import (
    VaultAssetFile,
    file_name_to_title,
    parse_assets_payload,
    parse_embed_links,
    parse_files_payload,
    parse_wikilinks,
    parse_zip_payload,
)


MARKDOWN_IMAGE_PATTERN = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
EMBED_LINK_PATTERN = re.compile(r"!\[\[([^\]]+)\]\]")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_stats() -> dict[str, Any]:
    return {
        "total_files": 0,
        "imported_docs": 0,
        "imported_assets": 0,
        "created_references": 0,
        "unresolved_links": 0,
        "failed_files": 0,
    }


def _is_markdown_target(note: str) -> bool:
    suffix = PurePosixPath((note or "").strip()).suffix.lower()
    return suffix in {"", ".md"}


def _sanitize_filename(name: str) -> str:
    text = (name or "asset").strip().replace("\\", "/")
    base = PurePosixPath(text).name
    base = re.sub(r"[^a-zA-Z0-9._-]+", "_", base)
    return (base or "asset")[:200]


def _is_remote_target(target: str) -> bool:
    value = (target or "").strip().lower()
    return value.startswith(("http://", "https://", "data:", "mailto:"))


def _decode_base64_payload(raw: str) -> bytes:
    text = (raw or "").strip()
    if text.startswith("data:") and "," in text:
        text = text.split(",", 1)[1]
    return base64.b64decode(text)


def _build_media_proxy_url(storage_path: str) -> str:
    encoded = quote((storage_path or "").strip(), safe="")
    return f"/api/media/file-uploads/{encoded}"


def _dedupe_markdown_files(files: list) -> list:
    by_path: dict[str, Any] = {}
    for file in files:
        if not file.path:
            continue
        by_path[file.path] = file
    return [by_path[path] for path in sorted(by_path.keys())]


def _dedupe_assets(assets: list[VaultAssetFile]) -> list[VaultAssetFile]:
    by_path: dict[str, VaultAssetFile] = {}
    for asset in assets:
        if not asset.path:
            continue
        by_path[asset.path] = asset
    return [by_path[path] for path in sorted(by_path.keys())]


class ObsidianImportService:
    def __init__(
        self,
        docs_service: Optional[DocsService] = None,
        references_service: Optional[ReferencesService] = None,
    ):
        self.docs_service = docs_service or DocsService()
        self.references_service = references_service or ReferencesService()

    async def _get_client(self):
        db = DBConnection()
        return await db.client

    def _collect_upload_payload(self, payload: dict[str, Any]) -> tuple[list[Any], list[VaultAssetFile]]:
        files = parse_files_payload(payload.get("files"))
        assets = parse_assets_payload(payload.get("assets"))

        zip_base64 = payload.get("zipBase64")
        if zip_base64:
            zip_files, zip_assets = parse_zip_payload(str(zip_base64))
            files.extend(zip_files)
            assets.extend(zip_assets)

        return _dedupe_markdown_files(files), _dedupe_assets(assets)

    async def _upload_asset_files(
        self,
        *,
        client,
        workspace_id: str,
        user_id: str,
        assets: list[VaultAssetFile],
    ) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
        if not assets:
            return {}, []

        try:
            r2_client = get_r2_client()
            bucket = get_r2_bucket()
        except Exception as exc:
            return {}, [
                {
                    "path": normalize_resource_key(asset.path),
                    "reason": "storage_unavailable",
                    "message": str(exc),
                }
                for asset in assets
                if normalize_resource_key(asset.path)
            ]

        now = datetime.now(timezone.utc)
        uploaded: dict[str, dict[str, Any]] = {}
        errors: list[dict[str, Any]] = []

        for asset in assets:
            path = normalize_resource_key(asset.path)
            if not path:
                continue

            try:
                blob = _decode_base64_payload(asset.content_base64)
            except Exception as exc:
                errors.append({"path": path, "reason": "invalid_base64", "message": str(exc)})
                continue

            if not blob:
                errors.append({"path": path, "reason": "empty_asset"})
                continue

            file_id = str(uuid.uuid4())
            safe_name = _sanitize_filename(asset.original_filename or PurePosixPath(path).name)
            storage_key = f"{workspace_id}/obsidian-import/{now:%Y/%m/%d}/{file_id}-{safe_name}"
            content_type = (asset.content_type or "application/octet-stream").strip() or "application/octet-stream"

            try:
                await asyncio.to_thread(
                    r2_client.put_object,
                    Bucket=bucket,
                    Key=storage_key,
                    Body=blob,
                    ContentType=content_type,
                )
            except Exception as exc:
                errors.append({"path": path, "reason": "upload_failed", "message": str(exc)})
                continue

            row = {
                "id": file_id,
                "account_id": workspace_id,
                "user_id": user_id,
                "bucket_name": "file-uploads",
                "storage_provider": "r2",
                "storage_bucket": bucket,
                "storage_path": storage_key,
                "original_filename": safe_name,
                "file_size": len(blob),
                "content_type": content_type,
                "status": "uploaded",
                "source": "obsidian-import",
                "upload_method": "put",
                "metadata": {
                    "obsidianPath": path,
                    "importedBy": "obsidian-import",
                },
            }

            try:
                await client.table("file_uploads").insert(row).execute()
            except Exception as exc:
                errors.append({"path": path, "reason": "db_insert_failed", "message": str(exc)})
                continue

            uploaded[path] = {
                "fileId": file_id,
                "storagePath": storage_key,
                "contentType": content_type,
                "originalFilename": safe_name,
                "size": len(blob),
            }

        return uploaded, errors

    def _rewrite_markdown_image_links(
        self,
        *,
        source_doc_path: str,
        content_md: str,
        asset_path_to_file: dict[str, dict[str, Any]],
        unresolved_assets: list[dict[str, Any]],
    ) -> tuple[str, set[str]]:
        linked_file_ids: set[str] = set()

        def _replace(match: re.Match[str]) -> str:
            alt_text = (match.group(1) or "").replace("]", "")
            raw_target = (match.group(2) or "").strip()
            if not raw_target or _is_remote_target(raw_target):
                return match.group(0)

            resolved_asset_path = resolve_asset_target(
                source_doc_path=source_doc_path,
                target_asset=raw_target,
                asset_path_to_file=asset_path_to_file,
            )
            if not resolved_asset_path:
                unresolved_assets.append(
                    {
                        "path": source_doc_path,
                        "asset": raw_target,
                        "reason": "asset_not_found",
                    }
                )
                return match.group(0)

            asset_row = asset_path_to_file.get(resolved_asset_path) or {}
            storage_path = str(asset_row.get("storagePath") or "")
            file_id = str(asset_row.get("fileId") or "")
            if not storage_path:
                unresolved_assets.append(
                    {
                        "path": source_doc_path,
                        "asset": raw_target,
                        "reason": "asset_missing_storage_path",
                    }
                )
                return match.group(0)

            if file_id:
                linked_file_ids.add(file_id)
            return f"![{alt_text}]({_build_media_proxy_url(storage_path)})"

        rewritten = MARKDOWN_IMAGE_PATTERN.sub(_replace, content_md or "")
        return rewritten, linked_file_ids

    def _rewrite_embed_asset_links(
        self,
        *,
        source_doc_path: str,
        content_md: str,
        asset_path_to_file: dict[str, dict[str, Any]],
        unresolved_assets: list[dict[str, Any]],
    ) -> tuple[str, set[str]]:
        linked_file_ids: set[str] = set()

        def _replace(match: re.Match[str]) -> str:
            raw = (match.group(1) or "").strip()
            if not raw:
                return match.group(0)

            if "|" in raw:
                core, alias = raw.split("|", 1)
            else:
                core, alias = raw, None
            core = core.strip()
            alias_text = (alias or "").strip()

            if _is_markdown_target(core):
                return match.group(0)

            resolved_asset_path = resolve_asset_target(
                source_doc_path=source_doc_path,
                target_asset=core,
                asset_path_to_file=asset_path_to_file,
            )
            if not resolved_asset_path:
                unresolved_assets.append(
                    {
                        "path": source_doc_path,
                        "asset": core,
                        "reason": "embed_asset_not_found",
                    }
                )
                return match.group(0)

            asset_row = asset_path_to_file.get(resolved_asset_path) or {}
            storage_path = str(asset_row.get("storagePath") or "")
            file_id = str(asset_row.get("fileId") or "")
            if not storage_path:
                unresolved_assets.append(
                    {
                        "path": source_doc_path,
                        "asset": core,
                        "reason": "embed_asset_missing_storage_path",
                    }
                )
                return match.group(0)

            if file_id:
                linked_file_ids.add(file_id)

            default_alt = PurePosixPath(core).name or "image"
            alt_text = (alias_text or default_alt).replace("]", "")
            return f"![{alt_text}]({_build_media_proxy_url(storage_path)})"

        rewritten = EMBED_LINK_PATTERN.sub(_replace, content_md or "")
        return rewritten, linked_file_ids

    def _rewrite_doc_content_for_assets(
        self,
        *,
        source_doc_path: str,
        content_md: str,
        asset_path_to_file: dict[str, dict[str, Any]],
        unresolved_assets: list[dict[str, Any]],
    ) -> tuple[str, set[str]]:
        if not asset_path_to_file:
            return content_md or "", set()

        rewritten, linked_from_images = self._rewrite_markdown_image_links(
            source_doc_path=source_doc_path,
            content_md=content_md,
            asset_path_to_file=asset_path_to_file,
            unresolved_assets=unresolved_assets,
        )
        rewritten, linked_from_embeds = self._rewrite_embed_asset_links(
            source_doc_path=source_doc_path,
            content_md=rewritten,
            asset_path_to_file=asset_path_to_file,
            unresolved_assets=unresolved_assets,
        )
        linked = set(linked_from_images)
        linked.update(linked_from_embeds)
        return rewritten, linked

    async def create_job(self, *, workspace_id: str, user_id: str, source_type: str) -> dict[str, Any]:
        client = await self._get_client()
        now = _now_iso()
        job_id = f"obs_imp_{uuid.uuid4().hex}"
        row = {
            "id": job_id,
            "account_id": workspace_id,
            "created_by": user_id,
            "source_type": source_type,
            "status": "pending",
            "progress": 0,
            "stats": _default_stats(),
            "uploaded_payload": {},
            "report": {},
            "created_at": now,
            "updated_at": now,
        }
        result = await client.table("obsidian_import_jobs").insert(row).execute()
        return (result.data or [row])[0]

    async def upload_payload(
        self,
        *,
        workspace_id: str,
        user_id: str,
        job_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        client = await self._get_client()
        job = await self.get_job(workspace_id=workspace_id, job_id=job_id)
        if job.get("status") in {"completed", "running"}:
            raise HTTPException(status_code=409, detail="Job cannot accept upload in current state")

        try:
            files, assets = self._collect_upload_payload(payload)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid import payload: {exc}")

        uploaded_assets, upload_errors = await self._upload_asset_files(
            client=client,
            workspace_id=workspace_id,
            user_id=user_id,
            assets=assets,
        )

        existing_payload = job.get("uploaded_payload") or {}
        existing_assets_raw = existing_payload.get("assets") or {}
        existing_assets: dict[str, dict[str, Any]] = {}
        if isinstance(existing_assets_raw, dict):
            for raw_path, value in existing_assets_raw.items():
                normalized = normalize_resource_key(str(raw_path or ""))
                if normalized and isinstance(value, dict):
                    existing_assets[normalized] = value

        asset_path_to_file = dict(existing_assets)
        asset_path_to_file.update(uploaded_assets)

        sanitized_payload = {
            "files": [{"path": file.path, "content": file.content} for file in files],
            "assets": asset_path_to_file,
        }
        stats = job.get("stats") or _default_stats()
        stats["total_files"] = len(files)
        stats["imported_assets"] = len(asset_path_to_file)

        report = job.get("report") or {}
        previous_upload_errors = report.get("assetUploadErrors") or []
        if not isinstance(previous_upload_errors, list):
            previous_upload_errors = []
        report["assetUploadErrors"] = previous_upload_errors + upload_errors

        update = {
            "uploaded_payload": sanitized_payload,
            "stats": stats,
            "report": report,
            "status": "pending",
            "progress": 20 if files or asset_path_to_file else 0,
            "updated_at": _now_iso(),
        }
        result = (
            await client.table("obsidian_import_jobs")
            .update(update)
            .eq("account_id", workspace_id)
            .eq("id", job_id)
            .execute()
        )
        return (result.data or [dict(job, **update)])[0]

    async def commit_job(self, *, workspace_id: str, user_id: str, job_id: str) -> dict[str, Any]:
        client = await self._get_client()
        job = await self.get_job(workspace_id=workspace_id, job_id=job_id)
        if job.get("status") == "completed":
            return job

        payload = job.get("uploaded_payload") or {}
        files = parse_files_payload(payload.get("files"))
        if not files:
            raise HTTPException(status_code=400, detail="No markdown files uploaded")

        asset_path_to_file: dict[str, dict[str, Any]] = {}
        raw_assets = payload.get("assets") or {}
        if isinstance(raw_assets, dict):
            for raw_path, row in raw_assets.items():
                normalized = normalize_resource_key(str(raw_path or ""))
                if normalized and isinstance(row, dict):
                    asset_path_to_file[normalized] = row

        await client.table("obsidian_import_jobs").update(
            {"status": "running", "progress": 35, "updated_at": _now_iso()}
        ).eq("account_id", workspace_id).eq("id", job_id).execute()

        stats = _default_stats()
        stats["total_files"] = len(files)
        stats["imported_assets"] = len(asset_path_to_file)

        unresolved_links: list[dict[str, Any]] = []
        unresolved_assets: list[dict[str, Any]] = []
        report = job.get("report") or {}
        asset_upload_errors = report.get("assetUploadErrors") or []

        path_to_item_id: dict[str, str] = report.get("pathToItemId") or {}
        created_refs_seen: set[str] = set()
        linked_file_ids_by_doc_path: dict[str, set[str]] = {}

        for file in files:
            rewritten_content, linked_file_ids = self._rewrite_doc_content_for_assets(
                source_doc_path=file.path,
                content_md=file.content,
                asset_path_to_file=asset_path_to_file,
                unresolved_assets=unresolved_assets,
            )
            linked_file_ids_by_doc_path[file.path] = linked_file_ids

            if file.path in path_to_item_id:
                continue
            try:
                created = await self.docs_service.create_doc(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    payload=CreateDocRequest(
                        title=file_name_to_title(file.path),
                        contentMd=rewritten_content,
                        frontmatter={"obsidianPath": file.path},
                    ),
                )
                path_to_item_id[file.path] = created.itemId
                stats["imported_docs"] += 1
            except Exception as exc:
                logger.warning(f"[obsidian] failed to import file path={file.path}: {exc}")
                stats["failed_files"] += 1

        await client.table("obsidian_import_jobs").update(
            {"progress": 70, "updated_at": _now_iso(), "stats": stats}
        ).eq("account_id", workspace_id).eq("id", job_id).execute()

        for source_path, linked_file_ids in linked_file_ids_by_doc_path.items():
            source_item_id = path_to_item_id.get(source_path)
            if not source_item_id:
                continue
            for file_id in sorted(linked_file_ids):
                try:
                    await client.table("file_links").upsert(
                        {
                            "file_id": file_id,
                            "entity_type": "doc",
                            "entity_id": source_item_id,
                        },
                        on_conflict="file_id,entity_type,entity_id",
                    ).execute()
                except Exception as exc:
                    logger.warning(
                        f"[obsidian] failed to link imported asset file={file_id} doc={source_item_id}: {exc}"
                    )

        for file in files:
            source_item_id = path_to_item_id.get(file.path)
            if not source_item_id:
                continue

            refs = list(parse_wikilinks(file.content))
            for embed_ref in parse_embed_links(file.content):
                if _is_markdown_target(embed_ref.target_note):
                    refs.append(embed_ref)

            for link_ref in refs:
                target_path = resolve_note_target(
                    source_doc_path=file.path,
                    target_note=link_ref.target_note,
                    path_to_item_id=path_to_item_id,
                )
                if not target_path:
                    unresolved_links.append(
                        {
                            "sourcePath": file.path,
                            "raw": link_ref.raw,
                            "reason": "target_not_found",
                        }
                    )
                    continue
                target_item_id = path_to_item_id.get(target_path)
                if not target_item_id:
                    unresolved_links.append(
                        {
                            "sourcePath": file.path,
                            "raw": link_ref.raw,
                            "reason": "target_missing_item",
                        }
                    )
                    continue

                dedupe_key = f"{source_item_id}:{target_item_id}:{link_ref.target_anchor}:{link_ref.target_block}"
                if dedupe_key in created_refs_seen:
                    continue
                created_refs_seen.add(dedupe_key)

                try:
                    await self.references_service.create_reference(
                        workspace_id=workspace_id,
                        user_id=user_id,
                        payload=CreateReferenceRequest(
                            sourceType="doc_block",
                            sourceItemId=source_item_id,
                            sourceAnchor=None,
                            targetType="doc" if not link_ref.target_anchor and not link_ref.target_block else "doc_block",
                            targetItemId=target_item_id,
                            targetAnchor=link_ref.target_anchor or link_ref.target_block,
                            mode="reference",
                        ),
                    )
                    stats["created_references"] += 1
                except Exception as exc:
                    logger.warning(
                        f"[obsidian] failed to create reference source={source_item_id} target={target_item_id}: {exc}"
                    )

        stats["unresolved_links"] = len(unresolved_links)

        status = "completed"
        if unresolved_links or unresolved_assets or stats["failed_files"] > 0:
            status = "partially_completed"

        final_report = {
            "pathToItemId": path_to_item_id,
            "assetPathToFile": asset_path_to_file,
            "unresolvedLinks": unresolved_links,
            "unresolvedAssets": unresolved_assets,
            "assetUploadErrors": asset_upload_errors,
            "summary": stats,
        }
        update = {
            "status": status,
            "progress": 100,
            "stats": stats,
            "report": final_report,
            "updated_at": _now_iso(),
            "completed_at": _now_iso(),
        }
        result = (
            await client.table("obsidian_import_jobs")
            .update(update)
            .eq("account_id", workspace_id)
            .eq("id", job_id)
            .execute()
        )
        return (result.data or [dict(job, **update)])[0]

    async def get_job(self, *, workspace_id: str, job_id: str) -> dict[str, Any]:
        client = await self._get_client()
        result = (
            await client.table("obsidian_import_jobs")
            .select("*")
            .eq("account_id", workspace_id)
            .eq("id", job_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Import job not found")
        return result.data[0]

    async def get_report(self, *, workspace_id: str, job_id: str) -> dict[str, Any]:
        job = await self.get_job(workspace_id=workspace_id, job_id=job_id)
        return job.get("report") or {}
