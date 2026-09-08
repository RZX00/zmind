from __future__ import annotations

import asyncio
import base64
import mimetypes
import os
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import List, Optional
import re

from PIL import Image

try:  # Lazy-import google-genai so missing deps don't break tool registration
    from google import genai  # type: ignore
    from google.genai import types as genai_types  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    genai = None  # type: ignore
    genai_types = None  # type: ignore

from core.services.supabase import DBConnection
from core.services.r2_storage import create_presigned_get_url, get_object_bytes, get_r2_bucket, get_r2_client
from core.utils.config import config
from core.utils.logger import logger
from core.utils.errors import FILE_REMOVED_MESSAGE
from core.services.llm import make_llm_api_call
import httpx
from base64 import b64decode


DEFAULT_IMAGE_MODEL = "habitat/gpt-image-2"
_IMAGE_MODEL_RENAMES = {
    # Legacy image-model identifiers now route to Habitat gpt-image-2.
    "gpt-image-2": "habitat/gpt-image-2",
    "gemini-3.1-flash-image-preview": "habitat/gpt-image-2",
    "gemini-3.1-flash-image-preview-2k": "habitat/gpt-image-2",
    "google/gemini-3.1-flash-image-preview": "habitat/gpt-image-2",
    "google/gemini-3.1-flash-image-preview-2k": "habitat/gpt-image-2",
    "models/gemini-3.1-flash-image-preview": "habitat/gpt-image-2",
    "models/gemini-3.1-flash-image-preview-2k": "habitat/gpt-image-2",
    "leaflow/gemini-3.1-flash-image-preview": "habitat/gpt-image-2",
    "leaflow/gemini-3.1-flash-image-preview-2k": "habitat/gpt-image-2",
    "aiping/gemini-3.1-flash-image-preview-2k": "habitat/gpt-image-2",
    "aiping/gemini-3.1-flash-image-preview": "habitat/gpt-image-2",
    "aiping/doubao-seedream-4.5": "habitat/gpt-image-2",
    "doubao-seedream-4.5": "habitat/gpt-image-2",
}


@dataclass
class MediaGenerationRequest:
    """Normalized request payload for media generation providers."""

    prompt: str
    aspect_ratio: str = "1:1"
    quantity: int = 1
    model: str = DEFAULT_IMAGE_MODEL
    reference_image_ids: Optional[List[str]] = None
    account_id: Optional[str] = None


@dataclass
class GeneratedMediaItem:
    """Metadata describing a generated media asset stored in Supabase."""

    storage_path: str
    width: int
    height: int
    mime_type: str
    byte_size: int
    download_url: Optional[str] = None
    file_id: Optional[str] = None


