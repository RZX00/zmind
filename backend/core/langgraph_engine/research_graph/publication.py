from __future__ import annotations

import hashlib
import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from core.application.use_cases.knowledge.create_knowledge_entry import CreateKnowledgeEntryUseCase
from core.canvas.id_utils import generate_canvas_entity_id
from core.files.processing import process_file_upload
from core.infrastructure.knowledge.supabase_knowledge_repository import SupabaseKnowledgeRepository
from core.services.r2_storage import get_r2_bucket, get_r2_client
from core.services.supabase import DBConnection
from core.tools.canvas_edit_tool import CanvasEditTool
from core.utils.logger import logger

from .report_formatter import (
    build_canvas_report_nodes,
    build_research_report_markdown,
    select_canvas_claim_cards,
)


@dataclass(frozen=True)
class ResearchPublicationRequest:
    agent_run_id: str
    thread_id: str
    account_id: str
    topic: str
    final_answer: str
    sources: list[dict[str, Any]]
    verification: dict[str, Any]
    canvas_id: str | None
    publish_kb_enabled: bool
    publish_canvas_enabled: bool
    kb_folder_name: str
    canvas_claim_limit: int


@dataclass
class ResearchPublicationResult:
    status: str = "skipped"
    kb_entry_id: str | None = None
    kb_folder_id: str | None = None
    kb_filename: str | None = None
    canvas_id: str | None = None
    canvas_group_node_id: str | None = None
    canvas_node_ids: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "kb_entry_id": self.kb_entry_id,
            "kb_folder_id": self.kb_folder_id,
            "kb_filename": self.kb_filename,
            "canvas_id": self.canvas_id,
            "canvas_group_node_id": self.canvas_group_node_id,
            "canvas_node_ids": self.canvas_node_ids,
            "warnings": self.warnings,
            "errors": self.errors,
        }


