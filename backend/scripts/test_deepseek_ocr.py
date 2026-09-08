#!/usr/bin/env python3
import argparse
import asyncio
import base64
import json
import mimetypes
import os
import sys
from typing import Optional

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

import httpx

from core.services.deepseek_ocr import (
    deepseek_ocr_pdf_bytes,
    DEFAULT_MODEL,
    DEFAULT_PROMPT,
    DEFAULT_PROVIDER_HINT,
)
from core.utils.config import config


def _resolve_api_key() -> Optional[str]:
    return config.AIPING_API_KEY or config.OPENAI_COMPATIBLE_API_KEY or config.OPENAI_API_KEY


def _normalize_api_base() -> str:
    base = (config.AIPING_API_BASE or "https://aiping.cn/api/v1").rstrip("/")
    if base.endswith("/chat/completions"):
        base = base[: -len("/chat/completions")]
    return base


def _read_bytes(path: str) -> bytes:
    with open(path, "rb") as handle:
        return handle.read()


def _to_data_url(image_bytes: bytes, mime: str) -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime};base64,{encoded}"


async def _ocr_image(path: str, prompt: str) -> str:
    api_key = _resolve_api_key()
    if not api_key:
        raise RuntimeError("Missing AIPING_API_KEY (or OPENAI_COMPATIBLE_API_KEY/OPENAI_API_KEY).")

    mime, _ = mimetypes.guess_type(path)
    mime = mime or "image/png"
    image_bytes = _read_bytes(path)
    data_url = _to_data_url(image_bytes, mime)

    url = f"{_normalize_api_base()}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}"}
    payload = {
        "model": DEFAULT_MODEL,
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

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    choices = data.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content")
    return content if isinstance(content, str) else ""


async def _ocr_pdf(path: str, max_pages: int, dpi: int, max_dim: int) -> None:
    pdf_bytes = _read_bytes(path)
    text, meta = await deepseek_ocr_pdf_bytes(
        pdf_bytes,
        max_pages=max_pages,
        dpi=dpi,
        max_image_dim=max_dim,
    )
    print(json.dumps(meta, indent=2, ensure_ascii=True))
    if text:
        print("\n--- OCR Text ---\n")
        print(text)
    else:
        print("\nNo OCR text returned.")


async def main() -> None:
    parser = argparse.ArgumentParser(description="Test DeepSeek-OCR via AIPING.")
    parser.add_argument("--pdf", help="Path to a PDF file to OCR.")
    parser.add_argument("--image", help="Path to an image file to OCR.")
    parser.add_argument("--max-pages", type=int, default=6)
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--max-dim", type=int, default=1600)
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    args = parser.parse_args()

    if not args.pdf and not args.image:
        parser.error("Provide --pdf or --image.")

    if args.pdf and args.image:
        parser.error("Use only one of --pdf or --image.")

    if args.image:
        text = await _ocr_image(args.image, args.prompt)
        print(text or "No OCR text returned.")
        return

    await _ocr_pdf(args.pdf, args.max_pages, args.dpi, args.max_dim)


if __name__ == "__main__":
    asyncio.run(main())
