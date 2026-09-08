from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from core.utils.logger import logger


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


PROMPTS_ROOT = Path(os.getenv("ZMIND_PROMPTS_PATH", "").strip() or (_repo_root() / "prompts"))


def read_prompt_file(rel_path: str) -> Optional[str]:
    path = PROMPTS_ROOT / rel_path
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except Exception as exc:
        logger.warning("Failed to read prompt file", file=str(path), error=str(exc))
        return None


def read_prompt_file_or_fallback(rel_path: str, fallback: str) -> str:
    content = read_prompt_file(rel_path)
    if content is None or not content.strip():
        return fallback
    return content


def safe_format(template: str, **kwargs: str) -> str:
    try:
        return template.format(**kwargs)
    except Exception as exc:
        logger.warning("Failed to format prompt template", error=str(exc))
        result = template
        for key, value in kwargs.items():
            result = result.replace(f"{{{key}}}", value)
        return result


def escape_braces(text: str) -> str:
    return text