class ResearchPublicationService:
    def __init__(self, db_connection: DBConnection | None = None) -> None:
        self._db = db_connection or DBConnection()

    async def publish(self, request: ResearchPublicationRequest) -> ResearchPublicationResult:
        result = ResearchPublicationResult(
            status="skipped",
            canvas_id=request.canvas_id,
        )
        if not request.publish_kb_enabled and not request.publish_canvas_enabled:
            return result

        markdown = build_research_report_markdown(
            topic=request.topic,
            final_answer=request.final_answer,
            sources=request.sources,
            verification=request.verification,
        )

        if request.publish_kb_enabled:
            try:
                kb_meta = await self._publish_to_knowledge_base(request, markdown)
                result.kb_entry_id = kb_meta.get("entry_id")
                result.kb_folder_id = kb_meta.get("folder_id")
                result.kb_filename = kb_meta.get("filename")
            except Exception as exc:
                logger.warning("Research publish to knowledge base failed", error=str(exc))
                result.errors.append(f"kb_publish_failed:{exc}")

        if request.publish_canvas_enabled:
            if request.canvas_id:
                try:
                    canvas_meta = await self._publish_to_canvas(
                        request=request,
                        kb_entry_id=result.kb_entry_id,
                    )
                    result.canvas_group_node_id = canvas_meta.get("group_node_id")
                    result.canvas_node_ids = canvas_meta.get("node_ids") or []
                except Exception as exc:
                    logger.warning("Research publish to canvas failed", error=str(exc))
                    result.errors.append(f"canvas_publish_failed:{exc}")
            else:
                result.warnings.append("canvas_publish_skipped:no_canvas_bound")

        if not result.errors and (result.kb_entry_id or result.canvas_group_node_id):
            result.status = "published"
        elif result.errors and (result.kb_entry_id or result.canvas_group_node_id):
            result.status = "partial"
        elif result.errors:
            result.status = "failed"
        else:
            result.status = "skipped"
        return result

    async def _publish_to_knowledge_base(
        self,
        request: ResearchPublicationRequest,
        markdown: str,
    ) -> dict[str, Any]:
        account_id = request.account_id
        folder_id = await self._ensure_kb_folder(account_id, request.kb_folder_name)
        filename = self._build_report_filename(request.topic)
        file_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).strftime("%Y/%m/%d")
        storage_path = f"{account_id}/kb/{timestamp}/{file_id}-{filename}"

        file_bytes = markdown.encode("utf-8")
        r2 = get_r2_client()
        bucket = get_r2_bucket()
        r2.put_object(
            Bucket=bucket,
            Key=storage_path,
            Body=file_bytes,
            ContentType="text/markdown; charset=utf-8",
        )

        client = await self._db.client
        await client.table("file_uploads").insert(
            {
                "id": file_id,
                "account_id": account_id,
                "user_id": None,
                "bucket_name": "file-uploads",
                "storage_provider": "r2",
                "storage_bucket": bucket,
                "storage_path": storage_path,
                "original_filename": filename,
                "file_size": len(file_bytes),
                "content_type": "text/markdown",
                "status": "uploaded",
                "source": "deep_research",
            }
        ).execute()

        try:
            await process_file_upload(
                file_id=file_id,
                account_id=account_id,
                file_bytes=file_bytes,
            )
        except Exception as exc:
            logger.debug("Research report file metadata extraction failed", error=str(exc))

        summary = self._build_report_summary(request.topic, request.final_answer)
        entry_id = str(uuid.uuid4())
        payload_key = hashlib.sha1(
            f"{request.agent_run_id}:{request.topic}:{summary}".encode("utf-8")
        ).hexdigest()
        idempotency_key = f"research:{request.thread_id}:{payload_key[:24]}"

        use_case = CreateKnowledgeEntryUseCase(SupabaseKnowledgeRepository(self._db))
        resolved_entry_id, _duplicate = await use_case.execute(
            entry_id=entry_id,
            folder_id=folder_id,
            account_id=account_id,
            filename=filename,
            storage_path=storage_path,
            file_size=len(file_bytes),
            mime_type="text/markdown",
            summary=summary,
            file_id=file_id,
            idempotency_key=idempotency_key,
            user_id=None,
            source_type="deep_research_report",
        )
        return {
            "entry_id": resolved_entry_id,
            "folder_id": folder_id,
            "filename": filename,
        }

    async def _publish_to_canvas(
        self,
        *,
        request: ResearchPublicationRequest,
        kb_entry_id: str | None,
    ) -> dict[str, Any]:
        assert request.canvas_id is not None
        claims = request.verification.get("claims") or []
        claim_verdicts = request.verification.get("claim_verdicts") or []
        confidence_scores = request.verification.get("confidence_scores") or []
        claim_cards = select_canvas_claim_cards(
            claims=claims if isinstance(claims, list) else [],
            claim_verdicts=claim_verdicts if isinstance(claim_verdicts, list) else [],
            confidence_scores=confidence_scores if isinstance(confidence_scores, list) else [],
            limit=max(1, request.canvas_claim_limit),
        )
        source_preview = request.sources[:6] if isinstance(request.sources, list) else []
        base_x, base_y = await self._compute_canvas_anchor(
            account_id=request.account_id,
            canvas_id=request.canvas_id,
        )
        canvas_nodes = build_canvas_report_nodes(
            base_x=base_x,
            base_y=base_y,
            topic=request.topic,
            kb_entry_id=kb_entry_id,
            verification=request.verification,
            claim_cards=claim_cards,
            source_preview=source_preview,
            node_id_factory=generate_canvas_entity_id,
        )
        node_payloads = canvas_nodes.get("nodes") or []
        operations = [{"op": "add_node", "node": node} for node in node_payloads if isinstance(node, dict)]
        if not operations:
            return {"group_node_id": None, "node_ids": []}

        tool = CanvasEditTool(
            thread_id=request.thread_id,
            canvas_id=request.canvas_id,
            db_connection=self._db,
        )
        tool_result = await tool.edit(
            canvas_id=request.canvas_id,
            operations=operations,
            account_id_override=request.account_id,
            broadcast_canvas_ws=True,
        )
        if not tool_result.success:
            raise RuntimeError(tool_result.output)

        payload = {}
        try:
            payload = json.loads(tool_result.output or "{}")
        except Exception:
            payload = {}

        applied = payload.get("applied") if isinstance(payload, dict) else []
        created_node_ids = [
            str(item.get("id"))
            for item in (applied or [])
            if isinstance(item, dict) and item.get("op") == "add_node" and item.get("id")
        ]
        if not created_node_ids:
            created_node_ids = [
                str(node.get("id"))
                for node in node_payloads
                if isinstance(node, dict) and node.get("id")
            ]

        return {
            "group_node_id": canvas_nodes.get("group_node_id"),
            "node_ids": created_node_ids,
        }

    async def _ensure_kb_folder(self, account_id: str, folder_name: str) -> str:
        normalized_name = folder_name.strip() or "Deep Research Reports"
        client = await self._db.client
        existing = (
            await client.table("knowledge_base_folders")
            .select("folder_id")
            .eq("account_id", account_id)
            .eq("name", normalized_name)
            .limit(1)
            .execute()
        )
        if existing.data:
            return str(existing.data[0]["folder_id"])

        try:
            inserted = (
                await client.table("knowledge_base_folders")
                .insert(
                    {
                        "account_id": account_id,
                        "name": normalized_name,
                        "description": "Auto-published deep research reports",
                    }
                )
                .execute()
            )
            if inserted.data:
                return str(inserted.data[0]["folder_id"])
        except Exception:
            pass

        reloaded = (
            await client.table("knowledge_base_folders")
            .select("folder_id")
            .eq("account_id", account_id)
            .eq("name", normalized_name)
            .limit(1)
            .execute()
        )
        if reloaded.data:
            return str(reloaded.data[0]["folder_id"])
        raise RuntimeError("failed_to_create_or_resolve_kb_folder")

    async def _compute_canvas_anchor(self, *, account_id: str, canvas_id: str) -> tuple[float, float]:
        client = await self._db.client
        result = (
            await client.table("canvases")
            .select("doc")
            .eq("id", canvas_id)
            .eq("account_id", account_id)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )
        if not result.data:
            return (120.0, 120.0)

        doc = result.data[0].get("doc") or {}
        nodes = doc.get("nodes") if isinstance(doc, dict) else []
        if not isinstance(nodes, list) or not nodes:
            return (120.0, 120.0)

        max_right = 0.0
        min_top = 120.0
        for node in nodes:
            if not isinstance(node, dict):
                continue
            x = self._to_float(node.get("x"), 0.0)
            y = self._to_float(node.get("y"), 0.0)
            width = self._to_float(node.get("width"), 300.0)
            max_right = max(max_right, x + width)
            min_top = min(min_top, y)

        return (max(120.0, max_right + 220.0), max(80.0, min_top))

    def _build_report_filename(self, topic: str) -> str:
        topic_stub = re.sub(r"\s+", "-", topic.strip().lower())
        topic_stub = re.sub(r"[^a-z0-9\-]+", "-", topic_stub).strip("-")
        if not topic_stub:
            topic_stub = "research-report"
        topic_stub = topic_stub[:60]
        date_suffix = datetime.now(timezone.utc).strftime("%Y%m%d")
        return f"deep-research-{date_suffix}-{topic_stub}.md"

    def _build_report_summary(self, topic: str, final_answer: str) -> str:
        topic_part = topic.strip()
        answer_part = final_answer.strip()
        combined = f"{topic_part}\n\n{answer_part}".strip()
        if len(combined) > 980:
            combined = combined[:980].rstrip()
        return combined

    @staticmethod
    def _to_float(value: Any, fallback: float) -> float:
        try:
            return float(value)
        except Exception:
            return fallback