class MediaGenerationService:
    """Service responsible for calling Gemini image models and uploading outputs."""

    BUCKET_NAME = "file-uploads"

    def __init__(self) -> None:
        self._client: Optional["genai.Client"] = None

    @staticmethod
    def _clean_text(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    def _resolve_vertex_credentials_file(self) -> Optional[str]:
        """Resolve and validate explicit Vertex credentials file path.

        Resolution order:
        1) GOOGLE_APPLICATION_CREDENTIALS
        2) VERTEXAI_CREDENTIALS (supports relative path)

        Returns:
            Absolute file path if a usable credentials file is found, else None.

        Raises:
            RuntimeError: if explicit credential paths are provided but invalid.
        """
        env_path = self._clean_text(os.getenv("GOOGLE_APPLICATION_CREDENTIALS"))
        config_path = self._clean_text(config.VERTEXAI_CREDENTIALS)

        candidates: List[tuple[str, Path]] = []
        if env_path:
            candidates.append(("GOOGLE_APPLICATION_CREDENTIALS", Path(env_path)))
        if config_path:
            cfg_path = Path(config_path)
            if not cfg_path.is_absolute():
                cfg_path = Path.cwd() / cfg_path
            candidates.append(("VERTEXAI_CREDENTIALS", cfg_path))

        if not candidates:
            return None

        errors: List[str] = []
        for source, raw_path in candidates:
            path = raw_path.expanduser()
            if path.is_file():
                resolved = str(path.resolve())
                os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = resolved
                return resolved
            if path.exists() and path.is_dir():
                errors.append(f"{source} points to a directory: {path}")
                continue
            errors.append(f"{source} does not point to an existing file: {path}")

        raise RuntimeError(
            "Invalid Vertex credentials configuration. " + "; ".join(errors)
        )

    def _normalize_model_name(self, model: str) -> str:
        from core.ai_models import model_manager, ModelCapability

        # Resolve catalog IDs before historical rename shims, keeping distinct
        # Gemini image models routed to their own upstream model IDs.
        candidate = self._clean_text(model) or DEFAULT_IMAGE_MODEL
        raw_id = candidate.split("/", 1)[-1]
        registered = model_manager.get_model(f"habitat/{raw_id}")
        if registered and ModelCapability.IMAGE_GENERATION in registered.capabilities:
            return registered.id

        normalized = candidate.replace("ewo/", "habitat/", 1) if candidate.startswith("ewo/") else candidate
        normalized = _IMAGE_MODEL_RENAMES.get(normalized, normalized)
        if normalized.startswith("habitat/") or normalized.startswith("aiping/"):
            return normalized

        raw = normalized
        if raw.startswith("google/"):
            raw = raw[len("google/") :]
        if raw.startswith("models/"):
            raw = raw[len("models/") :]
        raw = _IMAGE_MODEL_RENAMES.get(raw, raw)
        if raw.startswith("habitat/") or raw.startswith("aiping/"):
            return raw

        # Route bare image model ids through Habitat in this service.
        if self._clean_text(config.HABITAT_API_KEY):
            return f"habitat/{raw}"

        return normalized

    @staticmethod
    def _ensure_genai_available() -> None:
        if genai is None or genai_types is None:
            raise RuntimeError(
                "google-genai is not installed. Install google-genai>=1.51.0 and set "
                "VERTEXAI_PROJECT/LOCATION or GEMINI_API_KEY to enable image generation."
            )

    async def generate_images(
        self,
        request: MediaGenerationRequest,
    ) -> List[GeneratedMediaItem]:
        """Invoke Gemini to create images and upload them to Supabase storage."""
        if not request.prompt.strip():
            raise ValueError("prompt is required")

        if request.quantity < 1:
            raise ValueError("quantity must be at least 1")

        if request.quantity > 10:
            raise ValueError("quantity cannot exceed 10 images per request")

        request.model = self._normalize_model_name(request.model)
        use_habitat = request.model.startswith("habitat/")
        use_aiping = request.model.startswith("aiping/")

        if not use_habitat and not use_aiping:
            client = self._get_client()
            reference_parts = await self._build_reference_parts(
                request.reference_image_ids,
                request.account_id,
            )

        results: List[GeneratedMediaItem] = []
        for idx in range(request.quantity):
            if use_habitat:
                # If a reference image is provided, treat as image-to-image
                if request.reference_image_ids:
                    image_bytes, mime_type = await self._generate_habitat_image_edit(request)
                else:
                    image_bytes, mime_type = await self._generate_single_image_habitat(request)
            elif use_aiping:
                # AIPING image generation
                if request.reference_image_ids:
                    image_bytes, mime_type = await self._generate_aiping_image_edit(request)
                else:
                    image_bytes, mime_type = await self._generate_single_image_aiping(request)
            else:
                image_bytes, mime_type = await self._generate_single_image(
                    client,
                    request,
                    reference_parts if idx == 0 else reference_parts,
                )
            uploaded = await self._upload_image_bytes(
                image_bytes,
                mime_type,
                account_id=request.account_id,
            )
            results.append(uploaded)

        return results

    def _get_client(self) -> "genai.Client":
        if self._client is not None:
            return self._client

        self._ensure_genai_available()

        vertex_project = self._clean_text(config.VERTEXAI_PROJECT)
        vertex_location = self._clean_text(config.VERTEXAI_LOCATION)
        gemini_api_key = self._clean_text(config.GEMINI_API_KEY)

        if vertex_project and vertex_location:
            credentials_error: Optional[str] = None
            try:
                self._resolve_vertex_credentials_file()
            except RuntimeError as exc:
                credentials_error = str(exc)

            if credentials_error and gemini_api_key:
                logger.warning(
                    "Vertex credentials invalid, falling back to GEMINI_API_KEY for media generation",
                    error=credentials_error,
                )
                self._client = genai.Client(api_key=gemini_api_key)
            elif credentials_error:
                raise RuntimeError(
                    f"{credentials_error}. Provide a valid service-account JSON file "
                    "or set GEMINI_API_KEY as fallback."
                )
            else:
                self._client = genai.Client(
                    vertexai=True,
                    project=vertex_project,
                    location=vertex_location,
                )
        elif gemini_api_key:
            self._client = genai.Client(api_key=gemini_api_key)
        else:
            raise RuntimeError(
                "Gemini credentials are not configured. "
                "Set VERTEXAI_PROJECT + VERTEXAI_LOCATION or GEMINI_API_KEY."
            )

        return self._client

    async def _generate_single_image(
        self,
        client: "genai.Client",
        request: MediaGenerationRequest,
        reference_parts: Optional[List["genai_types.Part"]] = None,
    ) -> tuple[bytes, str]:
        self._ensure_genai_available()

        def _call_gemini():
            prompt_text = request.prompt.strip()
            user_parts: List[genai_types.Part] = [
                genai_types.Part(text=prompt_text)
            ]
            if reference_parts:
                user_parts.extend(reference_parts)

            contents = [
                genai_types.Content(
                    role="user",
                    parts=user_parts,
                )
            ]
            cfg = genai_types.GenerateContentConfig(
                response_modalities=["IMAGE"],
            )
            return client.models.generate_content(
                model=request.model,
                contents=contents,
                config=cfg,
            )

        response = await asyncio.to_thread(_call_gemini)
        inline_data = self._extract_inline_image(response)
        payload = inline_data.data
        if isinstance(payload, str):
            payload = base64.b64decode(payload)
        elif isinstance(payload, bytearray):
            payload = bytes(payload)
        mime_type = inline_data.mime_type or "image/png"
        return payload, mime_type

    def _normalize_habitat_base(self) -> str:
        """Normalize Habitat base URL by stripping /chat/completions and trailing slash."""
        base = (config.HABITAT_API_BASE or "https://eapi.site/v1").strip()
        base = base.rstrip("/")
        suffix = "/chat/completions"
        if base.endswith(suffix):
            base = base[: -len(suffix)]
        return base

    def _decode_base64_loose(self, payload: str) -> bytes:
        """Decode base64 with padding fix and data URI stripping."""
        if not payload:
            raise RuntimeError("Empty base64 payload")
        # Strip data URI if present
        if payload.startswith("data:"):
            payload = payload.split(",", 1)[-1]
        # Remove whitespace/newlines
        payload = "".join(payload.split())
        # Fix padding
        missing = len(payload) % 4
        if missing:
            payload += "=" * (4 - missing)
        try:
            return b64decode(payload)
        except Exception as exc:
            raise RuntimeError(f"Failed to decode image base64: {exc}")

    async def _download_reference_image(
        self,
        reference_id: str,
        account_id: Optional[str],
    ) -> bytes:
        data, _ = await self._fetch_reference_bytes(reference_id, account_id)
        return data

    async def _generate_single_image_habitat(
        self,
        request: MediaGenerationRequest,
    ) -> tuple[bytes, str]:
        """Generate image via Habitat image generation endpoint (text-to-image)."""
        if not self._clean_text(config.HABITAT_API_KEY):
            raise RuntimeError("HABITAT_API_KEY is required for Habitat image generation")

        prompt_text = request.prompt.strip()
        # Derive model name without habitat/ prefix
        raw_model = request.model.split("/", 1)[-1]
        base = self._normalize_habitat_base()
        url = f"{base}/images/generations"

        headers = {
            "Authorization": f"Bearer {config.HABITAT_API_KEY or ''}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": raw_model,
            "prompt": prompt_text,
            "n": 1,
            "response_format": "b64_json",
        }

        async def _do_call(target_url: str):
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(target_url, json=payload, headers=headers)
                resp.raise_for_status()
                return resp.json()

        try:
            data = await _do_call(url)
        except Exception as exc:
            raise RuntimeError(f"Habitat image generation failed: {exc}") from exc

        try:
            images = data.get("data") or data.get("images") or []
            b64_payload = None
            for item in images:
                b64_payload = item.get("b64_json") or item.get("b64") or item.get("data")
                if b64_payload:
                    break
            if not b64_payload:
                raise RuntimeError("Habitat image response missing base64 payload")
            image_bytes = self._decode_base64_loose(b64_payload)
            return image_bytes, "image/png"
        except Exception as exc:
            raise RuntimeError(f"Habitat image response parse failed: {exc}")

    async def _generate_habitat_image_edit(
        self,
        request: MediaGenerationRequest,
    ) -> tuple[bytes, str]:
        """Call Habitat image edit endpoint (image-to-image)."""
        if not self._clean_text(config.HABITAT_API_KEY):
            raise RuntimeError("HABITAT_API_KEY is required for Habitat image edits")

        prompt_text = request.prompt.strip()
        raw_model = request.model.split("/", 1)[-1]
        base = self._normalize_habitat_base()
        url = f"{base}/images/edits"

        if not request.reference_image_ids:
            raise RuntimeError("reference_image_ids is required for image edits")

        ref_path = request.reference_image_ids[0]
        ref_bytes = await self._download_reference_image(ref_path, request.account_id)

        headers = {
            "Authorization": f"Bearer {config.HABITAT_API_KEY or ''}",
        }
        files = {
            "prompt": (None, prompt_text),
            "model": (None, raw_model),
            "response_format": (None, "b64_json"),
            # Outer loop in generate_images controls quantity; each provider request should produce one image.
            "n": (None, "1"),
            "image": ("reference.png", ref_bytes, "image/png"),
        }

        async def _do_call(target_url: str):
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(target_url, headers=headers, files=files)
                resp.raise_for_status()
                return resp.json()

        try:
            data = await _do_call(url)
        except Exception as exc:
            raise RuntimeError(f"Habitat image edit failed: {exc}") from exc

        try:
            images = data.get("data") or data.get("images") or []
            b64_payload = None
            for item in images:
                b64_payload = item.get("b64_json") or item.get("b64") or item.get("data")
                if b64_payload:
                    break
            if not b64_payload:
                raise RuntimeError("Habitat image edit response missing base64 payload")
            image_bytes = self._decode_base64_loose(b64_payload)
            return image_bytes, "image/png"
        except Exception as exc:
            raise RuntimeError(f"Habitat image edit parse failed: {exc}")

    def _normalize_aiping_base(self) -> str:
        """Normalize AIPING base URL by stripping /chat/completions and trailing slash."""
        base = (config.AIPING_API_BASE or "https://api.aiping.com/v1").strip()
        base = base.rstrip("/")
        suffix = "/chat/completions"
        if base.endswith(suffix):
            base = base[: -len(suffix)]
        return base

    @staticmethod
    def _aspect_ratio_to_size(aspect_ratio: str) -> str:
        """Convert aspect ratio like '3:4' to pixel size like '768x1024'."""
        _SIZE_MAP = {
            "1:1": "1024x1024",
            "3:4": "768x1024",
            "4:3": "1024x768",
            "9:16": "576x1024",
            "16:9": "1024x576",
            "3:2": "1024x682",
            "2:3": "682x1024",
        }
        return _SIZE_MAP.get(aspect_ratio, "1024x1024")

    async def _generate_single_image_aiping(
        self,
        request: MediaGenerationRequest,
    ) -> tuple[bytes, str]:
        """Generate image via AIPING image generation endpoint (text-to-image)."""
        if not self._clean_text(config.AIPING_API_KEY):
            raise RuntimeError("AIPING_API_KEY is required for AIPING image generation")

        prompt_text = request.prompt.strip()
        # Derive model name without aiping/ prefix
        raw_model = request.model.split("/", 1)[-1]
        base = self._normalize_aiping_base()
        url = f"{base}/images/generations"

        headers = {
            "Authorization": f"Bearer {config.AIPING_API_KEY or ''}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": raw_model,
            "prompt": prompt_text,
            "n": 1,
            "size": self._aspect_ratio_to_size(request.aspect_ratio),
            "response_format": "b64_json",
        }

        async def _do_call():
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                return resp.json()

        try:
            data = await _do_call()
        except Exception as exc:
            raise RuntimeError(f"AIPING image generation failed: {exc}")

        try:
            images = data.get("data") or data.get("images") or []
            logger.debug(
                "AIPING image response",
                model=raw_model,
                top_keys=list(data.keys()) if isinstance(data, dict) else type(data).__name__,
                images_count=len(images) if isinstance(images, list) else None,
                first_item_keys=list(images[0].keys()) if images and isinstance(images[0], dict) else None,
                # Log raw data snippet when images are empty for debugging
                raw_data_snippet=str(data)[:500] if not images else None,
            )
            b64_payload = None
            for item in images:
                b64_payload = item.get("b64_json") or item.get("b64") or item.get("data")
                # Also try 'url' field which some providers return as base64 data URI
                if not b64_payload:
                    url_val = item.get("url") or ""
                    if url_val.startswith("data:image"):
                        b64_payload = url_val.split(",", 1)[-1] if "," in url_val else None
                if b64_payload:
                    break
            if not b64_payload:
                raise RuntimeError("AIPING image response missing base64 payload")
            image_bytes = self._decode_base64_loose(b64_payload)
            return image_bytes, "image/png"
        except Exception as exc:
            raise RuntimeError(f"AIPING image response parse failed: {exc}")

    async def _generate_aiping_image_edit(
        self,
        request: MediaGenerationRequest,
    ) -> tuple[bytes, str]:
        """Call AIPING image edit endpoint (image-to-image)."""
        if not self._clean_text(config.AIPING_API_KEY):
            raise RuntimeError("AIPING_API_KEY is required for AIPING image edits")

        prompt_text = request.prompt.strip()
        raw_model = request.model.split("/", 1)[-1]
        base = self._normalize_aiping_base()
        url = f"{base}/images/edits"

        if not request.reference_image_ids:
            raise RuntimeError("reference_image_ids is required for image edits")

        ref_path = request.reference_image_ids[0]
        ref_bytes = await self._download_reference_image(ref_path, request.account_id)

        headers = {
            "Authorization": f"Bearer {config.AIPING_API_KEY or ''}",
        }
        files = {
            "prompt": (None, prompt_text),
            "model": (None, raw_model),
            "response_format": (None, "b64_json"),
            # Outer loop in generate_images controls quantity; each provider request should produce one image.
            "n": (None, "1"),
            "image": ("reference.png", ref_bytes, "image/png"),
        }

        async def _do_call():
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(url, headers=headers, files=files)
                resp.raise_for_status()
                return resp.json()

        try:
            data = await _do_call()
        except Exception as exc:
            raise RuntimeError(f"AIPING image edit failed: {exc}")

        try:
            images = data.get("data") or data.get("images") or []
            b64_payload = None
            for item in images:
                b64_payload = item.get("b64_json") or item.get("b64") or item.get("data")
                if b64_payload:
                    break
            if not b64_payload:
                raise RuntimeError("AIPING image edit response missing base64 payload")
            image_bytes = self._decode_base64_loose(b64_payload)
            return image_bytes, "image/png"
        except Exception as exc:
            raise RuntimeError(f"AIPING image edit parse failed: {exc}")

    def _extract_inline_image(
        self,
        response: genai_types.GenerateContentResponse,
    ):
        for candidate in getattr(response, "candidates", []) or []:
            for part in getattr(candidate.content, "parts", []) or []:
                data = getattr(part, "inline_data", None)
                if data:
                    return data
        raise RuntimeError("Gemini response did not include inline image data")

    async def _build_reference_parts(
        self,
        reference_ids: Optional[List[str]],
        account_id: Optional[str],
    ) -> List["genai_types.Part"]:
        self._ensure_genai_available()

        if not reference_ids:
            return []

        parts: List[genai_types.Part] = []

        for storage_path in reference_ids:
            try:
                data, mime_type = await self._fetch_reference_bytes(
                    storage_path,
                    account_id,
                )
                parts.append(
                    genai_types.Part.from_bytes(
                        data=data,
                        mime_type=mime_type,
                    )
                )
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.warning(
                    "Failed to load reference image %s: %s", storage_path, exc
                )

        return parts

    @staticmethod
    def _looks_like_uuid(value: str) -> bool:
        try:
            uuid.UUID(value)
            return True
        except Exception:
            return False

    async def _fetch_reference_bytes(
        self,
        reference_id: str,
        account_id: Optional[str],
    ) -> tuple[bytes, str]:
        db = DBConnection()
        client = await db.client

        record = None
        if self._looks_like_uuid(reference_id):
            query = client.table('file_uploads') \
                .select('storage_provider, storage_bucket, storage_path, content_type, original_filename, status') \
                .eq('id', reference_id)
            if account_id:
                query = query.eq('account_id', account_id)
            resp = await query.limit(1).execute()
            if resp.data:
                record = resp.data[0]

        if record:
            key = record.get('storage_path')
            if not key:
                raise RuntimeError("Missing storage_path for reference image")
            provider = record.get('storage_provider') or 'supabase'
            filename = record.get('original_filename') or key
            mime_type = record.get('content_type') or mimetypes.guess_type(filename)[0] or "image/png"
            if provider == 'r2':
                data = await asyncio.to_thread(get_object_bytes, key)
            else:
                raise RuntimeError(FILE_REMOVED_MESSAGE)
            return data, mime_type

        if self._looks_like_uuid(reference_id):
            raise RuntimeError(f"Reference image not found for id '{reference_id}'")

        raise RuntimeError(FILE_REMOVED_MESSAGE)

    async def _upload_image_bytes(
        self,
        image_bytes: bytes,
        mime_type: str,
        *,
        account_id: Optional[str],
    ) -> GeneratedMediaItem:
        db = DBConnection()
        client = await db.client

        ext = (mimetypes.guess_extension(mime_type) or ".png").lstrip(".")
        timestamp = datetime.utcnow().strftime("%Y/%m/%d")
        filename = f"{datetime.utcnow().strftime('%H%M%S')}_{uuid.uuid4().hex[:8]}.{ext}"

        if not account_id:
            raise RuntimeError("Missing account_id for media upload")

        bucket = get_r2_bucket()
        storage_path = f"{account_id}/canvas-media/{timestamp}/{filename}"
        r2 = get_r2_client()
        r2.put_object(
            Bucket=bucket,
            Key=storage_path,
            Body=image_bytes,
            ContentType=mime_type,
        )
        file_id = str(uuid.uuid4())
        await (
            client.table("file_uploads")
            .insert(
                {
                    "id": file_id,
                    "account_id": account_id,
                    "bucket_name": "file-uploads",
                    "storage_provider": "r2",
                    "storage_bucket": bucket,
                    "storage_path": storage_path,
                    "original_filename": filename,
                    "file_size": len(image_bytes),
                    "content_type": mime_type,
                    "status": "uploaded",
                    "source": "media_generation",
                }
            )
            .execute()
        )
        try:
            download_url = create_presigned_get_url(
                key=storage_path,
                expires_in=600,
                download_filename=filename,
            )
        except Exception:
            download_url = None

        width, height = self._get_image_dimensions(image_bytes)
        return GeneratedMediaItem(
            storage_path=storage_path,
            width=width,
            height=height,
            mime_type=mime_type,
            byte_size=len(image_bytes),
            download_url=download_url,
            file_id=file_id,
        )

    def _get_image_dimensions(self, data: bytes) -> tuple[int, int]:
        with Image.open(BytesIO(data)) as img:
            return img.width, img.height

    @staticmethod
    def serialize_request(request: MediaGenerationRequest) -> dict:
        """Utility for returning structured request payloads in tool responses."""
        data = asdict(request)
        return {k: v for k, v in data.items() if v is not None}
