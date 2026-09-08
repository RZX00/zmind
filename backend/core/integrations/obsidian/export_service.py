from __future__ import annotations

import asyncio
import base64
from datetime import datetime, timezone
from io import BytesIO
import posixpath
from pathlib import PurePosixPath
import re
from typing import Any
from urllib.parse import unquote, urlparse
import uuid
from zipfile import ZipFile, ZIP_DEFLATED

from fastapi import HTTPException

from core.services.r2_storage import get_object_bytes
from core.services.supabase import DBConnection
from core.utils.logger import logger


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_file_name(name: str) -> str:
    base = (name or "").strip().replace("\\", "/").replace("..", "").strip("/")
    if not base:
        base = "Untitled.md"
    if not base.lower().endswith(".md"):
        base = f"{base}.md"
    return str(PurePosixPath(base))


def _safe_asset_path(name: str) -> str:
    text = (name or "").strip().replace("\\", "/").replace("..", "").strip("/")
    if not text:
        text = "assets/asset.bin"
    path = str(PurePosixPath(text))
    if path == ".":
        return "assets/asset.bin"
    return path


def _extract_storage_path_from_media_url(raw_url: str) -> str | None:
    target = (raw_url or "").strip()
    if not target:
        return None

    markers = ("/api/media/file-uploads/", "/media/file-uploads/")

    for marker in markers:
        idx = target.find(marker)
        if idx != -1:
            value = target[idx + len(marker) :]
            value = value.split("?", 1)[0]
            return unquote(value.lstrip("/")) if value else None

    try:
        parsed = urlparse(target)
    except Exception:
        return None

    path = parsed.path or ""
    for marker in markers:
        idx = path.find(marker)
        if idx != -1:
            value = path[idx + len(marker) :]
            return unquote(value.lstrip("/")) if value else None

    return None


IMAGE_LINK_PATTERN = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


