from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import HTTPException

from core.docs.agent_context import normalize_doc_context_payload
from core.docs.api_models import ApplyDocOpsRequest, UndoDocRevisionRequest
from core.docs.service import DocsService
from core.media.generation_service import MediaGenerationRequest, MediaGenerationService
from core.media.signature_utils import build_signed_doc_media_url
from core.services.supabase import DBConnection
from core.tools.base import Tool, ToolResult
from core.utils.logger import logger


def _normalize_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _format_http_detail(detail: Any) -> str:
    if isinstance(detail, str):
        return detail
    try:
        return json.dumps(detail, ensure_ascii=False)
    except Exception:
        return str(detail)


class DocToolAccessError(Exception):
    pass


def _normalize_optional_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except Exception:
        return None


def _escape_markdown_alt_text(value: str) -> str:
    return str(value or "").replace("\n", " ").replace("]", r"\]").strip()


def _extract_conflict_current_version(detail: Any) -> Optional[int]:
    if isinstance(detail, dict):
        return _normalize_optional_int(detail.get("currentVersion") or detail.get("current_version"))
    if isinstance(detail, str):
        text = detail.strip()
        if not text:
            return None
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return _normalize_optional_int(parsed.get("currentVersion") or parsed.get("current_version"))
        except Exception:
            return None
    return None


