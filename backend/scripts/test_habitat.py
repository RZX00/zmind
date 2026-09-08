"""Manual tester for Habitat LLM gateway.

Usage:
    uv run python -m backend.scripts.test_leaflow --model habitat/gemini-3.1-pro --prompt "ping"

Environment prerequisites:
    - HABITAT_API_BASE (e.g., https://api.aihabitat.live/v1)
    - HABITAT_API_KEY (or OPENAI_API_KEY / OPENAI_COMPATIBLE_API_KEY as fallback)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Dict

# Ensure repo root is on sys.path when executed or collected by pytest.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.core.services.llm import make_llm_api_call
from backend.core.utils.config import config


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Call Habitat (OpenAI-compatible) models through the unified LLM pipeline.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--model",
        type=str,
        default="habitat/gemini-3.1-pro",
        help="Model identifier routed via Habitat (habitat/gemini-3.1-pro, habitat/claude-sonnet-4-6, habitat/claude-opus-4-8).",
    )
    parser.add_argument(
        "--prompt",
        type=str,
        default="Say hi",
        help="User prompt to send.",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=256,
        help="Optional max tokens for the completion.",
    )
    return parser


async def _run(args: argparse.Namespace) -> int:
    key_available = bool(
        config.HABITAT_API_KEY
        or config.OPENAI_API_KEY
        or config.OPENAI_COMPATIBLE_API_KEY
    )
    if not key_available:
        print("Missing Habitat/OpenAI-compatible API key. Set HABITAT_API_KEY or OPENAI_API_KEY/OPENAI_COMPATIBLE_API_KEY.")
        return 1

    messages = [
        {"role": "system", "content": "You are a concise assistant."},
        {"role": "user", "content": args.prompt.strip()},
    ]

    try:
        response = await make_llm_api_call(
            messages=messages,
            model_name=args.model.strip(),
            temperature=0.2,
            max_tokens=args.max_tokens,
        )
    except Exception as exc:  # pragma: no cover - manual script
        print(f"Habitat request failed: {exc}")
        return 1

    def _to_serializable(obj: Any) -> Any:
        if hasattr(obj, "model_dump"):
            return obj.model_dump()
        if hasattr(obj, "dict"):
            return obj.dict()
        if isinstance(obj, bytes):
            return obj.decode("utf-8", errors="ignore")
        return obj

    print(json.dumps(_to_serializable(response), ensure_ascii=False, indent=2))
    return 0


def main() -> None:
    args = _build_parser().parse_args()
    exit_code = asyncio.run(_run(args))
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
