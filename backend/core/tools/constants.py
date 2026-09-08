from __future__ import annotations

"""
Centralized Canvas tool constants and helpers.

Provides a single source of truth for default node sizes used by tools,
with optional environment overrides. This keeps backend behavior aligned
with frontend defaults and makes future tuning trivial.
"""

import os
from typing import Optional, Tuple


# Frontend-aligned defaults
_TYPE_SIZES = {
    'text': (300.0, 60.0),
    'todo': (300.0, 60.0),
    'column': (300.0, 200.0),
    'table': (400.0, 130.0),
    'canvas-link': (280.0, 180.0),
    'media': (240.0, 160.0),
}

_CODE_SIZES = {
    'mermaid': (350.0, 250.0),
    'html': (650.0, 540.0),  # align with frontend NodeDefaults
    'svg': (400.0, 400.0),
}


def _parse_size_env(value: str) -> Optional[Tuple[float, float]]:
    try:
        v = value.replace('x', ',').replace('X', ',')
        parts = [p.strip() for p in v.split(',') if p.strip()]
        if len(parts) != 2:
            return None
        w = float(parts[0])
        h = float(parts[1])
        if w <= 0 or h <= 0:
            return None
        return (w, h)
    except Exception:
        return None


def get_default_node_size(node_type: str, code_type: Optional[str] = None) -> Tuple[float, float]:
    """Return default (width, height) for a node.

    Environment overrides (optional):
      - CANVAS_DEFAULT_SIZE_TEXT="300x60"
      - CANVAS_DEFAULT_SIZE_TODO="300x60"
      - CANVAS_DEFAULT_SIZE_COLUMN="300x200"
      - CANVAS_DEFAULT_SIZE_TABLE="400x130"
      - CANVAS_DEFAULT_SIZE_CANVAS_LINK="280x180"
      - CANVAS_DEFAULT_SIZE_MEDIA="240x160"
      - CANVAS_DEFAULT_SIZE_CODE_MERMAID="350x250"
      - CANVAS_DEFAULT_SIZE_CODE_HTML="300x200"
      - CANVAS_DEFAULT_SIZE_CODE_SVG="400x400"
    """
    nt = (node_type or '').lower()
    if nt == 'code':
        c = (code_type or 'mermaid').lower()
        # env override first
        env_key = f"CANVAS_DEFAULT_SIZE_CODE_{c.upper()}"
        v = os.getenv(env_key)
        if v:
            parsed = _parse_size_env(v)
            if parsed:
                return parsed
        # fallback to defaults
        return _CODE_SIZES.get(c, _CODE_SIZES['mermaid'])

    # non-code types
    key = nt.replace('-', '_').upper()  # e.g., canvas-link -> CANVAS_LINK
    env_key = f"CANVAS_DEFAULT_SIZE_{key}"
    v = os.getenv(env_key)
    if v:
        parsed = _parse_size_env(v)
        if parsed:
            return parsed
    return _TYPE_SIZES.get(nt, (300.0, 120.0))
