"""Manual tester for the Canvas media generation pipeline.

Usage:
    uv run python -m backend.scripts.test_media_generation \
        --prompt "A cozy reading nook at sunset" \
        --aspect-ratio 3:4 \
        --quantity 2

Environment prerequisites:
    - One of:
      * HABITAT_API_KEY (for habitat/* models)
      * VERTEXAI_PROJECT + VERTEXAI_LOCATION
      * GEMINI_API_KEY
    - Supabase settings (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) for uploads
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Sequence

# Ensure repo root is on sys.path when executed or collected by pytest.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.core.media.generation_service import (
    MediaGenerationRequest,
    MediaGenerationService,
)
from backend.core.utils.config import config


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Call Gemini image generation and upload the result to Supabase.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--prompt",
        type=str,
        default="Concept art of a futuristic research lab on the moon",
        help="Text description for the images.",
    )
    parser.add_argument(
        "--aspect-ratio",
        type=str,
        default="1:1",
        help="Aspect ratio string such as 1:1, 3:4, 9:16.",
    )
    parser.add_argument(
        "--quantity",
        type=int,
        default=1,
        help="Number of images to request (max 10).",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="habitat/gpt-image-2",
        help="Model identifier to call (default habitat/gpt-image-2).",
    )
    parser.add_argument(
        "--reference",
        action="append",
        dest="references",
        default=None,
        help="Optional Supabase storagePath to use as a reference image. "
        "Repeat the flag to pass multiple references.",
    )
    return parser


async def _run_generation(args: argparse.Namespace) -> int:
    ensure_credentials()
    service = MediaGenerationService()
    request = MediaGenerationRequest(
        prompt=args.prompt.strip(),
        aspect_ratio=args.aspect_ratio.strip(),
        quantity=args.quantity,
        model=args.model.strip(),
        reference_image_ids=args.references,
    )
    try:
        items = await service.generate_images(request)
    except Exception as exc:  # pragma: no cover - manual diagnostic script
        print(f"[ERROR] Generation failed: {exc}", file=sys.stderr)
        return 1

    payload = {
        "request": MediaGenerationService.serialize_request(request),
        "results": [
            {
                "storage_path": item.storage_path,
                "width": item.width,
                "height": item.height,
                "mime_type": item.mime_type,
                "bytes": item.byte_size,
                "download_url": item.download_url,
            }
            for item in items
        ],
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def ensure_credentials() -> None:
    """Fail fast if Gemini/Vertex/Supabase credentials are missing."""
    missing: list[str] = []
    has_habitat = bool(config.HABITAT_API_KEY)
    has_vertex = bool(config.VERTEXAI_PROJECT and config.VERTEXAI_LOCATION)
    has_gemini = bool(config.GEMINI_API_KEY)
    if not (has_habitat or has_vertex or has_gemini):
        missing.append(
            "HABITAT_API_KEY or VERTEXAI_PROJECT + VERTEXAI_LOCATION or GEMINI_API_KEY"
        )
    if not config.SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not config.SUPABASE_SERVICE_ROLE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if missing:
        raise RuntimeError(
            "Missing required environment variables:\n - " + "\n - ".join(missing)
        )


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return asyncio.run(_run_generation(args))


if __name__ == "__main__":
    raise SystemExit(main())