class ObsidianExportService:
    async def _get_client(self):
        db = DBConnection()
        return await db.client

    def _collect_storage_paths_from_markdown(self, markdown: str) -> set[str]:
        paths: set[str] = set()
        for match in IMAGE_LINK_PATTERN.finditer(markdown or ""):
            target = (match.group(2) or "").strip()
            storage_path = _extract_storage_path_from_media_url(target)
            if storage_path:
                paths.add(storage_path)
        return paths

    def _relative_asset_path(self, *, doc_path: str, asset_path: str) -> str:
        doc_parent = str(PurePosixPath(doc_path).parent)
        if not doc_parent or doc_parent == ".":
            return asset_path
        return posixpath.relpath(asset_path, start=doc_parent)

    def _rewrite_doc_images_for_export(
        self,
        *,
        markdown: str,
        doc_path: str,
        storage_to_asset_path: dict[str, str],
        unresolved_assets: list[dict[str, Any]],
    ) -> str:
        def _replace(match: re.Match[str]) -> str:
            alt_text = (match.group(1) or "").replace("]", "")
            raw_target = (match.group(2) or "").strip()
            storage_path = _extract_storage_path_from_media_url(raw_target)
            if not storage_path:
                return match.group(0)

            asset_path = storage_to_asset_path.get(storage_path)
            if not asset_path:
                unresolved_assets.append(
                    {
                        "storagePath": storage_path,
                        "reason": "asset_missing_in_export_map",
                    }
                )
                return match.group(0)

            rel = self._relative_asset_path(doc_path=doc_path, asset_path=asset_path)
            return f"![{alt_text}]({rel})"

        return IMAGE_LINK_PATTERN.sub(_replace, markdown or "")

    async def create_job(
        self,
        *,
        workspace_id: str,
        user_id: str,
        scope_type: str,
        scope_id: str | None = None,
    ) -> dict[str, Any]:
        client = await self._get_client()
        now = _now_iso()
        job_id = f"obs_exp_{uuid.uuid4().hex}"
        row = {
            "id": job_id,
            "account_id": workspace_id,
            "created_by": user_id,
            "scope_type": scope_type,
            "scope_id": scope_id,
            "status": "pending",
            "progress": 0,
            "stats": {},
            "report": {},
            "created_at": now,
            "updated_at": now,
        }
        result = await client.table("obsidian_export_jobs").insert(row).execute()
        created = (result.data or [row])[0]
        return await self.run_export(workspace_id=workspace_id, job_id=created["id"])

    async def run_export(self, *, workspace_id: str, job_id: str) -> dict[str, Any]:
        client = await self._get_client()
        job = await self.get_job(workspace_id=workspace_id, job_id=job_id)

        await client.table("obsidian_export_jobs").update(
            {"status": "running", "progress": 20, "updated_at": _now_iso()}
        ).eq("account_id", workspace_id).eq("id", job_id).execute()

        try:
            items_query = (
                client.table("items")
                .select("id,title,folder_id")
                .eq("account_id", workspace_id)
                .eq("type", "doc")
                .eq("is_deleted", False)
            )
            if job.get("scope_type") == "folder" and job.get("scope_id"):
                items_query = items_query.eq("folder_id", job.get("scope_id"))
            items_res = await items_query.execute()
            items = items_res.data or []
            item_ids = [row.get("id") for row in items if row.get("id")]

            docs_rows: list[dict[str, Any]] = []
            for idx in range(0, len(item_ids), 200):
                chunk = item_ids[idx : idx + 200]
                docs_res = (
                    await client.table("docs")
                    .select("item_id,content_md,frontmatter,updated_at")
                    .in_("item_id", chunk)
                    .execute()
                )
                docs_rows.extend(docs_res.data or [])

            docs_by_item = {row.get("item_id"): row for row in docs_rows}
            used_paths: set[str] = set()
            exported_doc_paths: list[str] = []
            docs_to_export: list[dict[str, Any]] = []
            required_storage_paths: set[str] = set()

            for item in items:
                item_id = item.get("id")
                if not item_id:
                    continue

                doc_row = docs_by_item.get(item_id) or {}
                content = str(doc_row.get("content_md") or "")
                frontmatter = doc_row.get("frontmatter") or {}
                preferred_path = None
                if isinstance(frontmatter, dict):
                    preferred_path = frontmatter.get("obsidianPath")

                if preferred_path:
                    normalized_path = _safe_file_name(str(preferred_path))
                else:
                    normalized_path = _safe_file_name(str(item.get("title") or "Untitled"))

                candidate_path = normalized_path
                suffix = 1
                while candidate_path in used_paths:
                    base = PurePosixPath(normalized_path)
                    candidate_path = str(base.with_name(f"{base.stem}-{suffix}{base.suffix}"))
                    suffix += 1
                used_paths.add(candidate_path)

                docs_to_export.append(
                    {
                        "itemId": item_id,
                        "path": candidate_path,
                        "content": content,
                    }
                )
                exported_doc_paths.append(candidate_path)
                required_storage_paths.update(self._collect_storage_paths_from_markdown(content))

            file_rows: dict[str, dict[str, Any]] = {}
            required_list = sorted(required_storage_paths)
            for idx in range(0, len(required_list), 200):
                chunk = required_list[idx : idx + 200]
                if not chunk:
                    continue
                files_res = (
                    await client.table("file_uploads")
                    .select("id,storage_path,original_filename,content_type,metadata")
                    .eq("account_id", workspace_id)
                    .in_("storage_path", chunk)
                    .is_("deleted_at", "null")
                    .execute()
                )
                for row in files_res.data or []:
                    sp = row.get("storage_path")
                    if sp:
                        file_rows[str(sp)] = row

            storage_to_asset_path: dict[str, str] = {}
            unresolved_assets: list[dict[str, Any]] = []

            for storage_path in required_list:
                row = file_rows.get(storage_path)
                if not row:
                    unresolved_assets.append(
                        {
                            "storagePath": storage_path,
                            "reason": "asset_row_not_found",
                        }
                    )
                    continue

                metadata = row.get("metadata") or {}
                if isinstance(metadata, str):
                    metadata = {}
                preferred_asset_path = None
                if isinstance(metadata, dict):
                    raw_obsidian_path = metadata.get("obsidianPath")
                    if isinstance(raw_obsidian_path, str) and raw_obsidian_path.strip():
                        preferred_asset_path = raw_obsidian_path

                if not preferred_asset_path:
                    name = str(row.get("original_filename") or PurePosixPath(storage_path).name or "asset.bin")
                    preferred_asset_path = f"assets/{name}"

                candidate = _safe_asset_path(preferred_asset_path)
                if candidate.lower().endswith(".md"):
                    name = str(row.get("original_filename") or "asset.bin")
                    candidate = _safe_asset_path(f"assets/{name}")

                suffix = 1
                while candidate in used_paths:
                    p = PurePosixPath(candidate)
                    candidate = str(p.with_name(f"{p.stem}-{suffix}{p.suffix}"))
                    suffix += 1
                used_paths.add(candidate)
                storage_to_asset_path[storage_path] = candidate

            asset_bytes_by_storage: dict[str, bytes] = {}
            available_storage_to_asset: dict[str, str] = {}
            exported_asset_paths: list[str] = []

            for storage_path, asset_path in sorted(storage_to_asset_path.items()):
                try:
                    payload = await asyncio.to_thread(get_object_bytes, storage_path)
                except Exception as exc:
                    unresolved_assets.append(
                        {
                            "storagePath": storage_path,
                            "assetPath": asset_path,
                            "reason": "asset_download_failed",
                            "message": str(exc),
                        }
                    )
                    continue
                if payload is None:
                    unresolved_assets.append(
                        {
                            "storagePath": storage_path,
                            "assetPath": asset_path,
                            "reason": "asset_payload_empty",
                        }
                    )
                    continue
                asset_bytes_by_storage[storage_path] = payload
                available_storage_to_asset[storage_path] = asset_path
                exported_asset_paths.append(asset_path)

            buffer = BytesIO()
            with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as archive:
                for doc in docs_to_export:
                    rewritten = self._rewrite_doc_images_for_export(
                        markdown=str(doc.get("content") or ""),
                        doc_path=str(doc.get("path") or "Untitled.md"),
                        storage_to_asset_path=available_storage_to_asset,
                        unresolved_assets=unresolved_assets,
                    )
                    archive.writestr(str(doc.get("path") or "Untitled.md"), rewritten)

                for storage_path, payload in sorted(asset_bytes_by_storage.items()):
                    asset_path = available_storage_to_asset.get(storage_path)
                    if not asset_path:
                        continue
                    archive.writestr(asset_path, payload)

            package_bytes = buffer.getvalue()
            package_base64 = base64.b64encode(package_bytes).decode("utf-8")
            stats = {
                "exported_docs": len(exported_doc_paths),
                "exported_assets": len(exported_asset_paths),
                "unresolved_assets": len(unresolved_assets),
                "archive_size_bytes": len(package_bytes),
            }
            report = {
                "files": exported_doc_paths,
                "assetFiles": exported_asset_paths,
                "unresolvedAssets": unresolved_assets,
                "generatedAt": _now_iso(),
                "stats": stats,
            }
            update = {
                "status": "completed",
                "progress": 100,
                "stats": stats,
                "report": report,
                "package_base64": package_base64,
                "updated_at": _now_iso(),
                "completed_at": _now_iso(),
            }
            result = (
                await client.table("obsidian_export_jobs")
                .update(update)
                .eq("account_id", workspace_id)
                .eq("id", job_id)
                .execute()
            )
            return (result.data or [dict(job, **update)])[0]
        except Exception as exc:
            logger.error(f"[obsidian] export failed workspace={workspace_id} job={job_id}: {exc}")
            update = {
                "status": "failed",
                "progress": 100,
                "error_message": str(exc),
                "updated_at": _now_iso(),
                "completed_at": _now_iso(),
            }
            result = (
                await client.table("obsidian_export_jobs")
                .update(update)
                .eq("account_id", workspace_id)
                .eq("id", job_id)
                .execute()
            )
            row = (result.data or [dict(job, **update)])[0]
            raise HTTPException(status_code=500, detail={"message": "Export failed", "job": row})

    async def get_job(self, *, workspace_id: str, job_id: str) -> dict[str, Any]:
        client = await self._get_client()
        result = (
            await client.table("obsidian_export_jobs")
            .select("*")
            .eq("account_id", workspace_id)
            .eq("id", job_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Export job not found")
        return result.data[0]

    async def get_download_bytes(self, *, workspace_id: str, job_id: str) -> bytes:
        job = await self.get_job(workspace_id=workspace_id, job_id=job_id)
        package_base64 = job.get("package_base64")
        if not package_base64:
            raise HTTPException(status_code=409, detail="Export package is not ready")
        try:
            return base64.b64decode(package_base64)
        except Exception as exc:
            logger.error(f"[obsidian] invalid package payload job={job_id}: {exc}")
            raise HTTPException(status_code=500, detail="Invalid export package payload")
