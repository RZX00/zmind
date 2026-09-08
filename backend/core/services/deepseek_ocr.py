from __future__ import annotations

import asyncio
import base64
import os
import re
import shutil
import subprocess
import tempfile
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

import httpx
from PIL import Image

from core.utils.config import config
from core.utils.logger import logger


DEFAULT_MODEL = "DeepSeek-OCR"
DEFAULT_PROMPT = "<|grounding|>OCR this image. Return plain text only."
DEFAULT_PROVIDER_HINT = {
    "only": [],
    "order": [],
    "sort": None,
    "input_price_range": [],
    "output_price_range": [],
    "input_length_range": [],
    "throughput_range": [],
    "latency_range": [],
}


def _normalize_api_base(api_base: Optional[str]) -> str:
    base = (api_base or "https://aiping.cn/api/v1").rstrip("/")
    if base.endswith("/chat/completions"):
        base = base[: -len("/chat/completions")]
    return base


def _resolve_api_key() -> Optional[str]:
    return config.AIPING_API_KEY or config.OPENAI_COMPATIBLE_API_KEY or config.OPENAI_API_KEY


async def deepseek_ocr_pdf_bytes(
    pdf_bytes: bytes,
    *,
    max_pages: int,
    dpi: int,
    max_image_dim: int,
    model: Optional[str] = None,
    prompt: Optional[str] = None,
) -> Tuple[str, Dict[str, Any]]:
    pages = await asyncio.to_thread(
        _render_pdf_to_png_pages,
        pdf_bytes,
        max_pages=max_pages,
        dpi=dpi,
    )
    if not pages:
        return "", {"status": "failed", "reason": "no_pages"}

    api_key = _resolve_api_key()
    if not api_key:
        return "", {"status": "failed", "reason": "missing_api_key"}

    base_url = _normalize_api_base(config.AIPING_API_BASE)
    url = f"{base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}"}
    model_name = model or DEFAULT_MODEL
    ocr_prompt = prompt or DEFAULT_PROMPT

    texts: List[str] = []
    async with httpx.AsyncClient(timeout=60.0) as client:
        for idx, page_bytes in enumerate(pages, start=1):
            resized = _resize_image_bytes(page_bytes, max_image_dim)
            page_text = await _ocr_image_bytes(
                client,
                url=url,
                headers=headers,
                image_bytes=resized,
                model=model_name,
                prompt=ocr_prompt,
            )
            if page_text:
                if len(pages) > 1:
                    texts.append(f"[Page {idx}]\n{page_text.strip()}")
                else:
                    texts.append(page_text.strip())

    return "\n\n".join(texts).strip(), {
        "status": "ready" if texts else "failed",
        "pages": len(pages),
        "model": model_name,
    }


async def _ocr_image_bytes(
    client: httpx.AsyncClient,
    *,
    url: str,
    headers: Dict[str, str],
    image_bytes: bytes,
    model: str,
    prompt: str,
) -> str:
    data_url = _to_data_url(image_bytes)
    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": prompt},
                ],
            }
        ],
        "extra_body": {"provider": DEFAULT_PROVIDER_HINT},
    }
    resp = await client.post(url, headers=headers, json=payload)
    resp.raise_for_status()
    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content
    return ""


def _render_pdf_to_png_pages(pdf_bytes: bytes, *, max_pages: int, dpi: int) -> List[bytes]:
    if not shutil.which("pdftoppm"):
        logger.warning("[ocr] pdftoppm not installed; skipping OCR")
        return []

    dpi = max(72, int(dpi or 200))
    max_pages = max(1, int(max_pages or 1))

    with tempfile.TemporaryDirectory(prefix="ocr_pdf_") as tmpdir:
        pdf_path = os.path.join(tmpdir, "source.pdf")
        with open(pdf_path, "wb") as handle:
            handle.write(pdf_bytes)

        output_prefix = os.path.join(tmpdir, "page")
        cmd = [
            "pdftoppm",
            "-png",
            "-r",
            str(dpi),
            "-f",
            "1",
            "-l",
            str(max_pages),
            pdf_path,
            output_prefix,
        ]
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except Exception as exc:
            logger.warning(f"[ocr] pdftoppm failed: {exc}")
            return []

        pages: List[bytes] = []
        for path in _sorted_page_paths(tmpdir, output_prefix):
            try:
                with open(path, "rb") as handle:
                    pages.append(handle.read())
            except Exception:
                continue
        return pages


def _sorted_page_paths(tmpdir: str, prefix: str) -> List[str]:
    pattern = re.compile(rf"{re.escape(prefix)}-(\\d+).png$")
    matches = []
    for name in os.listdir(tmpdir):
        full_path = os.path.join(tmpdir, name)
        match = pattern.search(full_path)
        if match:
            matches.append((int(match.group(1)), full_path))
    return [path for _, path in sorted(matches, key=lambda item: item[0])]


def _resize_image_bytes(image_bytes: bytes, max_dim: int) -> bytes:
    if not max_dim or max_dim <= 0:
        return image_bytes
    try:
        with Image.open(BytesIO(image_bytes)) as img:
            img = img.convert("RGB")
            width, height = img.size
            scale = min(1.0, max_dim / max(width, height))
            if scale < 1.0:
                new_size = (int(width * scale), int(height * scale))
                img = img.resize(new_size, Image.LANCZOS)
            out = BytesIO()
            img.save(out, format="PNG", optimize=True)
            return out.getvalue()
    except Exception:
        return image_bytes


def _to_data_url(image_bytes: bytes) -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:image/png;base64,{encoded}"
