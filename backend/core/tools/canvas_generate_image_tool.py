from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Optional

from core.tools.base import Tool, ToolResult, openapi_schema, usage_example
from core.media.generation_service import (
    MediaGenerationService,
    MediaGenerationRequest,
    GeneratedMediaItem,
)
from core.tools.canvas_edit_tool import CanvasEditTool
from core.application.use_cases.media.resolve_reference_images import ResolveReferenceImagesUseCase
from core.domains.media.reference_image import ReferenceImageInput
from core.infrastructure.media.supabase_canvas_media_repository import SupabaseCanvasMediaRepository
from core.infrastructure.media.supabase_reference_image_repository import SupabaseReferenceImageRepository
from core.utils.logger import logger
from core.services.supabase import DBConnection


MAX_CANVAS_GENERATED_IMAGE_DIMENSION = 800.0


@dataclass
class CanvasGenerateImageTool(Tool):
    """Scaffolding tool that will call Gemini Image APIs to populate the canvas."""

    thread_id: str
    canvas_id: Optional[str] = None
    media_service: Optional[MediaGenerationService] = None
    db_connection: Optional[Any] = None
    thread_manager: object | None = None

    def __post_init__(self) -> None:
        super().__init__()
        self.media_service = self.media_service or MediaGenerationService()

    @openapi_schema(
        {
            "type": "function",
            "function": {
                "name": "canvas_generate_image",
                "description": "Generate one or more images for the active canvas and store them in Supabase storage. "
                "Supports future reference-image editing and batch generation.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {
                            "type": "string",
                            "description": "Required textual description for the images to create.",
                        },
                        "aspect_ratio": {
                            "type": "string",
                            "description": "Aspect ratio such as 1:1, 3:4, 9:16. Defaults to 1:1.",
                        },
                        "quantity": {
                            "type": "integer",
                            "description": "Number of images to create (max 10 per batch). Defaults to 1.",
                        },
                        "reference_images": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "file_id": {"type": "string"},
                                    "storage_path": {"type": "string"},
                                    "node_id": {"type": "string"},
                                    "label": {"type": "string"},
                                    "width": {"type": "integer"},
                                    "height": {"type": "integer"},
                                    "source": {"type": "string"},
                                },
                            },
                            "description": "Optional reference images for edit/generation.",
                        },
                        "model": {
                            "type": "string",
                            "description": "Override image model (defaults to habitat/gpt-image-2).",
                        },
                    },
                    "required": ["prompt"],
                },
            },
        }
    )
    @usage_example(
        """
        {
          "tool_calls": [
            {
              "type": "function",
              "function": {
                "name": "canvas_generate_image",
                "arguments": {
                  "prompt": "Generate three concept posters of a lunar research lab interior",
                  "aspect_ratio": "3:4",
                  "quantity": 3
                }
              }
            }
          ]
        }
        """
    )
    async def canvas_generate_image(
        self,
        prompt: str,
        aspect_ratio: str = "1:1",
        quantity: int = 1,
        reference_images: Optional[List[dict]] = None,
        model: str = "habitat/gpt-image-2",
    ) -> ToolResult:
        if not prompt or not prompt.strip():
            return self.fail_response("prompt is required")

        if quantity < 1:
            return self.fail_response("quantity must be >= 1")

        account_id = None
        try:
            client = await (self.db_connection or DBConnection()).client
            trow = await client.table('threads').select('account_id').eq('thread_id', self.thread_id).limit(1).execute()
            if trow.data:
                account_id = trow.data[0].get('account_id')
        except Exception:
            account_id = None

        edit_tool = CanvasEditTool(
            thread_manager=self.thread_manager,
            thread_id=self.thread_id,
            canvas_id=self.canvas_id,
            db_connection=self.db_connection,
        )

        try:
            target_canvas_id = await edit_tool._get_thread_canvas_id()
        except Exception as exc:  # pragma: no cover
            logger.exception("Failed to resolve canvas id: %s", exc)
            target_canvas_id = None

        if not target_canvas_id:
            return self.fail_response("No canvas is bound to this thread")

        reference_inputs = self._normalize_reference_images(reference_images)
        if not reference_inputs:
            reference_inputs = await self._load_reference_images_from_messages()

        resolved_reference_ids: Optional[List[str]] = None
        if reference_inputs:
            resolver = ResolveReferenceImagesUseCase(
                reference_repo=SupabaseReferenceImageRepository(self.db_connection),
                canvas_repo=SupabaseCanvasMediaRepository(self.db_connection),
            )
            resolution = await resolver.execute(
                reference_inputs,
                account_id=account_id,
                canvas_id=target_canvas_id,
            )
            if resolution.unresolved:
                return self._reference_unavailable_response(
                    prompt=prompt,
                    aspect_ratio=aspect_ratio,
                    quantity=quantity,
                    model=model,
                    thread_id=self.thread_id,
                    canvas_id=target_canvas_id,
                    candidates=resolution.candidates,
                )
            resolved_reference_ids = [item.file_id for item in resolution.resolved]

        request = MediaGenerationRequest(
            prompt=prompt.strip(),
            aspect_ratio=aspect_ratio.strip() if aspect_ratio else "1:1",
            quantity=quantity,
            reference_image_ids=resolved_reference_ids,
            model=model.strip() if model else "habitat/gpt-image-2",
            account_id=account_id,
        )

        try:
            generated_items = await self.media_service.generate_images(request)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception("Media generation failed: %s", exc)
            return self.fail_response(f"Media generation failed: {exc}")

        if not generated_items:
            return self.fail_response("Media service returned no images")

        operations = self._build_add_node_operations(prompt, generated_items)

        edit_result = await edit_tool.edit(
            canvas_id=target_canvas_id,
            operations=operations,
            broadcast_canvas_ws=True,
        )

        if not edit_result.success:
            return edit_result

        enriched_output = self._merge_result_with_media(edit_result.output, generated_items)
        return self.success_response(enriched_output)

    def _normalize_reference_images(
        self, reference_images: Optional[List[dict]]
    ) -> List[ReferenceImageInput]:
        if not reference_images:
            return []
        items: List[ReferenceImageInput] = []
        for payload in reference_images:
            try:
                item = ReferenceImageInput.from_payload(payload)
            except Exception:
                item = ReferenceImageInput()
            if item.is_empty():
                continue
            items.append(item)
        return items

    async def _load_reference_images_from_messages(self) -> List[ReferenceImageInput]:
        try:
            client = await (self.db_connection or DBConnection()).client
            resp = (
                await client.table("messages")
                .select("metadata, created_at")
                .eq("thread_id", self.thread_id)
                .eq("type", "user")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if not resp.data:
                return []
            meta = resp.data[0].get("metadata") or {}
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except Exception:
                    meta = {}
            raw_images = meta.get("reference_images")
            if not isinstance(raw_images, list):
                return []
            return self._normalize_reference_images(raw_images)
        except Exception:
            return []

    def _reference_unavailable_response(
        self,
        *,
        prompt: str,
        aspect_ratio: str,
        quantity: int,
        model: str,
        thread_id: str,
        canvas_id: Optional[str],
        candidates: List[Any],
    ) -> ToolResult:
        payload = {
            "label": "Select reference image",
            "action": "image.select_reference",
            "payload": {
                "thread_id": thread_id,
                "canvas_id": canvas_id,
                "prompt": prompt,
                "aspect_ratio": aspect_ratio,
                "quantity": quantity,
                "model": model,
                "candidates": [
                    {
                        "file_id": item.file_id,
                        "storage_path": item.storage_path,
                        "node_id": item.node_id,
                        "label": item.label,
                        "width": item.width,
                        "height": item.height,
                    }
                    for item in candidates
                ],
            },
            "style": "primary",
        }
        metadata = {"frontend_content": {"cta": [payload]}}
        return self.fail_response(
            "Reference image is unavailable. Please select a new reference image to retry.",
            metadata=metadata,
        )

    def _build_add_node_operations(
        self,
        prompt: str,
        items: List[GeneratedMediaItem],
    ) -> List[dict]:
        ops: List[dict] = []
        timestamp = int(time.time() * 1000)
        spacing = 60.0
        for idx, item in enumerate(items):
            file_name = Path(item.storage_path).name
            extension = Path(file_name).suffix.lstrip(".") or "png"
            raw_w = max(1.0, float(getattr(item, "width", 0) or 0))
            raw_h = max(1.0, float(getattr(item, "height", 0) or 0))
            scale_w = MAX_CANVAS_GENERATED_IMAGE_DIMENSION / raw_w if raw_w else 1.0
            scale_h = MAX_CANVAS_GENERATED_IMAGE_DIMENSION / raw_h if raw_h else 1.0
            scale = min(1.0, scale_w, scale_h)
            width = max(1.0, float(round(raw_w * scale)))
            height = max(1.0, float(round(raw_h * scale)))
            node = {
                "type": "media",
                "x": spacing * idx,
                "y": spacing * idx,
                "width": width,
                "height": height,
                "content": prompt[:200],
                "mediaType": "image",
                "fileName": file_name,
                "fileType": item.mime_type,
                "fileExtension": extension,
                "fileSize": item.byte_size,
                "uploadStatus": "uploaded",
                "storagePath": item.storage_path,
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }
            if item.file_id:
                node["fileId"] = item.file_id
            ops.append({"op": "add_node", "node": node})
        return ops

    def _merge_result_with_media(self, raw_output: str, items: List[GeneratedMediaItem]) -> dict:
        try:
            payload = json.loads(raw_output)
        except json.JSONDecodeError:
            payload = {"canvas_edit_result": raw_output}

        payload["generated_media"] = [
            {
                "storage_path": item.storage_path,
                "file_id": item.file_id,
                "width": item.width,
                "height": item.height,
                "mime_type": item.mime_type,
            }
            for item in items
        ]

        payload["message"] = f"Generated {len(items)} image(s) and inserted into the canvas."
        return payload