class DocAgentTool(Tool):
    def __init__(
        self,
        *,
        thread_id: str,
        account_id: str,
        db_connection: Optional[DBConnection] = None,
        doc_item_id: Optional[str] = None,
        doc_context: Optional[dict[str, Any]] = None,
        agent_run_id: Optional[str] = None,
        docs_service: Optional[DocsService] = None,
        media_service: Optional[MediaGenerationService] = None,
    ) -> None:
        super().__init__()
        self.thread_id = str(thread_id)
        self.account_id = str(account_id)
        self.db = db_connection or DBConnection()
        self.doc_item_id = _normalize_optional_text(doc_item_id)
        self.doc_context = doc_context if isinstance(doc_context, dict) else None
        self.agent_run_id = _normalize_optional_text(agent_run_id)
        self.docs_service = docs_service or DocsService()
        self.media_service = media_service or MediaGenerationService()
        self._resolved_doc_item_id: Optional[str] = None

    async def _get_client(self):
        return await self.db.client

    def _doc_item_id_from_local_context(self) -> Optional[str]:
        if self.doc_item_id:
            return self.doc_item_id
        if isinstance(self.doc_context, dict):
            return _normalize_optional_text(self.doc_context.get("doc_item_id"))
        return None

    async def _discover_doc_context(self) -> Optional[dict[str, Any]]:
        # 1) Prefer explicitly provided context.
        if isinstance(self.doc_context, dict):
            normalized, _warnings = normalize_doc_context_payload(self.doc_context)
            if isinstance(normalized, dict):
                self.doc_context = normalized
                return normalized

        client = await self._get_client()

        # 2) Thread metadata.
        try:
            thread_row = (
                await client.table("threads")
                .select("metadata")
                .eq("thread_id", self.thread_id)
                .eq("account_id", self.account_id)
                .limit(1)
                .execute()
            )
            if thread_row.data:
                normalized, _warnings = normalize_doc_context_payload(thread_row.data[0].get("metadata"))
                if isinstance(normalized, dict):
                    self.doc_context = normalized
                    return normalized
        except Exception as exc:
            logger.debug("DocAgentTool: failed to read thread doc context", error=str(exc), thread_id=self.thread_id)

        # 3) Latest user message metadata fallback.
        try:
            latest_message = (
                await client.table("messages")
                .select("metadata")
                .eq("thread_id", self.thread_id)
                .eq("type", "user")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if latest_message.data:
                normalized, _warnings = normalize_doc_context_payload(latest_message.data[0].get("metadata"))
                if isinstance(normalized, dict):
                    self.doc_context = normalized
                    return normalized
        except Exception as exc:
            logger.debug("DocAgentTool: failed to read latest message doc context", error=str(exc), thread_id=self.thread_id)

        return None

    async def _resolve_doc_item_id(self, requested_doc_item_id: Optional[str]) -> str:
        requested = _normalize_optional_text(requested_doc_item_id)
        bound = _normalize_optional_text(self._resolved_doc_item_id) or self._doc_item_id_from_local_context()
        if not bound:
            discovered = await self._discover_doc_context()
            if isinstance(discovered, dict):
                bound = _normalize_optional_text(discovered.get("doc_item_id"))
        if bound:
            self._resolved_doc_item_id = bound
        if requested and bound and requested != bound:
            raise DocToolAccessError(
                f"doc_acl_denied: doc_item_id '{requested}' does not match bound doc '{bound}' for this thread"
            )
        resolved = requested or bound
        if not resolved:
            raise DocToolAccessError("doc_context_missing_doc_item_id")
        return resolved

    async def doc_read_context(
        self,
        *,
        doc_item_id: Optional[str] = None,
        include_content: bool = True,
        max_chars: int = 12_000,
    ) -> ToolResult:
        try:
            resolved_doc_item_id = await self._resolve_doc_item_id(doc_item_id)
            doc = await self.docs_service.get_doc(
                workspace_id=self.account_id,
                item_id=resolved_doc_item_id,
            )
            bounded_chars = max(500, min(50_000, int(max_chars or 12_000)))
            content_md = doc.contentMd if include_content else ""
            truncated = False
            if include_content and len(content_md) > bounded_chars:
                content_md = content_md[:bounded_chars]
                truncated = True
            payload: dict[str, Any] = {
                "docItemId": doc.itemId,
                "title": doc.title,
                "version": doc.version,
                "updatedAt": doc.updatedAt,
                "frontmatter": doc.frontmatter,
                "contentMd": content_md,
                "contentTruncated": truncated,
            }
            if isinstance(self.doc_context, dict):
                payload["docContext"] = self.doc_context
            return self.success_response(payload)
        except DocToolAccessError as exc:
            return self.fail_response(str(exc))
        except HTTPException as exc:
            return self.fail_response(f"doc_read_context_http_{exc.status_code}: {_format_http_detail(exc.detail)}")
        except Exception as exc:
            logger.exception("DocAgentTool.doc_read_context failed")
            return self.fail_response(f"doc_read_context_error:{type(exc).__name__}:{str(exc)[:300]}")

    async def doc_list_blocks(
        self,
        *,
        doc_item_id: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> ToolResult:
        try:
            resolved_doc_item_id = await self._resolve_doc_item_id(doc_item_id)
            all_blocks = await self.docs_service.list_doc_blocks(
                workspace_id=self.account_id,
                item_id=resolved_doc_item_id,
            )
            bounded_limit = max(1, min(500, int(limit or 200)))
            bounded_offset = max(0, int(offset or 0))
            sliced = all_blocks[bounded_offset : bounded_offset + bounded_limit]
            return self.success_response(
                {
                    "docItemId": resolved_doc_item_id,
                    "total": len(all_blocks),
                    "offset": bounded_offset,
                    "limit": bounded_limit,
                    "blocks": [block.model_dump() for block in sliced],
                }
            )
        except DocToolAccessError as exc:
            return self.fail_response(str(exc))
        except HTTPException as exc:
            return self.fail_response(f"doc_list_blocks_http_{exc.status_code}: {_format_http_detail(exc.detail)}")
        except Exception as exc:
            logger.exception("DocAgentTool.doc_list_blocks failed")
            return self.fail_response(f"doc_list_blocks_error:{type(exc).__name__}:{str(exc)[:300]}")

    async def doc_apply_ops(
        self,
        *,
        base_version: int,
        ops: list[dict[str, Any]],
        doc_item_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        summary: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> ToolResult:
        try:
            resolved_doc_item_id = await self._resolve_doc_item_id(doc_item_id)
            normalized_ops = await self._normalize_doc_ops(
                doc_item_id=resolved_doc_item_id,
                ops=ops or [],
            )
            payload = ApplyDocOpsRequest(
                baseVersion=int(base_version),
                idempotencyKey=_normalize_optional_text(idempotency_key),
                summary=_normalize_optional_text(summary) or "Apply doc ops via agent tool",
                ops=normalized_ops,
                actorType="agent",
                actorId=f"agent:{self.thread_id}",
                agentRunId=self.agent_run_id,
                threadId=self.thread_id,
                metadata=metadata or {},
            )
            client_request_id = _normalize_optional_text(idempotency_key)
            try:
                result = await self.docs_service.apply_doc_ops(
                    workspace_id=self.account_id,
                    user_id=self.account_id,
                    item_id=resolved_doc_item_id,
                    payload=payload,
                    client_request_id=client_request_id,
                )
                return self.success_response(result.model_dump())
            except HTTPException as exc:
                # Agent runs are long-lived. If the doc changed concurrently, retry once against
                # currentVersion to reduce visible write failures in doc mode.
                if exc.status_code != 409:
                    raise
                current_version = _extract_conflict_current_version(exc.detail)
                if current_version is None or current_version == payload.baseVersion:
                    raise
                rebased_payload = payload.model_copy(update={"baseVersion": current_version})
                rebased_result = await self.docs_service.apply_doc_ops(
                    workspace_id=self.account_id,
                    user_id=self.account_id,
                    item_id=resolved_doc_item_id,
                    payload=rebased_payload,
                    client_request_id=client_request_id,
                )
                response = rebased_result.model_dump()
                response["autoRebasedOnConflict"] = True
                response["requestedBaseVersion"] = payload.baseVersion
                response["effectiveBaseVersion"] = current_version
                return self.success_response(response)
        except DocToolAccessError as exc:
            return self.fail_response(str(exc))
        except HTTPException as exc:
            return self.fail_response(f"doc_apply_ops_http_{exc.status_code}: {_format_http_detail(exc.detail)}")
        except Exception as exc:
            logger.exception("DocAgentTool.doc_apply_ops failed")
            return self.fail_response(f"doc_apply_ops_error:{type(exc).__name__}:{str(exc)[:300]}")

    async def _normalize_doc_ops(self, *, doc_item_id: str, ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized_ops: list[dict[str, Any]] = []
        blocks_cache: Optional[list[Any]] = None

        for raw_op in ops:
            if not isinstance(raw_op, dict):
                normalized_ops.append(raw_op)
                continue

            normalized = dict(raw_op)
            if "content_md" in normalized and "contentMd" not in normalized:
                normalized["contentMd"] = normalized.get("content_md")
            if "block_id" in normalized and "blockId" not in normalized:
                normalized["blockId"] = normalized.get("block_id")

            op_type = str(normalized.get("op") or "").strip().lower()
            if op_type in {"insert_after_block", "insert_before_block"} and not _normalize_optional_text(
                normalized.get("blockId")
            ):
                block_index = _normalize_optional_int(normalized.get("position"))
                if block_index is not None and block_index >= 0:
                    if blocks_cache is None:
                        blocks_cache = await self.docs_service.list_doc_blocks(
                            workspace_id=self.account_id,
                            item_id=doc_item_id,
                        )
                    if 0 <= block_index < len(blocks_cache):
                        mapped_block_id = _normalize_optional_text(getattr(blocks_cache[block_index], "blockId", None))
                        if mapped_block_id:
                            normalized["blockId"] = mapped_block_id

            normalized.pop("content_md", None)
            normalized.pop("block_id", None)
            normalized_ops.append(normalized)

        return normalized_ops

    async def _resolve_file_id_for_storage_path(self, *, storage_path: str) -> Optional[str]:
        client = await self._get_client()
        try:
            result = (
                await client.table("file_uploads")
                .select("id")
                .eq("account_id", self.account_id)
                .eq("storage_path", storage_path)
                .limit(1)
                .execute()
            )
            if result.data:
                return _normalize_optional_text(result.data[0].get("id"))
        except Exception as exc:
            logger.warning(
                "DocAgentTool: failed to resolve file id by storage path",
                error=str(exc),
                storage_path=storage_path,
                thread_id=self.thread_id,
            )
        return None

    async def _link_file_to_doc(self, *, file_id: str, doc_item_id: str) -> None:
        client = await self._get_client()
        await (
            client.table("file_links")
            .upsert(
                {
                    "file_id": file_id,
                    "entity_type": "doc",
                    "entity_id": doc_item_id,
                },
                on_conflict="file_id,entity_type,entity_id",
            )
            .execute()
        )

    async def doc_generate_image_and_insert(
        self,
        *,
        prompt: str,
        base_version: Optional[int] = None,
        placement: str = "append",
        block_id: Optional[str] = None,
        position: Optional[int] = None,
        alt_text: Optional[str] = None,
        caption: Optional[str] = None,
        aspect_ratio: str = "1:1",
        quantity: int = 1,
        model: str = "habitat/gpt-image-2",
        reference_image_ids: Optional[list[str]] = None,
        doc_item_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        summary: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
        url_ttl_seconds: int = 604800,
    ) -> ToolResult:
        try:
            normalized_prompt = _normalize_optional_text(prompt)
            if not normalized_prompt:
                return self.fail_response("doc_generate_image_and_insert_validation_error: prompt is required")

            bounded_quantity = int(quantity or 1)
            if bounded_quantity < 1 or bounded_quantity > 10:
                return self.fail_response("doc_generate_image_and_insert_validation_error: quantity must be 1-10")

            normalized_placement = str(placement or "append").strip().lower() or "append"
            allowed_placements = {
                "append",
                "prepend",
                "insert_after_block",
                "insert_before_block",
                "insert_at",
            }
            if normalized_placement not in allowed_placements:
                return self.fail_response(
                    "doc_generate_image_and_insert_validation_error: placement must be one of "
                    "append|prepend|insert_after_block|insert_before_block|insert_at"
                )
            if normalized_placement in {"insert_after_block", "insert_before_block"}:
                if not _normalize_optional_text(block_id):
                    return self.fail_response(
                        "doc_generate_image_and_insert_validation_error: block_id is required for "
                        f"{normalized_placement}"
                    )
            if normalized_placement == "insert_at":
                normalized_position = _normalize_optional_int(position)
                if normalized_position is None or normalized_position < 0:
                    return self.fail_response(
                        "doc_generate_image_and_insert_validation_error: position must be >= 0 for insert_at"
                    )

            resolved_doc_item_id = await self._resolve_doc_item_id(doc_item_id)
            doc = await self.docs_service.get_doc(
                workspace_id=self.account_id,
                item_id=resolved_doc_item_id,
            )
            current_version = int(doc.version or 1)
            requested_base_version = _normalize_optional_int(base_version)
            effective_base_version = requested_base_version if requested_base_version is not None else current_version
            auto_rebased_on_conflict = False
            if requested_base_version is not None and requested_base_version != current_version:
                # Image generation is expensive and agent runs are long-lived; stale base versions
                # should rebase to current doc version instead of hard-failing up-front.
                auto_rebased_on_conflict = True
                effective_base_version = current_version

            normalized_reference_ids = [
                ref
                for ref in (reference_image_ids or [])
                if isinstance(ref, str) and ref.strip()
            ] or None

            request = MediaGenerationRequest(
                prompt=normalized_prompt,
                aspect_ratio=(str(aspect_ratio or "1:1").strip() or "1:1"),
                quantity=bounded_quantity,
                model=(str(model or "").strip() or "habitat/gpt-image-2"),
                reference_image_ids=normalized_reference_ids,
                account_id=self.account_id,
            )
            generated_items = await self.media_service.generate_images(request)
            if not generated_items:
                return self.fail_response("doc_generate_image_and_insert_error: media service returned no images")

            linked_items = []
            for item in generated_items:
                storage_path = _normalize_optional_text(getattr(item, "storage_path", None))
                if not storage_path:
                    continue
                file_id = _normalize_optional_text(getattr(item, "file_id", None))
                if not file_id:
                    file_id = await self._resolve_file_id_for_storage_path(storage_path=storage_path)
                if not file_id:
                    logger.warning(
                        "DocAgentTool: generated image missing file id; skipping",
                        storage_path=storage_path,
                        thread_id=self.thread_id,
                    )
                    continue
                await self._link_file_to_doc(file_id=file_id, doc_item_id=resolved_doc_item_id)
                item.file_id = file_id
                linked_items.append(item)

            if not linked_items:
                return self.fail_response("doc_generate_image_and_insert_error: failed to link generated images")

            ttl = _normalize_optional_int(url_ttl_seconds) or 604800
            ttl = max(300, min(ttl, 604800))
            normalized_alt = _normalize_optional_text(alt_text) or normalized_prompt[:120]
            escaped_alt = _escape_markdown_alt_text(normalized_alt or "Generated image")
            normalized_caption = _normalize_optional_text(caption)

            markdown_parts: list[str] = []
            generated_images_payload: list[dict[str, Any]] = []
            for index, item in enumerate(linked_items):
                storage_path = str(item.storage_path)
                signed_url = build_signed_doc_media_url(
                    storage_path,
                    resolved_doc_item_id,
                    ttl=ttl,
                )
                per_image_alt = escaped_alt
                if len(linked_items) > 1:
                    per_image_alt = f"{escaped_alt} {index + 1}"
                block_md = f"![{per_image_alt}]({signed_url})"
                if normalized_caption:
                    caption_value = normalized_caption
                    if len(linked_items) > 1:
                        caption_value = f"{normalized_caption} ({index + 1})"
                    block_md = f"{block_md}\n\n*{caption_value}*"
                markdown_parts.append(block_md)
                generated_images_payload.append(
                    {
                        "fileId": item.file_id,
                        "storagePath": storage_path,
                        "url": signed_url,
                        "width": int(getattr(item, "width", 0) or 0),
                        "height": int(getattr(item, "height", 0) or 0),
                        "mimeType": getattr(item, "mime_type", None),
                        "byteSize": int(getattr(item, "byte_size", 0) or 0),
                    }
                )

            inserted_markdown = "\n\n".join(markdown_parts).strip()
            if not inserted_markdown:
                return self.fail_response("doc_generate_image_and_insert_error: generated markdown is empty")

            op: dict[str, Any]
            if normalized_placement == "append":
                op = {
                    "op": "insert_at",
                    "position": len(doc.contentMd or ""),
                    "contentMd": inserted_markdown,
                }
            elif normalized_placement == "prepend":
                op = {
                    "op": "insert_at",
                    "position": 0,
                    "contentMd": inserted_markdown,
                }
            elif normalized_placement == "insert_after_block":
                normalized_block_id = _normalize_optional_text(block_id)
                if not normalized_block_id:
                    return self.fail_response(
                        "doc_generate_image_and_insert_validation_error: block_id is required for insert_after_block"
                    )
                op = {
                    "op": "insert_after_block",
                    "blockId": normalized_block_id,
                    "contentMd": inserted_markdown,
                }
            elif normalized_placement == "insert_before_block":
                normalized_block_id = _normalize_optional_text(block_id)
                if not normalized_block_id:
                    return self.fail_response(
                        "doc_generate_image_and_insert_validation_error: block_id is required for insert_before_block"
                    )
                op = {
                    "op": "insert_before_block",
                    "blockId": normalized_block_id,
                    "contentMd": inserted_markdown,
                }
            else:
                normalized_position = _normalize_optional_int(position)
                op = {
                    "op": "insert_at",
                    "position": normalized_position,
                    "contentMd": inserted_markdown,
                }

            base_metadata = dict(metadata or {})
            base_metadata.update(
                {
                    "feature": "doc_generate_image_and_insert",
                    "placement": normalized_placement,
                    "generated_image_count": len(generated_images_payload),
                }
            )
            payload = ApplyDocOpsRequest(
                baseVersion=effective_base_version,
                idempotencyKey=_normalize_optional_text(idempotency_key),
                summary=_normalize_optional_text(summary) or "Insert generated image(s) into document",
                ops=[op],
                actorType="agent",
                actorId=f"agent:{self.thread_id}",
                agentRunId=self.agent_run_id,
                threadId=self.thread_id,
                metadata=base_metadata,
            )
            client_request_id = _normalize_optional_text(idempotency_key)
            final_base_version = effective_base_version
            try:
                result = await self.docs_service.apply_doc_ops(
                    workspace_id=self.account_id,
                    user_id=self.account_id,
                    item_id=resolved_doc_item_id,
                    payload=payload,
                    client_request_id=client_request_id,
                )
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise
                current_version_from_conflict = _extract_conflict_current_version(exc.detail)
                if current_version_from_conflict is None or current_version_from_conflict == payload.baseVersion:
                    raise
                rebased_payload = payload.model_copy(update={"baseVersion": current_version_from_conflict})
                result = await self.docs_service.apply_doc_ops(
                    workspace_id=self.account_id,
                    user_id=self.account_id,
                    item_id=resolved_doc_item_id,
                    payload=rebased_payload,
                    client_request_id=client_request_id,
                )
                auto_rebased_on_conflict = True
                final_base_version = current_version_from_conflict

            response_payload = result.model_dump()
            response_payload["docItemId"] = resolved_doc_item_id
            response_payload["placement"] = normalized_placement
            response_payload["insertedMarkdown"] = inserted_markdown
            response_payload["generatedImages"] = generated_images_payload
            if auto_rebased_on_conflict:
                response_payload["autoRebasedOnConflict"] = True
                response_payload["requestedBaseVersion"] = (
                    requested_base_version if requested_base_version is not None else effective_base_version
                )
                response_payload["effectiveBaseVersion"] = final_base_version
            return self.success_response(response_payload)
        except DocToolAccessError as exc:
            return self.fail_response(str(exc))
        except HTTPException as exc:
            return self.fail_response(
                f"doc_generate_image_and_insert_http_{exc.status_code}: {_format_http_detail(exc.detail)}"
            )
        except Exception as exc:
            logger.exception("DocAgentTool.doc_generate_image_and_insert failed")
            return self.fail_response(f"doc_generate_image_and_insert_error:{type(exc).__name__}:{str(exc)[:300]}")

    async def doc_update_title(
        self,
        *,
        title: str,
        doc_item_id: Optional[str] = None,
    ) -> ToolResult:
        try:
            normalized_title = _normalize_optional_text(title)
            if not normalized_title:
                return self.fail_response("doc_update_title_validation_error: title is required")

            resolved_doc_item_id = await self._resolve_doc_item_id(doc_item_id)
            result = await self.docs_service.update_doc_title(
                workspace_id=self.account_id,
                user_id=self.account_id,
                item_id=resolved_doc_item_id,
                title=normalized_title,
                client_request_id=self.agent_run_id,
            )
            if isinstance(self.doc_context, dict):
                self.doc_context["doc_title"] = normalized_title
            return self.success_response(result)
        except DocToolAccessError as exc:
            return self.fail_response(str(exc))
        except HTTPException as exc:
            return self.fail_response(f"doc_update_title_http_{exc.status_code}: {_format_http_detail(exc.detail)}")
        except Exception as exc:
            logger.exception("DocAgentTool.doc_update_title failed")
            return self.fail_response(f"doc_update_title_error:{type(exc).__name__}:{str(exc)[:300]}")

    async def doc_undo_revision(
        self,
        *,
        revision_id: str,
        doc_item_id: Optional[str] = None,
        expected_current_version: Optional[int] = None,
        summary: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> ToolResult:
        try:
            resolved_doc_item_id = await self._resolve_doc_item_id(doc_item_id)
            payload = UndoDocRevisionRequest(
                expectedCurrentVersion=expected_current_version,
                summary=_normalize_optional_text(summary) or f"Undo revision {revision_id}",
                actorType="agent",
                actorId=f"agent:{self.thread_id}",
                agentRunId=self.agent_run_id,
                threadId=self.thread_id,
                metadata=metadata or {},
            )
            result = await self.docs_service.undo_doc_revision(
                workspace_id=self.account_id,
                user_id=self.account_id,
                item_id=resolved_doc_item_id,
                revision_id=revision_id,
                payload=payload,
            )
            return self.success_response(result.model_dump())
        except DocToolAccessError as exc:
            return self.fail_response(str(exc))
        except HTTPException as exc:
            return self.fail_response(f"doc_undo_revision_http_{exc.status_code}: {_format_http_detail(exc.detail)}")
        except Exception as exc:
            logger.exception("DocAgentTool.doc_undo_revision failed")
            return self.fail_response(f"doc_undo_revision_error:{type(exc).__name__}:{str(exc)[:300]}")

    async def doc_get_revision(
        self,
        *,
        revision_id: str,
        doc_item_id: Optional[str] = None,
    ) -> ToolResult:
        try:
            resolved_doc_item_id = await self._resolve_doc_item_id(doc_item_id)
            result = await self.docs_service.get_doc_revision(
                workspace_id=self.account_id,
                item_id=resolved_doc_item_id,
                revision_id=revision_id,
            )
            return self.success_response(result.model_dump())
        except DocToolAccessError as exc:
            return self.fail_response(str(exc))
        except HTTPException as exc:
            return self.fail_response(f"doc_get_revision_http_{exc.status_code}: {_format_http_detail(exc.detail)}")
        except Exception as exc:
            logger.exception("DocAgentTool.doc_get_revision failed")
            return self.fail_response(f"doc_get_revision_error:{type(exc).__name__}:{str(exc)[:300]}")
